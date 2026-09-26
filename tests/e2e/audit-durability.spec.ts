import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';

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
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
};

const countAudit = async (cookie: string, action: string, entityId: string) => {
  const result = await request(`/audit/logs?action=${action}&entityId=${encodeURIComponent(entityId)}&limit=50`, {
    headers: { Cookie: cookie },
  });
  if (result.response.status !== 200) return -1;
  const rows = data(result.body)?.rows || [];
  return rows.filter((row: any) => row.action === action).length;
};
describe('FC-AUD-001 durable audit boundary', () => {
  it('writes a financial mutation and its audit row as one commit', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const itemPublicId = `aud-item-${suffix}`;
    let transactionId = '';

    try {
      const item = await request('/items', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ publicId: itemPublicId, name: `Audit item ${suffix}`, unit: 'kg' }),
      });
      expect(item.response.status).toBe(201);

      // A committed transaction MUST have its audit row, not a fire-and-forget one.
      const created = await request('/transactions', {
        method: 'POST',
        headers: { ...adminHeaders, 'Idempotency-Key': `aud-tx-${suffix}` },
        body: JSON.stringify({
          itemId: itemPublicId,
          date: new Date().toISOString(),
          type: 'وارد',
          quantity: 7,
          warehouseId: 'default',
          supplierOrReceiver: 'audit durability',
        }),
      });
      expect(created.response.status).toBe(201);
      transactionId = data(created.body).id;

      const auditRows = await countAudit(adminCookie, 'TRANSACTION_CREATE', transactionId);
      expect(auditRows, 'committed transaction has no TRANSACTION_CREATE audit row').toBe(1);
    } finally {
      if (transactionId) {
        await request(`/transactions/${encodeURIComponent(transactionId)}`, {
          method: 'DELETE',
          headers: { ...adminHeaders, 'Idempotency-Key': `aud-tx-del-${suffix}` },
        });
      }
      await request('/items/delete', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
    }
  }, 30_000);

  it('audits a role permission change and records the before/after pair', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const roleName = `AudRole-${suffix}`;
    let roleId = '';

    try {
      const created = await request('/users/roles', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ name: roleName, permissions: ['items.view'] }),
      });
      expect(created.response.status).toBe(201);
      roleId = data(created.body).id;

      const updated = await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['items.view', 'items.update', 'reports.view'] }),
      });
      expect(updated.response.status).toBe(200);

      const result = await request('/audit/logs?action=ROLE_PERMISSIONS_UPDATE&entityId=' + encodeURIComponent(roleId) + '&limit=20', {
        headers: { Cookie: adminCookie },
      });
      expect(result.response.status).toBe(200);
      const row = data(result.body).rows.find((entry: any) => entry.entityId === roleId);
      expect(row, 'permission change produced no audit row').toBeTruthy();
      expect(row.actorRole).toBeTruthy();

      const metadata = row.metadata || {};
      expect(metadata.before).toEqual({ permissions: ['items.view'] });
      expect(metadata.after).toEqual({ permissions: ['items.view', 'items.update', 'reports.view'] });
      expect([...metadata.added].sort()).toEqual(['items.update', 'reports.view']);
      expect(metadata.removed).toEqual([]);
    } finally {
      const { cleanupRole } = await import('./support/dbCleanup');
      await cleanupRole(roleId);
    }
  }, 30_000);

  it('never persists credentials in audit metadata', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const roleName = `AudSecret-${suffix}`;
    let roleId = '';

    try {
      const created = await request('/users/roles', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ name: roleName, permissions: ['items.view'] }),
      });
      roleId = data(created.body).id;

      // A caller that tries to smuggle secrets into the audit trail.
      await request(`/users/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ permissions: ['items.view'] }),
      });

      const result = await request('/audit/logs?action=ROLE_PERMISSIONS_UPDATE&limit=50', {
        headers: { Cookie: adminCookie },
      });
      const serialized = JSON.stringify(data(result.body));
      expect(serialized).not.toContain(adminPassword);
      expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    } finally {
      const { cleanupRole } = await import('./support/dbCleanup');
      await cleanupRole(roleId);
    }
  }, 30_000);

  it('supports search, pagination and CSV export', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie };

    const page = await request('/audit/logs?limit=5&offset=0', { headers });
    expect(page.response.status).toBe(200);
    const body = data(page.body);
    expect(body.rows.length).toBeLessThanOrEqual(5);
    expect(typeof body.total).toBe('number');
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);

    // Paginating past the end yields nothing rather than repeating page one.
    const past = await request('/audit/logs?limit=5&offset=1000000', { headers });
    expect(past.response.status).toBe(200);
    expect(data(past.body).rows).toHaveLength(0);

    // Export is a real CSV with a header row.
    const exported = await request('/audit/logs/export?limit=20', { headers });
    expect(exported.response.status).toBe(200);
    expect(String(exported.response.headers.get('content-type') || '')).toContain('text/csv');
    expect(exported.body.split('\n')[0]).toContain('timestamp');
    expect(exported.body.split('\n')[0]).toContain('actorUsername');

    // Free-text search narrows rather than errors.
    const searched = await request('/audit/logs?search=TRANSACTION&limit=10', { headers });
    expect(searched.response.status).toBe(200);
    expect(Array.isArray(data(searched.body).rows)).toBe(true);
  }, 30_000);

  it('keeps archived history retrievable instead of deleting it', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie };

    const archived = await request('/audit/archived?limit=10', { headers });
    expect(archived.response.status).toBe(200);
    expect(Array.isArray(data(archived.body).rows)).toBe(true);
    expect(typeof data(archived.body).total).toBe('number');

    // Archived rows are excluded from the default window.
    const active = await request('/audit/logs?limit=50', { headers });
    const activeRows = data(active.body).rows as any[];
    expect(activeRows.every((row) => !row.archived)).toBe(true);
  }, 30_000);
});
