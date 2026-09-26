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

describe('stock adjustment and reconciliation', () => {
  it('applies a reason-bound adjustment exactly once and reconciles cache with ledger', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const publicId = `adjustment-item-${randomUUID()}`;
    const name = `Adjustment item ${randomUUID()}`;
    const year = new Date().getUTCFullYear();

    try {
      const created = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicId, name, unit: 'kg' }),
      });
      expect(created.response.status).toBe(201);

      const invalid = await request('/transactions/stock-adjustments', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `adjustment-invalid-${randomUUID()}` },
        body: JSON.stringify({
          itemId: publicId,
          date: new Date().toISOString(),
          quantity: '2',
          adjustmentDirection: 'INCREASE',
        }),
      });
      expect(invalid.response.status).toBe(400);

      const adjustmentPayload = {
        itemId: publicId,
        date: new Date().toISOString(),
        quantity: '3.5',
        adjustmentDirection: 'INCREASE',
        reason: 'Physical count correction',
        sourceReference: `COUNT-${randomUUID()}`,
      };
      const key = `adjustment-create-${randomUUID()}`;
      const first = await request('/transactions/stock-adjustments', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': key },
        body: JSON.stringify(adjustmentPayload),
      });
      const replay = await request('/transactions/stock-adjustments', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': key },
        body: JSON.stringify(adjustmentPayload),
      });
      const mismatch = await request('/transactions/stock-adjustments', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': key },
        body: JSON.stringify({ ...adjustmentPayload, quantity: '4' }),
      });

      expect(first.response.status).toBe(201);
      expect(replay.response.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(mismatch.response.status).toBe(409);
      expect(String((await findItemByName(cookie, name)).currentStock)).toBe('3.500');

      const reconciliation = await request(`/balances/reconciliation?financialYear=${year}`, {
        headers: { Cookie: cookie },
      });
      expect(reconciliation.response.status).toBe(200);
      expect(reconciliation.body.consistent).toBe(true);
      expect(reconciliation.body.mismatches).toEqual([]);

      const decrease = await request('/transactions/stock-adjustments', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `adjustment-decrease-${randomUUID()}` },
        body: JSON.stringify({
          ...adjustmentPayload,
          quantity: '1.25',
          adjustmentDirection: 'DECREASE',
          reason: 'Damaged units removed',
        }),
      });
      expect(decrease.response.status).toBe(201);
      expect(String((await findItemByName(cookie, name)).currentStock)).toBe('2.250');

      const finalReconciliation = await request(`/balances/reconciliation?financialYear=${year}`, {
        headers: { Cookie: cookie },
      });
      expect(finalReconciliation.body.consistent).toBe(true);
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicIds: [publicId] }),
      });
    }
  }, 15_000);
});
