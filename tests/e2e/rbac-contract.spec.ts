import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';
import { cleanupRole } from './support/dbCleanup';

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

describe('FC-SEC-002 single permission catalog and RBAC contract', () => {
  it('serves the catalog and rejects unknown permissions on role updates', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();

    // 1. The catalog is served and every entry is documented.
    const catalog = await request('/auth/permissions', { headers: { Cookie: adminCookie } });
    expect(catalog.response.status).toBe(200);
    const entries = data(catalog.body).permissions as any[];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThanOrEqual(50);
    expect(data(catalog.body).total).toBe(entries.length);

    for (const entry of entries) {
      expect(entry.id).toMatch(/^[a-z-]+(\.[a-z_]+)+$/);
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(Boolean(entry.route) || entry.apiOnly === true).toBe(true);
      expect(entry.id.startsWith(`${entry.module}.`)).toBe(true);
    }
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);

    // 2. A role can be created with valid catalog permissions.
    const roleName = `SecRole-${suffix}`;
    const created = await request('/users/roles', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: roleName, permissions: ['items.view', 'transactions.view'] }),
    });
    expect(created.response.status).toBe(201);
    const roleId = data(created.body).id;

    try {
      // 3. An unknown permission is rejected, not silently stored.
      const rejected = await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['items.view', 'items.teleport'] }),
      });
      expect(rejected.response.status).toBe(400);
      expect(String(rejected.body?.message || '')).toContain('items.teleport');

      // 4. A module wildcard is accepted only for a real module.
      const badWildcard = await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['ghosts.*'] }),
      });
      expect(badWildcard.response.status).toBe(400);

      // 5. Valid updates are accepted and reflected in GET /users/roles.
      const accepted = await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['items.view', 'items.*', 'reports.view'] }),
      });
      expect(accepted.response.status).toBe(200);

      const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
      expect(roles.response.status).toBe(200);
      const stored = (data(roles.body) as any[]).find((role) => role.id === roleId);
      expect([...stored.permissionsList].sort()).toEqual(['items.*', 'items.view', 'reports.view']);
    } finally {
      // There is no DELETE /users/roles/:id route, so drop the fixture directly.
      await cleanupRole(roleId);
    }
  }, 30_000);

  it('migrates a legacy permission id on write and refuses unknown ones', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const roleName = `SecLegacy-${suffix}`;
    let roleId = '';

    try {
      const created = await request('/users/roles', {
        method: 'POST',
        headers: adminHeaders,
        // 'settings.view' is a legacy id; it must be stored as 'settings.view.general'.
        body: JSON.stringify({ name: roleName, permissions: ['settings.view', 'inventory.view.items'] }),
      });
      expect(created.response.status).toBe(201);
      roleId = data(created.body).id;

      const roles = await request('/users/roles', { headers: { Cookie: adminCookie } });
      const stored = (data(roles.body) as any[]).find((role) => role.id === roleId);
      expect([...stored.permissionsList].sort()).toEqual(['items.view', 'settings.view.general']);

      // A legacy id paired with a genuinely unknown id must still be rejected.
      const rejected = await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['settings.view', 'items.teleport'] }),
      });
      expect(rejected.response.status).toBe(400);
      expect(String(rejected.body?.message || '')).toContain('items.teleport');
    } finally {
      await cleanupRole(roleId);
    }
  }, 30_000);

  it('enforces catalog permissions end to end for a limited role', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const username = `sec-role-user-${suffix}`;
    const password = `Aa1!${suffix}Pass`;
    let userId = '';

    try {
      const created = await request('/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ username, password, roleName: 'Viewer', isActive: true }),
      });
      expect(created.response.status).toBe(201);
      userId = data(created.body).id;

      const viewerCookie = await login(username, password);
      const viewerHeaders = { Cookie: viewerCookie, 'Content-Type': 'application/json' };

      // Viewer may read.
      expect((await request('/items', { headers: viewerHeaders })).response.status).toBe(200);

      // Viewer may not create — enforced by the catalog permission.
      const denied = await request('/items', {
        method: 'POST',
        headers: viewerHeaders,
        body: JSON.stringify({ publicId: `sec-${suffix}`, name: 'denied', unit: 'kg' }),
      });
      expect(denied.response.status).toBe(403);

      // A permission the viewer does not hold is refused with a clear message.
      expect(String(denied.body?.message || '')).toMatch(/Insufficient permissions/i);
    } finally {
      if (userId) {
        await request(`/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: adminHeaders,
        });
      }
    }
  }, 30_000);
});
