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

describe('phase 1 security and idempotency', () => {
  it('replays a bulk transaction with the same key without duplicating it', async () => {
    const cookie = await login();
    const publicId = `phase1-item-${randomUUID()}`;
    const key = `phase1-key-${randomUUID()}`;
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await request('/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ publicId, name: 'Phase 1 test item', unit: 'kg', category: 'Phase1Test' }),
    });
    expect(item.response.status).toBe(201);

    const payload = {
      transactions: [{
        itemId: publicId,
        date: new Date().toISOString().slice(0, 10),
        type: 'وارد',
        quantity: 1,
        supplierOrReceiver: 'phase1-test',
        warehouseInvoice: `PH1-${randomUUID()}`,
      }],
    };
    const first = await request('/transactions/bulk', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    const second = await request('/transactions/bulk', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);

    const transactionId = first.body.data[0].id;
    const deleteKey = `${key}-delete`;
    const firstDelete = await request('/transactions/delete', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': deleteKey },
      body: JSON.stringify({ ids: [transactionId] }),
    });
    const secondDelete = await request('/transactions/delete', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': deleteKey },
      body: JSON.stringify({ ids: [transactionId] }),
    });
    expect(firstDelete.response.status).toBe(201);
    expect(secondDelete.response.status).toBe(201);
    expect(secondDelete.body).toEqual(firstDelete.body);

    await request('/items/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ publicIds: [publicId] }),
    });
  }, 15_000);

  it('renders a valid bounded PDF with the container Chromium', async () => {
    const cookie = await login();
    const response = await fetch(`${backendUrl}/api/render-pdf`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<!doctype html><html><body><h1>Phase 1 PDF</h1></body></html>' }),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  }, 15_000);

  it('revokes the server session on logout', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const before = await request('/auth/me', { headers });
    expect(before.response.status).toBe(200);
    const logout = await request('/auth/logout', { method: 'POST', headers });
    expect(logout.response.status).toBe(201);
    const after = await request('/auth/me', { headers });
    expect(after.response.status).toBe(401);
  });
});
