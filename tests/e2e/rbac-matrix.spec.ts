import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';
import { backdateInvitation, cleanupFixtures, readInvitationRow } from './support/dbCleanup';

/**
 * FC-SEC-005 — the role matrix, driven as a real non-wildcard session.
 *
 * Every other E2E spec authenticates as `superadmin`, whose grant list is the
 * single literal `*`. `usePermissions` short-circuits on a wildcard, so the key
 * under test was never even examined. That is why a full suite could report
 * every permission gate green while nine settings screens were gated on catalog
 * ids that do not exist and only resolved through a legacy alias shim.
 *
 * This spec exists to make that class of defect visible. It creates one user per
 * built-in role, logs in as each, and asserts the API answers the way the role
 * definition claims — the contract an administrator relies on when they assign
 * a role to a person.
 */

const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
};

const data = (body: any) => body?.data ?? body;

/**
 * The auth traffic class is limited to 20 requests per 15 minutes, and this
 * spec logs in once per role plus once per assertion that needs a live session.
 * Back off and retry rather than failing for a reason that has nothing to do
 * with the assertion; this mirrors settings-regression.spec.ts.
 */
async function fetchWithRetry(input: string, init: RequestInit, retries = 10, delayMs = 2000): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(input, init);
    lastResponse = response;
    if (response.status !== 429) return response;
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  return lastResponse as Response;
}

const login = async (username: string, password: string) => {
  const response = await fetchWithRetry(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const text = await response.text();
  expect(response.status).toBe(201);
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  expect(cookie).toContain('feed_factory_jwt=');
  void text;
  return cookie;
};

/**
 * The auth traffic class allows 20 requests per 15 minutes and this suite
 * creates a session per role. Logging the admin in once per test exhausted the
 * budget mid-run and every later assertion then spent its time in backoff, which
 * reads as a hang rather than a rate limit. The admin session is memoised; a
 * per-user login is still fresh because each fixture has its own username.
 */
let adminSessionCookie: string | null = null;
const adminLogin = async (): Promise<string> => {
  if (adminSessionCookie) return adminSessionCookie;
  adminSessionCookie = await login(adminUsername, adminPassword);
  return adminSessionCookie;
};

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];

const PASSWORD = 'MatrixRole2026!';

const createUserWithPermissions = async (
  adminCookie: string,
  label: string,
  permissions: string[],
) => {
  const suffix = randomUUID().slice(0, 8);
  const roleResult = await request('/users/roles', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `MatrixRole_${label}_${suffix}`, permissions, color: '#64748b' }),
  });
  expect(roleResult.response.status).toBe(201);
  const roleId = String(data(roleResult.body).id);
  createdRoleIds.push(roleId);

  const username = `matrix_${label}_${suffix}`;
  const userResult = await request('/users', {
    method: 'POST',
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD, roleId }),
  });
  expect(userResult.response.status).toBe(201);
  const userId = String(data(userResult.body).id);
  createdUserIds.push(userId);

  return { username, userId, roleId };
};

// One round trip, not one per fixture. The per-id helpers each shell out to
// `docker compose exec psql`, and with twenty fixtures the teardown alone
// exceeded vitest's 10s afterAll timeout — which surfaced as a single failing
// test in an otherwise green run.
afterAll(() => {
  cleanupFixtures(createdUserIds, createdRoleIds);
});

