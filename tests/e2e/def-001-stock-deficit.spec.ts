import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';

/**
 * DEF-001 — a stock deficit is a real, dated, resolvable fact.
 *
 * The behaviour under test is the one a naive "clamp the number" fix gets
 * wrong: the balance may never go negative, the movement may not be silently
 * rewritten, and incoming stock has to settle the outstanding debt before it
 * becomes spendable. The invariant checked here is
 *
 *     currentStock === ledgerNet + openDeficit
 */
const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, raw: text };
};

const data = (body: any) => body?.data ?? body;

const login = async () => {
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  expect(result.response.status).toBe(201);
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
};

const newItem = async (cookie: string) => {
  const suffix = randomUUID().slice(0, 8);
  const publicId = `def-${suffix}`;
  const created = await request('/items', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicId,
      name: `DEF-001 item ${suffix}`,
      code: `DEF-${suffix}`,
      unit: 'ton',
      category: 'raw',
      minLimit: '0',
      maxLimit: '999999999.999',
    }),
  });
  expect(created.response.status).toBe(201);
  return publicId;
};

const move = (cookie: string, itemId: string, type: string, quantity: string) => request('/transactions', {
  method: 'POST',
  headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
  body: JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    itemId,
    type,
    quantity,
    supplierOrReceiver: 'DEF-001',
  }),
});

const stockOf = async (cookie: string, itemId: string) => {
  const detail = await request(`/items/${itemId}`, { headers: { Cookie: cookie } });
  return String(data(detail.body).currentStock);
};

const openDeficits = async (cookie: string, itemId: string) => {
  const queue = await request(`/stock-deficits?itemId=${itemId}&status=OPEN&limit=100`, { headers: { Cookie: cookie } });
  return {
    count: queue.body?.openCount ?? 0,
    quantity: String(queue.body?.openQuantity ?? '0.000'),
    rows: (queue.body?.data ?? []) as any[],
  };
};

