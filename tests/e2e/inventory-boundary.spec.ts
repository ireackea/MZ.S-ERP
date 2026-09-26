import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

type ApiResponse = {
  response: Response;
  body: any;
};

const request = async (path: string, options: RequestInit = {}): Promise<ApiResponse> => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
};

const login = async () => {
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

const findItemByName = async (cookie: string, name: string) => {
  const result = await request(`/items?search=${encodeURIComponent(name)}&limit=100`, {
    headers: { Cookie: cookie },
  });
  expect(result.response.status).toBe(200);
  return result.body.data.find((item: { name: string }) => item.name === name);
};

describe('inventory stock write boundary', () => {
  it('rejects currentStock on ordinary item and metadata write routes', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const publicId = `stock-boundary-${randomUUID()}`;
    const name = `Stock boundary ${randomUUID()}`;

    try {
      const created = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicId, name, unit: 'kg', currentStock: 99 }),
      });
      expect(created.response.status).toBe(400);

      const valid = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicId, name, unit: 'kg' }),
      });
      expect(valid.response.status).toBe(201);

      const updated = await request(`/items/${publicId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name, currentStock: 99 }),
      });
      expect(updated.response.status).toBe(400);

      const synced = await request('/items/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: [{ publicId, name, currentStock: 99 }] }),
      });
      expect(synced.response.status).toBe(400);

      const imported = await request('/items/import-excel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: [{ name, category: 'Test', unit: 'kg', currentStock: 99 }] }),
      });
      expect(imported.response.status).toBe(400);

      const item = await findItemByName(cookie, name);
      expect(String(item.currentStock)).toBe('0.000');
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicIds: [publicId] }),
      });
    }
  });

  it('applies concurrent ledger deltas exactly once and keeps update and delete atomic', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const publicId = `stock-concurrency-${randomUUID()}`;
    const name = `Stock concurrency ${randomUUID()}`;

    try {
      const created = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicId, name, unit: 'kg' }),
      });
      expect(created.response.status).toBe(201);

      const transactionPayload = {
        itemId: publicId,
        date: new Date().toISOString().slice(0, 10),
        type: 'وارد',
        quantity: '2.5',
        supplierOrReceiver: 'stock-boundary-test',
        warehouseInvoice: `STOCK-${randomUUID()}`,
      };
      const [first, second] = await Promise.all([
        request('/transactions', {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': `stock-create-${randomUUID()}` },
          body: JSON.stringify(transactionPayload),
        }),
        request('/transactions', {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': `stock-create-${randomUUID()}` },
          body: JSON.stringify(transactionPayload),
        }),
      ]);

      expect(first.response.status).toBe(201);
      expect(second.response.status).toBe(201);
      expect(String((await findItemByName(cookie, name)).currentStock)).toBe('5.000');

      const transactionId = first.body.id;
      const updated = await request(`/transactions/${transactionId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Idempotency-Key': `stock-update-${randomUUID()}` },
        body: JSON.stringify({ quantity: '4' }),
      });
      expect(updated.response.status).toBe(200);
      expect(String((await findItemByName(cookie, name)).currentStock)).toBe('6.500');

      const deleted = await request(`/transactions/${transactionId}`, {
        method: 'DELETE',
        headers: { ...headers, 'Idempotency-Key': `stock-delete-${randomUUID()}` },
      });
      expect(deleted.response.status).toBe(200);
      expect(String((await findItemByName(cookie, name)).currentStock)).toBe('2.500');
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicIds: [publicId] }),
      });
    }
  });
});