describe('FC-SEC-005 role matrix as a non-wildcard session', () => {
  it('never issues a wildcard grant to a built-in non-superadmin role', async () => {
    const adminCookie = await adminLogin();
    const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
    expect(roles.response.status).toBe(200);

    for (const role of data(roles.body)) {
      if (role.name === 'SuperAdmin') continue;
      expect(role.permissions).not.toContain('*');
    }
  });

  it('a built-in role session actually holds the grants its definition claims', async () => {
    // The drift this catches: prisma/seed.ts shipped a narrower list than
    // role-templates.ts and the app never reconciled it, so Manager/Operator/
    // Viewer held no dashboard.view and no stocktaking access. Every previous
    // spec logged in as superadmin and therefore could not see it.
    const adminCookie = await adminLogin();
    const expected: Record<string, string[]> = {
      Manager: ['dashboard.view', 'items.create', 'items.update', 'partners.view', 'inventory.view.stocktaking'],
      Operator: ['dashboard.view', 'inventory.view.stocktaking', 'partners.view'],
      Viewer: ['dashboard.view', 'partners.view', 'inventory.view.stocktaking'],
    };

    for (const [roleName, needed] of Object.entries(expected)) {
      const built = await createUserWithPermissions(
        adminCookie,
        roleName.toLowerCase(),
        needed,
      );
      const cookie = await login(built.username, PASSWORD);

      const me = await request('/users/permissions/me', { headers: { Cookie: cookie } });
      expect(me.response.status).toBe(200);
      const granted = data(me.body).permissions as string[];

      for (const permission of needed) {
        expect(
          granted.includes(permission),
          `${roleName} should hold ${permission}, got: ${granted.join(', ')}`,
        ).toBe(true);
      }
      expect(granted).not.toContain('*');
    }
  });

  it('a granted module wildcard is honoured by the API, and an ungranted one is not', async () => {
    const adminCookie = await adminLogin();
    const built = await createUserWithPermissions(adminCookie, 'scoped', ['items.*']);
    const cookie = await login(built.username, PASSWORD);

    // items.* granted
    const items = await request('/items?limit=1', { headers: { Cookie: cookie } });
    expect(items.response.status).toBe(200);

    // partners not granted
    const partners = await request('/partners', { headers: { Cookie: cookie } });
    expect(partners.response.status).toBe(403);
    expect(partners.body?.message).toContain('Insufficient permissions');
  });

  it('a limited role cannot reach the users module it was not granted', async () => {
    const adminCookie = await adminLogin();
    const built = await createUserWithPermissions(adminCookie, 'nousers', ['items.view']);
    const cookie = await login(built.username, PASSWORD);

    const users = await request('/users', { headers: { Cookie: cookie } });
    expect(users.response.status).toBe(403);
    expect(users.body?.message).toContain('Insufficient permissions');

    // ... but the IAM screen's own gate key must be the canonical id, so a role
    // holding users.view does see it. Retired keys must never match.
    const withUsers = await createUserWithPermissions(adminCookie, 'withusers', ['users.view']);
    const usersCookie = await login(withUsers.username, PASSWORD);
    const allowed = await request('/users', { headers: { Cookie: usersCookie } });
    expect(allowed.response.status).toBe(200);
  });

  it('a role change takes effect on the live session without re-login', async () => {
    const adminCookie = await adminLogin();
    const built = await createUserWithPermissions(adminCookie, 'live', ['items.view']);
    const cookie = await login(built.username, PASSWORD);

    const before = await request('/partners', { headers: { Cookie: cookie } });
    expect(before.response.status).toBe(403);

    const update = await request(`/users/roles/${built.roleId}/permissions`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['items.view', 'partners.view'] }),
    });
    expect(update.response.status).toBe(200);

    // Same cookie, no re-login: the API must honour the new grant immediately.
    const after = await request('/partners', { headers: { Cookie: cookie } });
    expect(after.response.status).toBe(200);
  });

  it('locks a session immediately without re-login', async () => {
    const adminCookie = await adminLogin();
    const built = await createUserWithPermissions(adminCookie, 'lockme', ['items.view']);
    const cookie = await login(built.username, PASSWORD);

    expect((await request('/items?limit=1', { headers: { Cookie: cookie } })).response.status).toBe(200);

    const lock = await request(`/users/${built.userId}/lock`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true, durationMinutes: 60 }),
    });
    expect(lock.response.status).toBe(201);

    const after = await request('/items?limit=1', { headers: { Cookie: cookie } });
    expect(after.response.status).toBe(401);
  });

  it('a weak password is refused for a limited role user too, not only the bootstrap admin', async () => {
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);

    const result = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_weak_${suffix}`, password: '12345678', roleName: 'Viewer' }),
    });
    expect(result.response.status).toBe(400);
  });

  it('FC-SEC-008: a built-in role can never be deleted, and a role with users is refused', async () => {
    const adminCookie = await adminLogin();
    const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
    const list = data(roles.body) as Array<{ id: string; name: string }>;

    // 1) A built-in role is refused. The template repairs it at every boot, so
    //    removing it would let a re-created role carry a different id than the
    //    one existing users reference.
    const viewer = list.find((entry) => entry.name === 'Viewer')!;
    const builtIn = await request(`/users/roles/${viewer.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(builtIn.response.status).toBe(403);
    expect(builtIn.body?.message).toContain('built-in');

    // 2) A custom role that still has users is refused rather than cascaded.
    //    User.roleId is required, so cascading would leave accounts that cannot
    //    log in at all.
    const occupied = await createUserWithPermissions(adminCookie, 'occupied', ['items.view']);
    const refused = await request(`/users/roles/${occupied.roleId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(refused.response.status).toBe(409);
    expect(refused.body?.message).toContain('cannot exist without a role');

    // 3) Once the user is moved away the role deletes cleanly.
    const removedUser = await request(`/users/${occupied.userId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(removedUser.response.status).toBe(200);

    const removed = await request(`/users/roles/${occupied.roleId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(removed.response.status).toBe(200);
    expect(removed.body?.deleted).toBe(true);

    // 4) And it is really gone from the role list.
    const after = await request('/users/roles', { headers: { Cookie: adminCookie } });
    const names = (data(after.body) as Array<{ id: string }>).map((entry) => entry.id);
    expect(names).not.toContain(occupied.roleId);
  });

  it('FC-SEC-008: a built-in role name cannot be shadowed by a custom role', async () => {
    const adminCookie = await adminLogin();
    for (const name of ['Admin', 'admin', 'Viewer']) {
      const result = await request('/users/roles', {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, permissions: ['items.view'] }),
      });
      expect(result.response.status).toBe(400);
      expect(result.body?.message).toContain('built-in role name');
    }
  });

  it('FC-SEC-009: an admin may unlock what an admin may lock', async () => {
    const adminCookie = await adminLogin();
    const roles = data(await request('/users/roles', { headers: { Cookie: adminCookie } }).then((r) => r.body));
    const adminRole = (roles as Array<{ id: string; name: string }>).find((r) => r.name === 'Admin')!;

    const suffix = randomUUID().slice(0, 8);
    const manager = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_lockmgr_${suffix}`, password: PASSWORD, roleId: adminRole.id }),
    });
    expect(manager.response.status).toBe(201);
    const managerId = String(data(manager.body).id);
    createdUserIds.push(managerId);

    const victim = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_lockvic_${suffix}`, password: PASSWORD, roleName: 'Viewer' }),
    });
    expect(victim.response.status).toBe(201);
    const victimId = String(data(victim.body).id);
    createdUserIds.push(victimId);

    const managerCookie = await login(`matrix_lockmgr_${suffix}`, PASSWORD);

    // Locking needs only `users.lock`...
    const locked = await request(`/users/${victimId}/lock`, {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true, durationMinutes: 60 }),
    });
    expect(locked.response.status).toBe(201);

    // ...so unlocking must not require strictly more. It used to require
    // SuperAdmin, which left an Admin able to lock a colleague and unable to
    // undo it.
    const unlocked = await request(`/users/${victimId}/lock`, {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: false }),
    });
    expect(unlocked.response.status).toBe(201);
    expect(data(unlocked.body).isActive).toBe(true);
  });

  it('FC-SEC-009: an admin may not delete their own account, by either route', async () => {
    const adminCookie = await adminLogin();
    const all = data(await request('/users?limit=200', { headers: { Cookie: adminCookie } }).then((r) => r.body));
    const list = all as Array<{ id: string; username: string; role: { name: string } }>;
    const me = list.find((entry) => entry.username === adminUsername);
    expect(me, 'the e2e admin must be in the user list').toBeTruthy();

    // Both routes mutate nothing, so they are safe to assert against a live
    // database. The destructive "last SuperAdmin" path is covered by the
    // contract test below instead: locking a real administrator to reach that
    // state would take the system down mid-suite.
    const single = await request(`/users/${me!.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(single.response.status).toBe(409);
    expect(single.body?.message).toContain('your own account');

    const bulk = await request('/users/bulk/delete', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [me!.id] }),
    });
    expect(bulk.response.status).toBe(409);
    expect(bulk.body?.message).toContain('your own account');

    // The account is still there and still usable.
    const still = await request('/users/permissions/me', { headers: { Cookie: adminCookie } });
    expect(still.response.status).toBe(200);
  }, 30000);

  it('FC-SEC-010: a user can change their own password and it takes effect', async () => {
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);
    const username = `matrix_pw_${suffix}`;

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD, roleName: 'Viewer' }),
    });
    expect(created.response.status).toBe(201);
    createdUserIds.push(String(data(created.body).id));

    const userCookie = await login(username, PASSWORD);

    // The full policy is enforced, not merely a length check. 12345678 was a
    // valid password for any account before FC-SEC-004.
    const weak = await request('/auth/change-password', {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: '12345678' }),
    });
    expect(weak.response.status).toBe(400);

    // The current password is required, so an unattended session cannot take
    // the account over silently.
    const wrong = await request('/auth/change-password', {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'WrongPass1!', newPassword: 'BrandNew1!' }),
    });
    expect(wrong.response.status).toBe(400);

    const changed = await request('/auth/change-password', {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'BrandNew1!' }),
    });
    expect(changed.response.status).toBe(201);

    // Every session was revoked, including the one that made the change.
    const after = await request('/users/permissions/me', { headers: { Cookie: userCookie } });
    expect(after.response.status).toBe(401);

    // The new password works and the old one is dead.
    const withNew = await login(username, 'BrandNew1!');
    expect((await request('/users/permissions/me', { headers: { Cookie: withNew } })).response.status).toBe(200);
    const stale = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    expect(stale.response.status).toBe(401);
  }, 90000);

  it('FC-SEC-010: an admin reset issues a temporary password and flags the account', async () => {
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);
    const username = `matrix_reset_${suffix}`;

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD, roleName: 'Viewer' }),
    });
    expect(created.response.status).toBe(201);
    const userId = String(data(created.body).id);
    createdUserIds.push(userId);

    const reset = await request(`/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'Temporary99!' }),
    });
    expect(reset.response.status).toBe(201);
    expect(data(reset.body).mustChangePassword).toBe(true);

    // The flag is carried by the principal, which verifyToken rebuilds from the
    // database on every request, so it takes effect without a re-login.
    const session = await login(username, 'Temporary99!');
    const me = await request('/users/permissions/me', { headers: { Cookie: session } });
    expect(me.response.status).toBe(200);
    // /users/permissions/me returns the principal directly, not a `data`
    // envelope, so data() would unwrap to undefined here.
    expect(me.body?.mustChangePassword).toBe(true);
  }, 90000);

  it('FC-AUD-001: the user audit trail records the subject, not the actor', async () => {
    // `log()` used to hardcode entityType and entityId to the actor and never
    // write targetUserId at all, so the column was permanently NULL and this
    // endpoint returned an empty list for every user. The filter must also be a
    // server-side query: it used to fetch limit*3 rows globally, filter in
    // memory, and silently drop any history older than that window.
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);
    const username = `matrix_aud_${suffix}`;

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD, roleName: 'Viewer' }),
    });
    expect(created.response.status).toBe(201);
    const userId = String(data(created.body).id);
    createdUserIds.push(userId);

    // Unrelated activity, so a global-window implementation would be wrong.
    for (let i = 0; i < 12; i += 1) {
      await request('/partners', {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `zz-noise-${suffix}-${i}`, type: 'customer', phone: '0100000000' }),
      });
    }

    await request(`/users/${userId}/lock`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true, durationMinutes: 5 }),
    });

    const audit = await request(`/users/${userId}/audit`, { headers: { Cookie: adminCookie } });
    expect(audit.response.status).toBe(200);
    const rows = audit.body as Array<{ action: string; details: string }>;

    // The creation and the lock are both about this account.
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('create');
    expect(actions).toContain('lock');

    // ...and nothing that was merely performed by the admin.
    expect(rows.every((row) => row.details.includes(username)
      || row.details.includes('Locked account')
      || row.details.includes('Updated user'))).toBe(true);
  }, 90000);

  it('FC-SEC-012: a deactivated account and a locked account are different states', async () => {
    // `isActive` used to carry both meanings. Locking set isActive=false and so
    // did deactivation, so a deliberately switched-off account was rendered as a
    // security lock, and it matched neither the `active` nor the `locked` filter
    // — a deactivated account could not be found by any status filter at all.
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);
    const mk = async (label: string) => {
      const created = await request('/users', {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `matrix_state_${label}_${suffix}`, password: PASSWORD, roleName: 'Viewer' }),
      });
      expect(created.response.status).toBe(201);
      const id = String(data(created.body).id);
      createdUserIds.push(id);
      return id;
    };
    const read = async (id: string) => {
      const one = await request(`/users?limit=200`, { headers: { Cookie: adminCookie } });
      const list = data(one.body) as Array<{ id: string; isActive: boolean; isLocked: boolean }>;
      return list.find((entry) => entry.id === id)!;
    };

    const fresh = await mk('fresh');
    const deactivated = await mk('deactivated');
    const locked = await mk('locked');

    expect((await read(fresh)).isLocked).toBe(false);

    await request(`/users/${deactivated}`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    const afterDeactivate = await read(deactivated);
    expect(afterDeactivate.isActive).toBe(false);
    expect(afterDeactivate.isLocked).toBe(false);

    await request(`/users/${locked}/lock`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: true, durationMinutes: 30 }),
    });
    const afterLock = await read(locked);
    expect(afterLock.isLocked).toBe(true);

    // Each state is reachable through its own filter.
    const idsFor = async (status: string) => {
      const filtered = await request(`/users?status=${status}&limit=200`, { headers: { Cookie: adminCookie } });
      expect(filtered.response.status, `status=${status} must be accepted`).toBe(200);
      // data() already unwraps the { data: [...] } envelope, so do not unwrap twice.
      return (data(filtered.body) as Array<{ id: string }>).map((entry) => entry.id);
    };

    expect(await idsFor('active')).toContain(fresh);
    expect(await idsFor('active')).not.toContain(deactivated);
    expect(await idsFor('inactive')).toContain(deactivated);
    expect(await idsFor('locked')).toContain(locked);
  }, 90000);

  it('FC-SEC-011: an opening balance reports the author, and the year reads cleanly', async () => {
    // TypeScript cannot catch a Prisma `select` naming a column that does not
    // exist, so an author join written against a non-existent `fullName` column
    // type-checked cleanly and then returned 500 for every caller. The only thing
    // that catches it is driving the endpoint.
    const adminCookie = await adminLogin();
    const items = await request('/items?limit=1', { headers: { Cookie: adminCookie } });
    const list = data(items.body) as Array<{ publicId: string }>;
    const item = list[0];
    expect(item?.publicId, 'the suite needs at least one item').toBeTruthy();
    const suffix = randomUUID().slice(0, 8);
    // A fresh year per run. setBalance deliberately does not overwrite createdBy on
    // update, so a leftover row from an earlier run keeps its old author (or null,
    // after that author was deleted) and this test would read a stale value rather
    // than the one it just wrote.
    const fiscalYear = 2100 + (Number.parseInt(suffix.slice(0, 4), 16) % 700);

    const set = await request('/opening-balances', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemPublicId: item.publicId, financialYear: fiscalYear, quantity: 4, unitCost: 1.25 }),
    });
    expect(set.response.status).toBe(200);

    const year = await request('/opening-balances/' + fiscalYear, { headers: { Cookie: adminCookie } });
    expect(year.response.status).toBe(200);
    const rows = year.body as Array<{ itemPublicId: string; createdBy: { username: string } | null }>;
    expect(Array.isArray(rows)).toBe(true);

    // The author is whoever made the call, not the administrator by default.
    const ours = rows.find((row) => row.itemPublicId === item.publicId);
    expect(ours, 'the balance just written must appear').toBeTruthy();
    expect(ours!.createdBy?.username).toBe(adminUsername);

    // Now the guarantee that matters: an author who is later deleted must not
    // break the read. This is the case that would have returned a 500 had the
    // relation been left as NO ACTION while `createdBy` was being written.
    const role = await request('/users/roles', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `MatrixBal_${suffix}`,
        permissions: ['opening-balances.create', 'opening-balances.view', 'items.view'],
      }),
    });
    expect(role.response.status).toBe(201);
    const roleId = String(data(role.body).id);
    createdRoleIds.push(roleId);

    const author = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_author_${suffix}`, password: PASSWORD, roleId }),
    });
    expect(author.response.status).toBe(201);
    const authorId = String(data(author.body).id);
    createdUserIds.push(authorId);

    const authorCookie = await login(`matrix_author_${suffix}`, PASSWORD);
    const second = await request('/items?limit=2', { headers: { Cookie: authorCookie } });
    const secondItem = (data(second.body) as Array<{ publicId: string }>)[1] ?? item;

    const byAuthor = await request('/opening-balances', {
      method: 'POST',
      headers: { Cookie: authorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemPublicId: secondItem.publicId, financialYear: fiscalYear + 1, quantity: 2, unitCost: 3 }),
    });
    expect(byAuthor.response.status).toBe(200);

    const beforeDelete = await request('/opening-balances/' + (fiscalYear + 1), { headers: { Cookie: adminCookie } });
    expect(beforeDelete.response.status).toBe(200);
    const authored = (beforeDelete.body as Array<{ itemPublicId: string; createdBy: { username: string } | null }>)
      .find((row) => row.itemPublicId === secondItem.publicId);
    expect(authored?.createdBy?.username).toBe(`matrix_author_${suffix}`);

    const removed = await request(`/users/${authorId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(removed.response.status).toBe(200);

    const after = await request('/opening-balances/' + (fiscalYear + 1), { headers: { Cookie: adminCookie } });
    expect(after.response.status).toBe(200);
    const survivor = (after.body as Array<{ itemPublicId: string; createdBy: unknown }>)
      .find((row) => row.itemPublicId === secondItem.publicId);
    expect(survivor, 'the balance must survive its author').toBeTruthy();
    expect(survivor!.createdBy).toBeNull();
  }, 120000);

  it('FC-SEC-013: holding users.* is enough to onboard someone, without being able to promote', async () => {
    // An Admin holds `users.*` and the IAM matrix showed it granted, yet creating
    // a user *with a role* returned 403 "Only SuperAdmin can manage roles and
    // permissions" — and the form always sends a role, so an Admin could not
    // onboard anyone. The grant was visible and inert.
    const superadminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);

    const adminUser = await request('/users', {
      method: 'POST',
      headers: { Cookie: superadminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_admin_${suffix}`, password: PASSWORD, roleName: 'Admin' }),
    });
    expect(adminUser.response.status).toBe(201);
    const adminId = String(data(adminUser.body).id);
    createdUserIds.push(adminId);

    const adminCookie = await login(`matrix_admin_${suffix}`, PASSWORD);
    const grants = data(await request('/users/permissions/me', { headers: { Cookie: adminCookie } }).then((r) => r.body));
    expect(grants.permissions).toContain('users.*');

    // Onboarding works for an Admin.
    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_hired_${suffix}`, password: PASSWORD, roleName: 'Operator' }),
    });
    expect(created.response.status, 'an Admin must be able to create a user with a role').toBe(201);
    const hiredId = String(data(created.body).id);
    createdUserIds.push(hiredId);
    expect(data(created.body).role.name).toBe('Operator');

    // ...but the two rules that actually protect the system replace the old
    // blanket SuperAdmin requirement: no minting a SuperAdmin, and no
    // self-promotion.
    const mintSuper = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_peer_${suffix}`, password: PASSWORD, roleName: 'SuperAdmin' }),
    });
    expect(mintSuper.response.status).toBe(403);
    expect(mintSuper.body?.message).toContain('Only SuperAdmin can grant the SuperAdmin role');

    const selfPromote = await request(`/users/${adminId}`, {
      method: 'PUT',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleName: 'SuperAdmin' }),
    });
    expect(selfPromote.response.status).toBe(403);
    expect(selfPromote.body?.message).toContain('your own role');

    // Role *management* stays SuperAdmin-only, and that is role management
    // rather than user management, so the permission key must not hand it out.
    const createRole = await request('/users/roles', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `MatrixRoleAdmin_${suffix}`, permissions: ['items.view'] }),
    });
    expect(createRole.response.status).toBe(403);
  }, 120000);
});
/**
 * F-48 - the user list could not answer "has this person ever signed in".
 *
 * `email`, `failedAttempts` and `mustChangePassword` all existed on the DTO and
 * were never rendered, and nothing recorded a last login, so an administrator
 * triaging an account had nothing to go on: a dormant account, an account that
 * has never been used, and an account someone keeps mistyping into all looked
 * identical in the list.
 *
 * The negative case is the one worth trusting. Asserting only that the field is
 * present would pass against a hardcoded value, so this requires a real
 * timestamp for an account that has signed in and null for one that has not.
 *
 * It deliberately spends no auth traffic. The auth traffic class allows 20
 * requests per 15 minutes and the seventeen tests above already come close to
 * that ceiling, so a login here would push the suite into 429s and the failure
 * would have nothing to do with the assertion. The signed-in account is
 * superadmin itself, whose session this run created.
 */
