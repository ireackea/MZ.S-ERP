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

const data = (body: any) => body?.data ?? body;

describe('DATA-003 server-backed business domains', () => {
  it('persists partners, orders, and stocktaking with idempotent close and reopen', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const itemPublicId = `data-003-item-${suffix}`;
    const itemName = `Data 003 Item ${suffix}`;
    const partnerKey = `data-003-partner-${suffix}`;
    const orderKey = `data-003-order-${suffix}`;
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    let partnerId = '';
    let orderId = '';
    let sessionId = '';

    try {
      const partnerPayload = {
        name: `Data 003 Partner ${suffix}`,
        type: 'customer',
        phone: `010${suffix.slice(0, 8)}`,
      };
      const partner = await request('/partners', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': partnerKey },
        body: JSON.stringify(partnerPayload),
      });
      const partnerReplay = await request('/partners', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': partnerKey },
        body: JSON.stringify(partnerPayload),
      });
      expect(partner.response.status).toBe(201);
      expect(partnerReplay.response.status).toBe(201);
      expect(data(partnerReplay.body)).toEqual(data(partner.body));
      partnerId = data(partner.body).id;

      const item = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicId: itemPublicId, name: itemName, unit: 'kg' }),
      });
      expect(item.response.status).toBe(201);

      const orderPayload = {
        orderNumber: `DATA003-${suffix}`,
        type: 'sale',
        status: 'pending',
        partnerId,
        date: new Date().toISOString(),
        warehouseId: 'default',
        items: [{ itemId: itemPublicId, quantity: 2, unit: 'kg' }],
        totalAmount: 100,
      };
      const order = await request('/orders', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': orderKey },
        body: JSON.stringify(orderPayload),
      });
      const orderReplay = await request('/orders', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': orderKey },
        body: JSON.stringify(orderPayload),
      });
      expect(order.response.status).toBe(201);
      expect(orderReplay.response.status).toBe(201);
      expect(data(orderReplay.body)).toEqual(data(order.body));
      orderId = data(order.body).id;

      const completed = await request(`/orders/${encodeURIComponent(orderId)}/complete`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-complete-${suffix}` },
        body: JSON.stringify({ warehouseId: 'default' }),
      });
      expect(completed.response.status).toBe(201);
      expect(data(completed.body).status).toBe('completed');

      const createdSession = await request('/stocktaking', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-session-${suffix}` },
        body: JSON.stringify({ monthKey, warehouseId: 'default' }),
      });
      expect(createdSession.response.status).toBe(201);
      let session = data(createdSession.body);
      if (session.status === 'closed') {
        const reopenedExisting = await request(`/stocktaking/${encodeURIComponent(session.id)}/reopen`, {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': `data-003-existing-reopen-${suffix}` },
        });
        expect(reopenedExisting.response.status).toBe(201);
        session = data(reopenedExisting.body);
      }
      sessionId = session.id;

      const counted = await request(`/stocktaking/${encodeURIComponent(sessionId)}/entries`, {
        method: 'PUT',
        headers: { ...headers, 'Idempotency-Key': `data-003-entry-${suffix}` },
        body: JSON.stringify({ itemId: itemPublicId, actualCount: 5, notes: 'Physical count' }),
      });
      expect(counted.response.status).toBe(200);

      const conflicting = await request(`/stocktaking/${encodeURIComponent(sessionId)}/entries`, {
        method: 'PUT',
        headers: { ...headers, 'Idempotency-Key': `data-003-conflict-${suffix}` },
        body: JSON.stringify({ itemId: itemPublicId, actualCount: 6, notes: 'Second count' }),
      });
      expect(conflicting.response.status).toBe(200);
      const entryId = data(conflicting.body).entries.find((entry: any) => entry.itemId === itemPublicId).id;
      const resolved = await request(`/stocktaking/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/resolve`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-resolve-${suffix}` },
        body: JSON.stringify({ itemId: itemPublicId, actualCount: 5, notes: 'Approved count' }),
      });
      expect(resolved.response.status).toBe(201);

      const closed = await request(`/stocktaking/${encodeURIComponent(sessionId)}/close`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-close-${suffix}` },
        body: JSON.stringify({ archivedPdfName: 'count.pdf', archivedPdfMime: 'application/pdf', archivedPdfData: 'JVBERi0=' }),
      });
      expect(closed.response.status).toBe(201);
      expect(data(closed.body).status).toBe('closed');

      const itemAfterCount = await request(`/items?search=${encodeURIComponent(itemName)}&limit=100`, { headers });
      expect(itemAfterCount.response.status).toBe(200);
      const countedItem = data(itemAfterCount.body).find((item: any) => item.name === itemName);
      expect(Number(countedItem.currentStock)).toBe(5);

      const reopened = await request(`/stocktaking/${encodeURIComponent(sessionId)}/reopen`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-reopen-${suffix}` },
      });
      expect(reopened.response.status).toBe(201);
      expect(data(reopened.body).status).toBe('open');

      const closedAgain = await request(`/stocktaking/${encodeURIComponent(sessionId)}/close`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `data-003-close-again-${suffix}` },
        body: JSON.stringify({}),
      });
      expect(closedAgain.response.status).toBe(201);
      expect(data(closedAgain.body).status).toBe('closed');
    } finally {
      if (orderId) {
        await request(`/orders/${encodeURIComponent(orderId)}`, {
          method: 'DELETE',
          headers: { ...headers, 'Idempotency-Key': `data-003-order-delete-${suffix}` },
        });
      }
      await request('/items/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
      if (partnerId) {
        await request(`/partners/${encodeURIComponent(partnerId)}`, {
          method: 'DELETE',
          headers: { ...headers, 'Idempotency-Key': `data-003-partner-delete-${suffix}` },
        });
      }
    }
  }, 20_000);
});
