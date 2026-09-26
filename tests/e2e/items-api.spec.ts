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

describe('API-001 official item CRUD contract', () => {
  it('creates, reads, updates, paginates, and rejects unsupported fields', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const publicId = `api-001-item-${randomUUID()}`;
    const name = `API 001 item ${randomUUID()}`;

    try {
      const payload = {
        publicId,
        name,
        code: `API001-${randomUUID()}`,
        barcode: `BAR-${randomUUID()}`,
        unit: 'kg',
        category: 'API001',
        minLimit: 1,
        maxLimit: 10,
        packageWeight: 2.5,
        description: 'Canonical item contract',
      };
      const created = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      expect(created.response.status).toBe(201);
      expect(data(created.body).publicId).toBe(publicId);

      const rejected = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, publicId: `${publicId}-invalid`, currentStock: 99 }),
      });
      expect(rejected.response.status).toBe(400);

      const fetched = await request(`/items/${encodeURIComponent(publicId)}`, { headers });
      expect(fetched.response.status).toBe(200);
      expect(data(fetched.body).name).toBe(name);

      const updated = await request(`/items/${encodeURIComponent(publicId)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: `${name} updated`,
          code: payload.code,
          unit: 'kg',
          category: 'API001',
          minLimit: 2,
          maxLimit: 12,
          description: 'Updated canonical item',
        }),
      });
      expect(updated.response.status).toBe(200);
      expect(data(updated.body).publicId).toBe(publicId);
      expect(data(updated.body).name).toBe(`${name} updated`);

      const listed = await request(`/items?search=${encodeURIComponent(name)}&page=1&limit=20`, { headers });
      expect(listed.response.status).toBe(200);
      expect(listed.body.data.some((item: any) => item.publicId === publicId)).toBe(true);
    } finally {
      await request('/items/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ publicIds: [publicId] }),
      });
    }
  }, 20_000);
});