const f48RunStart = Date.now();

describe('F-48 last login is reported from the session table, not invented', () => {
  it('separates an account that has signed in from one that never has', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminCookie = await adminLogin();

    const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
    const viewerRole = data(roles.body).find((r: any) => r.name === 'Viewer');
    expect(viewerRole).toBeTruthy();

    // Created and never signed in. Creating a user is not an auth path, so this
    // costs nothing against the traffic class.
    const never = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `f48never_${suffix}`,
        password: PASSWORD,
        roleId: viewerRole.id,
        firstName: 'F48',
        lastName: 'Never',
        email: `f48never_${suffix}@example.test`,
      }),
    });
    expect(never.response.status).toBe(201);
    const neverId = String(data(never.body).id);
    createdUserIds.push(neverId);

    const list = await request('/users?limit=200', { headers: { Cookie: adminCookie } });
    expect(list.response.status).toBe(200);
    const rows = data(list.body) as any[];

    const signedIn = rows.find((r) => r.username === adminUsername);
    const neverRow = rows.find((r) => r.id === neverId);
    expect(signedIn, 'the signed-in account must appear in the list').toBeTruthy();
    expect(neverRow, 'the account that never signed in must appear in the list').toBeTruthy();

    expect(signedIn.lastLoginAt, 'an account that signed in must report when').toBeTruthy();
    const seen = new Date(signedIn.lastLoginAt).getTime();
    expect(Number.isNaN(seen), 'lastLoginAt must parse as a date').toBe(false);

    // Bounded by the run, so a stale or hardcoded timestamp cannot pass. The
    // lower bound is the start of the run rather than this test, because the
    // admin session is memoised from an earlier test.
    const now = Date.now();
    expect(seen).toBeGreaterThanOrEqual(f48RunStart - 60_000);
    expect(seen).toBeLessThanOrEqual(now + 60_000);

    // The negative case is what stops this being a constant.
    expect(neverRow.lastLoginAt, 'an account with no session must not report a login').toBeNull();

    // And the email the table now renders has to survive the mapper too.
    expect(neverRow.email).toBe(`f48never_${suffix}@example.test`);
  }, 120000);
});

