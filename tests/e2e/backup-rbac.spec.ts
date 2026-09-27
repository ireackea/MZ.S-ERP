import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';
import { cleanupFixtures } from './support/dbCleanup';

/**
 * Gate 1.1 — the backup surface was reachable by anyone with a session cookie.
 *
 * `BackupGuard` set `request.backupActor` and discarded the permissions
 * `verifyToken` had just read from the database. `RbacGuard`'s backupActor
 * branch then returned a hardcoded `['backup.*']`, and nine of the ten routes
 * carry no `JwtAuthGuard`, so `RbacGuard` was the only thing standing between a
 * signed-in Viewer and a full database dump — a dump that contains
 * `users.passwordHash`. The role was recorded on the actor and never enforced.
 *
 * The reason this went unnoticed: the only adversarial test in the repository
 * sends no cookie at all, and anonymous callers were correctly refused. The gap
 * was one level up, at a legitimate low-privilege session.
 *
 * This spec spends a single login. The auth traffic class allows 20 requests per
 * 15 minutes and the other suites come close to that ceiling, so a failure here
 * would be a rate limit reporting itself as an authorization result.
 */
const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  return { status: response.status, body: await response.text() };
};

const login = async (username: string, password: string): Promise<string> => {
  const response = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status, `login failed for ${username}`).toBe(201);
  return String(response.headers.get('set-cookie') || '').split(';')[0];
};

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const PASSWORD = 'BackupGate2026!';

afterAll(() => {
  cleanupFixtures(createdUserIds, createdRoleIds);
});

describe('gate 1.1 a low-privilege session cannot reach the backup surface', () => {
  it('refuses every backup route to a role with no backup.* grant', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminCookie = await login(adminUsername, adminPassword);

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `bkp_gate_${suffix}`,
        password: PASSWORD,
        roleName: 'Viewer',
        firstName: 'Backup',
        lastName: 'Gate',
      }),
    });
    expect(created.status).toBe(201);
    const userId = JSON.parse(created.body).id ?? JSON.parse(created.body).data?.id;
    createdUserIds.push(String(userId));

    const cookie = await login(`bkp_gate_${suffix}`, PASSWORD);

    // Establish the premise before asserting on it: this role really does hold
    // no backup grant. Without this, a later widening of the Viewer template
    // would make the whole spec pass for the wrong reason.
    const me = await request('/users/permissions/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const permissions: string[] = JSON.parse(me.body).data?.permissions ?? JSON.parse(me.body).permissions ?? [];
    expect(
      permissions.filter((entry) => entry.startsWith('backup')),
      'the premise of this test is that Viewer holds no backup grant',
    ).toEqual([]);

    // Read, write, and the destructive ones. The point is not that listing is
    // hidden while deleting is not — a dump contains every users.passwordHash, so
    // downloading one is as damaging as deleting one.
    //
    // Every path below is a real route in backup.controller.ts. An earlier draft
    // asserted 403 on two that do not exist as GETs and saw 404, which proves
    // nothing either way; a 404 must not be mistaken for a refusal.
    const routes: Array<{ method: string; path: string; label: string }> = [
      { method: 'GET', path: '/backup/list', label: 'list archives' },
      { method: 'GET', path: '/backup/storage-stats', label: 'read storage stats' },
      { method: 'GET', path: '/backup/download/some-id', label: 'download a database dump' },
      { method: 'POST', path: '/backup/full', label: 'create a full dump' },
      { method: 'POST', path: '/backup/inventory', label: 'create an inventory dump' },
      { method: 'POST', path: '/backup/config', label: 'create a config archive' },
      { method: 'POST', path: '/backup/restore', label: 'restore' },
      { method: 'POST', path: '/backup/schedule', label: 'set the schedule' },
      { method: 'DELETE', path: '/backup/some-id', label: 'delete an archive' },
      { method: 'POST', path: '/backups/full', label: 'legacy full dump' },
      { method: 'POST', path: '/backups/incremental', label: 'legacy incremental dump' },
    ];

    const notRefused: string[] = [];
    for (const route of routes) {
      const result = await request(route.path, {
        method: route.method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: route.method === 'GET' || route.method === 'DELETE' ? undefined : '{}',
      });
      if (result.status !== 403) {
        notRefused.push(`${route.method} ${route.path} (${route.label}) -> ${result.status}`);
      }
    }

    expect(
      notRefused,
      `a Viewer with no backup.* grant reached: ${notRefused.join('; ')}`,
    ).toEqual([]);
  }, 120000);

  it('still admits a role that does hold a backup grant, so the fix is not a blanket deny', async () => {
    // A guard that refuses everyone passes every test above. This is the
    // direction that matters for availability: the holder of backup.view must
    // still get in.
    const suffix = randomUUID().slice(0, 8);
    const adminCookie = await login(adminUsername, adminPassword);

    const role = await request('/users/roles', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `BkpGate_${suffix}`,
        permissions: ['dashboard.view', 'backup.view'],
      }),
    });
    expect(role.status).toBe(201);
    createdRoleIds.push(String(JSON.parse(role.body).id ?? JSON.parse(role.body).data?.id));

    const created = await request('/users', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `bkp_ok_${suffix}`,
        password: PASSWORD,
        roleId: JSON.parse(role.body).id ?? JSON.parse(role.body).data?.id,
        firstName: 'Backup',
        lastName: 'Allowed',
      }),
    });
    expect(created.status).toBe(201);
    createdUserIds.push(String(JSON.parse(created.body).id ?? JSON.parse(created.body).data?.id));

    const cookie = await login(`bkp_ok_${suffix}`, PASSWORD);
    const listed = await request('/backup/list', { headers: { Cookie: cookie } });
    expect(listed.status, 'a holder of backup.view must still be admitted').toBe(200);
  }, 120000);
});
