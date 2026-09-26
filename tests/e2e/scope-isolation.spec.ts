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
const rows = (body: any) => Array.isArray(data(body)) ? data(body) : (Array.isArray(body?.data) ? body.data : []);

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

describe('SEC-001 server-side scope isolation', () => {
  it('does not let a manager read or mutate another warehouse transaction', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const adminHeaders = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const username = `scope-manager-${suffix}`;
    const password = `Aa1!${suffix}Pass`;
    const itemPublicId = `scope-item-${suffix}`;
    let userId = '';
    let transactionId = '';

    try {
      const user = await request('/users', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ username, password, roleName: 'Manager', isActive: true }),
      });
      expect(user.response.status).toBe(201);
      userId = data(user.body).id;

      const item = await request('/items', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ publicId: itemPublicId, name: `Scope item ${suffix}`, unit: 'kg' }),
      });
      expect(item.response.status).toBe(201);

      const transaction = await request('/transactions', {
        method: 'POST',
        headers: { ...adminHeaders, 'Idempotency-Key': `scope-transaction-${suffix}` },
        body: JSON.stringify({
          itemId: itemPublicId,
          date: new Date().toISOString(),
          type: 'وارد',
          quantity: 4,
          warehouseId: 'warehouse_b',
          supplierOrReceiver: 'scope isolation',
        }),
      });
      expect(transaction.response.status).toBe(201);
      transactionId = data(transaction.body).id;

      const managerCookie = await login(username, password);
      const managerHeaders = { Cookie: managerCookie, 'Content-Type': 'application/json' };
      const list = await request('/transactions?limit=100', { headers: managerHeaders });
      expect(list.response.status).toBe(200);
      expect(rows(list.body).some((row: any) => row.id === transactionId)).toBe(false);

      const read = await request(`/transactions/${encodeURIComponent(transactionId)}`, { headers: managerHeaders });
      expect(read.response.status).toBe(404);

      const report = await request('/reports', { headers: managerHeaders });
      expect(report.response.status).toBe(200);
      expect(rows(report.body).some((row: any) => row.id === transactionId)).toBe(false);
    } finally {
      if (transactionId) {
        await request(`/transactions/${encodeURIComponent(transactionId)}`, {
          method: 'DELETE',
          headers: { ...adminHeaders, 'Idempotency-Key': `scope-transaction-delete-${suffix}` },
        });
      }
      await request('/items/delete', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
      if (userId) {
        await request(`/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: adminHeaders,
        });
      }
    }
  }, 20_000);
});
