import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';
import { cleanupRole, cleanupUser } from './support/dbCleanup';

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

const login = async (username: string, password: string) => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(result.response.status).toBe(201);
  const cookie = String(result.response.headers.get('set-cookie') || '').split(';')[0];
  expect(cookie).toContain('feed_factory_jwt=');
  return cookie;
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

afterAll(() => {
  for (const id of createdUserIds) cleanupUser(id);
  for (const id of createdRoleIds) cleanupRole(id);
});

describe('FC-SEC-005 role matrix as a non-wildcard session', () => {
  it('never issues a wildcard grant to a built-in non-superadmin role', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
    expect(roles.response.status).toBe(200);

    for (const role of data(roles.body)) {
      if (role.name === 'SuperAdmin') continue;
      expect(role.permissionsList).not.toContain('*');
    }
  });

  it('a built-in role session actually holds the grants its definition claims', async () => {
    // The drift this catches: prisma/seed.ts shipped a narrower list than
    // role-templates.ts and the app never reconciled it, so Manager/Operator/
    // Viewer held no dashboard.view and no stocktaking access. Every previous
    // spec logged in as superadmin and therefore could not see it.
    const adminCookie = await login(adminUsername, adminPassword);
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
    const adminCookie = await login(adminUsername, adminPassword);
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
    const adminCookie = await login(adminUsername, adminPassword);
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
    const adminCookie = await login(adminUsername, adminPassword);
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
    const adminCookie = await login(adminUsername, adminPassword);
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
    const adminCookie = await login(adminUsername, adminPassword);
    const suffix = randomUUID().slice(0, 8);

    const result = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `matrix_weak_${suffix}`, password: '12345678', roleName: 'Viewer' }),
    });
    expect(result.response.status).toBe(400);
  });
});