describe('DEF-001 stock deficit ledger', () => {
  it('clamps an over-issue at zero and records the shortfall as an alert', async () => {
    const cookie = await login();
    const item = await newItem(cookie);

    expect((await move(cookie, item, 'وارد', '10')).response.status).toBe(201);
    expect(await stockOf(cookie, item)).toBe('10.000');

    // Issue far more than exists. This used to persist -989.000.
    const over = await move(cookie, item, 'صادر', '999');
    expect([200, 201]).toContain(over.response.status);

    const balance = await stockOf(cookie, item);
    expect(balance, 'the balance must never go negative').toBe('0.000');

    const deficits = await openDeficits(cookie, item);
    expect(deficits.count, 'the shortfall must be visible, not swallowed').toBe(1);
    expect(deficits.quantity, '989 of the issue was unfulfilled').toBe('989.000');
    expect(deficits.rows[0]?.reason).toMatch(/exceeded the available balance/i);
  });

  it('settles outstanding debt with incoming stock before making it spendable', async () => {
    const cookie = await login();
    const item = await newItem(cookie);

    await move(cookie, item, 'وارد', '10');
    await move(cookie, item, 'صادر', '999');
    expect(await stockOf(cookie, item)).toBe('0.000');
    expect((await openDeficits(cookie, item)).quantity).toBe('989.000');

    // A receipt of 300 must pay down the debt, not become spendable stock.
    await move(cookie, item, 'وارد', '300');
    expect(await stockOf(cookie, item), 'the receipt settles debt, so the balance stays zero').toBe('0.000');

    const afterPartial = await openDeficits(cookie, item);
    expect(afterPartial.quantity, '989 - 300 = 689 remains outstanding').toBe('689.000');
    expect(afterPartial.count, 'the remainder must stay visible, not round to zero').toBe(1);

    // Now clear the debt completely; only the surplus becomes available.
    await move(cookie, item, 'وارد', '689');
    expect(await stockOf(cookie, item)).toBe('0.000');
    expect((await openDeficits(cookie, item)).quantity, 'the debt is fully settled').toBe('0.000');

    await move(cookie, item, 'وارد', '50');
    expect(await stockOf(cookie, item), 'with no debt, stock is finally spendable').toBe('50.000');
  });

  it('holds the invariant currentStock = ledgerNet + openDeficit throughout', async () => {
    const cookie = await login();
    const item = await newItem(cookie);

    const ledgerNet = async () => {
      const list = await request(`/transactions?itemId=${item}&limit=200`, { headers: { Cookie: cookie } });
      const rows: any[] = data(list.body) ?? [];
      return rows.reduce((sum, row) => {
        const quantity = Number(String(row.quantity));
        return ['وارد', 'مرتجع', 'انتاج'].includes(row.type) ? sum + quantity : sum - quantity;
      }, 0);
    };

    const steps: Array<[string, string]> = [
      ['وارد', '10'],
      ['صادر', '999'],
      ['وارد', '300'],
      ['صادر', '2'],
      ['وارد', '1000'],
    ];

    for (const [type, quantity] of steps) {
      await move(cookie, item, type, quantity);
      const stock = Number(await stockOf(cookie, item));
      const deficit = Number((await openDeficits(cookie, item)).quantity);
      const ledger = await ledgerNet();
      expect(
        stock,
        `after ${type} ${quantity}: balance ${stock} !== ledger ${ledger} + deficit ${deficit}`,
      ).toBeCloseTo(ledger + deficit, 3);
      expect(stock, 'the balance is never negative').toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses to write off a deficit without a real reason', async () => {
    const cookie = await login();
    const item = await newItem(cookie);
    await move(cookie, item, 'وارد', '5');
    await move(cookie, item, 'صادر', '50');

    const [deficit] = (await openDeficits(cookie, item)).rows;
    expect(deficit, 'a deficit must exist to resolve').toBeTruthy();

    const tooShort = await request(`/stock-deficits/${deficit.publicId}/write-off`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'oops' }),
    });
    expect(tooShort.response.status, 'a one-word reason is not an audit trail').toBe(400);

    const writtenOff = await request(`/stock-deficits/${deficit.publicId}/write-off`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Goods confirmed lost during the 2026-09 audit count' }),
    });
    expect(writtenOff.response.status).toBe(201);
    expect(writtenOff.body?.status).toBe('WRITTEN_OFF');
    expect((await openDeficits(cookie, item)).quantity, 'a written-off deficit stops counting as debt').toBe('0.000');
  });

  it('keeps the deficit queue private from an anonymous caller', async () => {
    const anonymous = await request('/stock-deficits?status=OPEN');
    expect(anonymous.response.status).toBe(401);
  });

  it('turns a concurrent write conflict into a retryable 409, not a 500', async () => {
    // FC-DEF-001 review found this: two over-issues for the same item at the same
    // moment collide under serialisable isolation, and the Postgres driver
    // adapter wraps P2034 in a DriverAdapterError. The old `error.code === 'P2034'`
    // check therefore never matched, so the write conflict escaped as a 500 and
    // told the client the server was broken. One movement succeeds and the other
    // must be a clean, retryable conflict - and neither may be silently lost.
    const cookie = await login();
    const item = await newItem(cookie);

    await move(cookie, item, 'وارد', '10');

    const issue = (key: string) => move(cookie, item, 'صادر', '200');
    const [first, second] = await Promise.all([issue(randomUUID()), issue(randomUUID())]);

    const statuses = [first.response.status, second.response.status].sort();
    // Either both serialise, or one is rejected as a retryable conflict. A 500
    // here means the conflict was not recognised.
    expect(statuses.every((code) => code === 200 || code === 201 || code === 409)).toBe(true);
    expect(statuses, 'a write conflict must never be reported as a server fault').not.toContain(500);

    // Whatever happened, the books must still balance. Both issues succeeding
    // means the ledger is 10 - 200 - 200 = -390; a 409 means one of them never
    // committed, so the ledger is 10 - 200 = -190.
    const balance = Number(await stockOf(cookie, item));
    const deficit = Number((await openDeficits(cookie, item)).quantity);
    expect(balance, 'the balance is never negative').toBeGreaterThanOrEqual(0);
    const committed = statuses.filter((code) => code === 200 || code === 201).length;
    const ledger = 10 - 200 * committed;
    expect(
      Math.abs(balance - (ledger + deficit)),
      `balance ${balance} != ledger ${ledger} + deficit ${deficit}`,
    ).toBeLessThan(0.001);
  });
});
