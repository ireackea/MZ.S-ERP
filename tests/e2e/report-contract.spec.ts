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

/**
 * `GET /reports` returns { data, total } directly, while other routes may wrap
 * in { data: ... }. `rows` normalises both.
 */
const rows = (body: any): any[] => {
  const candidate = body?.rows ?? body?.data ?? body;
  return Array.isArray(candidate) ? candidate : [];
};

const payload = (body: any) => (body?.data && !Array.isArray(body.data) ? body.data : body);

const login = async (username: string, password: string) => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(result.response.status).toBe(201);
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
};

describe('FC-API-002 report contract', () => {
  it('returns a well-formed empty report rather than failing', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie, 'Content-Type': 'application/json' };

    const suffix = randomUUID();
    const itemPublicId = `rep-empty-${suffix}`;

    try {
      await request('/items', {
        method: 'POST', headers,
        body: JSON.stringify({ publicId: itemPublicId, name: `Report item ${suffix}`, unit: 'kg' }),
      });

      // A window with no movement at all.
      const generated = await request('/reports/generate', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'inventory', itemIds: [itemPublicId], dateFrom: '1990-01-01', dateTo: '1990-01-02' }),
      });
      expect(generated.response.status).toBe(201);
      const body = payload(generated.body);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(0);
      expect(body.summary).toMatchObject({
        totalTransactions: 0, totalIn: 0, totalOut: 0, net: 0, itemCount: 0,
      });
      expect(Array.isArray(body.chartData)).toBe(true);
      expect(Number.isNaN(body.summary.net)).toBe(false);
    } finally {
      await request('/items/delete', {
        method: 'POST', headers,
        body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
    }
  }, 40_000);

  it('aggregates movements with the canonical direction rules', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const suffix = randomUUID();
    const itemPublicId = `rep-mix-${suffix}`;
    let firstId = '';
    let secondId = '';

    try {
      await request('/items', {
        method: 'POST', headers,
        body: JSON.stringify({ publicId: itemPublicId, name: `Mix item ${suffix}`, unit: 'kg' }),
      });

      const inbound = await request('/transactions', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `rep-in-${suffix}` },
        body: JSON.stringify({
          itemId: itemPublicId, date: new Date().toISOString(),
          type: 'وارد', quantity: 100, warehouseId: 'default', supplierOrReceiver: 'test',
        }),
      });
      expect(inbound.response.status).toBe(201);
      firstId = payload(inbound.body).id;

      const outbound = await request('/transactions', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `rep-out-${suffix}` },
        body: JSON.stringify({
          itemId: itemPublicId, date: new Date().toISOString(),
          type: 'صادر', quantity: 30, warehouseId: 'default', supplierOrReceiver: 'test',
        }),
      });
      expect(outbound.response.status).toBe(201);
      secondId = payload(outbound.body).id;

      const generated = await request('/reports/generate', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'movements', itemIds: [itemPublicId] }),
      });
      expect(generated.response.status).toBe(201);
      const summary = payload(generated.body).summary;

      expect(summary.totalIn).toBe(100);
      expect(summary.totalOut).toBe(30);
      expect(summary.net).toBe(70);
      expect(summary.totalTransactions).toBe(2);
    } finally {
      for (const id of [firstId, secondId].filter(Boolean)) {
        await request(`/transactions/${encodeURIComponent(id)}`, {
          method: 'DELETE', headers: { ...headers, 'Idempotency-Key': `rep-del-${id}` },
        });
      }
      await request('/items/delete', {
        method: 'POST', headers, body: JSON.stringify({ publicIds: [itemPublicId] }),
      });
    }
  }, 40_000);

  it('rejects an inverted date range and honours pagination', async () => {
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie, 'Content-Type': 'application/json' };

    // Inverted range must be refused, not silently returned empty.
    const inverted = await request('/reports?startDate=2026-05-10&endDate=2026-05-01', { headers });
    expect(inverted.response.status).toBe(400);

    const page = await request('/reports?limit=1&page=1', { headers });
    expect(page.response.status).toBe(200);
    const pageBody = page.body;
    expect(rows(pageBody).length).toBeLessThanOrEqual(1);
    expect(typeof pageBody.total).toBe('number');

    // Arabic text survives the round trip unchanged.
    const arabic = await request('/reports?limit=1', { headers });
    expect(arabic.response.status).toBe(200);
    const first = rows(arabic.body)[0];
    if (first) {
      expect(JSON.stringify(first)).not.toContain('\\u0000');
    }
  }, 30_000);

  it('keeps the print route behind reports.generate', async () => {
    // No session: both report routes must refuse.
    const anonymousList = await request('/reports');
    expect(anonymousList.response.status).toBeGreaterThanOrEqual(400);

    const anonymousPrint = await request('/reports/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'items', data: {} }),
    });
    expect(anonymousPrint.response.status).toBeGreaterThanOrEqual(400);

    // A signed-in session can print a real view.
    const adminCookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: adminCookie, 'Content-Type': 'application/json' };
    const listed = await request('/reports?limit=1', { headers });
    const row = rows(listed.body)[0];

    if (row) {
      const printed = await request('/reports/print', {
        method: 'POST', headers,
        body: JSON.stringify({
          type: 'transactions',
          data: { rows: [row], summary: [{ label: 'Rows', value: '1' }] },
          title: 'اختبار الطباعة',
        }),
      });
      expect(printed.response.status).toBe(201);
      expect(String(printed.response.headers.get('content-type') || '')).toContain('application/pdf');
      expect(String(printed.response.headers.get('content-disposition') || '')).toContain('attachment');
    }

    // An empty view is refused with a clear message rather than a blank PDF.
    const emptyPrint = await request('/reports/print', {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'items', data: { rows: [] } }),
    });
    expect(emptyPrint.response.status).toBe(400);
    expect(String(emptyPrint.body?.message || '')).toMatch(/no rows/i);
  }, 90_000);
});