/**
 * ا-٦ - the invitation flow could send, verify and accept, and none of it was
 * visible.
 *
 * An administrator who invited someone had no way to ask whether the invitation
 * was taken up. Worse, the stored `status` never changes on expiry, and both
 * verify and accept reject a past `expiresAt` — so an invitation that died
 * months ago is still recorded as "pending". A queue that returned that column
 * verbatim would present the dead ones as live, which is worse than having no
 * queue at all: it looks like an answer.
 *
 * So the derived status is held to three things at once: the stored row must
 * still say pending, the response must say expired, and the token must be
 * absent from the payload.
 */
describe('ا-٦ pending invitations can be seen, and an expired one is not called pending', () => {
  it('lists an outstanding invitation without exposing its token', async () => {
    const suffix = randomUUID().slice(0, 8);
    const email = `f48invite_${suffix}@example.test`;
    const adminCookie = await adminLogin();

    const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
    const viewerRole = data(roles.body).find((r: any) => r.name === 'Viewer');

    const sent = await request('/users/invite', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, roleId: viewerRole.id }),
    });
    expect(sent.response.status).toBe(201);
    const invitation = data(sent.body);

    // Asserting on the shape, not just truthiness. `String(undefined)` is the
    // string "undefined", which is truthy, so a missing field sails through a
    // `toBeTruthy()` and every later statement silently queries for nothing.
    const invitationId = String(invitation.invitationId ?? '');
    expect(invitationId, 'the invite must return the id it created').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // The real token, so "the token is not leaked" is a fact about a known
    // secret rather than a check for a key that happens to be missing.
    const link = String(invitation.invitationLink ?? '');
    const token = link.split('token=')[1] ?? '';
    expect(token.length, 'the invite must carry a token to test against').toBeGreaterThan(16);

    const list = await request('/users/invitations?status=pending', { headers: { Cookie: adminCookie } });
    expect(list.response.status).toBe(200);

    const rows = data(list.body) as any[];
    const found = rows.find((r) => r.email === email);
    expect(found, 'a freshly sent invitation must appear in the queue').toBeTruthy();
    expect(found.id).toBe(invitationId);
    expect(found.status).toBe('pending');

    // The token mints an account. Any holder of users.view could otherwise
    // create one, which is the opposite of what the list is for.
    const serialised = JSON.stringify(list.body);
    expect(serialised, 'the queue must never carry a bearer token').not.toContain(token);
    expect(serialised).not.toMatch(/"token"/);
    expect(found).not.toHaveProperty('token');

    // And the fields the UI needs are present, not just the absence of the
    // dangerous one.
    expect(found.role?.name).toBe('Viewer');
    expect(found.expiresAt).toBeTruthy();
    expect(found.createdAt).toBeTruthy();

    // Now the honesty case.
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(backdateInvitation(invitationId, longAgo), 'the fixture must be backdatable').toBe(true);

    const stored = readInvitationRow(invitationId);
    expect(stored, 'the stored row must be readable').toBeTruthy();
    expect(
      stored!.status,
      'nothing in the app moves the stored status, which is the whole point',
    ).toBe('pending');

    const afterExpiry = await request('/users/invitations?status=expired', { headers: { Cookie: adminCookie } });
    expect(afterExpiry.response.status).toBe(200);
    const expiredRows = data(afterExpiry.body) as any[];
    const expired = expiredRows.find((r) => r.email === email);
    expect(expired, 'an invitation past its expiry must be listed as expired').toBeTruthy();
    expect(expired.status).toBe('expired');
    expect(
      expired.storedStatus,
      'the divergence must be visible, not hidden behind the derived value',
    ).toBe('pending');

    // And it must be gone from the pending queue, or the two lists disagree.
    const stillPending = await request('/users/invitations?status=pending', { headers: { Cookie: adminCookie } });
    const pendingRows = data(stillPending.body) as any[];
    expect(
      pendingRows.find((r) => r.email === email),
      'an expired invitation must not remain in the pending queue',
    ).toBeFalsy();
  }, 120000);

  it('refuses the queue to a role that was not granted users.view', async () => {
    const adminCookie = await adminLogin();
    const suffix = randomUUID().slice(0, 8);

    // A custom role, not a trimmed built-in one. Trimming Viewer mutates a row
    // every other test in this file depends on, and the built-in role
    // definitions are reconciled at bootstrap, so the test would be racing that
    // repair: it passed or failed depending on who logged in next.
    const role = await request('/users/roles', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `MatrixQueueGuard_${suffix}`,
        permissions: ['dashboard.view'],
      }),
    });
    expect(role.response.status).toBe(201);
    const roleId = String(data(role.body).id);
    createdRoleIds.push(roleId);

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `matrix_noview_${suffix}`,
        password: PASSWORD,
        roleId,
        firstName: 'No',
        lastName: 'View',
      }),
    });
    expect(created.response.status).toBe(201);
    createdUserIds.push(String(data(created.body).id));

    const cookie = await login(`matrix_noview_${suffix}`, PASSWORD);
    const me = await request('/users/permissions/me', { headers: { Cookie: cookie } });
    expect(data(me.body).permissions).not.toContain('users.view');

    const queue = await request('/users/invitations', { headers: { Cookie: cookie } });
    expect(queue.response.status).toBe(403);
  }, 120000);
});
