import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as adminPassword, e2eUsername as adminUsername } from './support/runtimeConfig';

/**
 * FC-DATA-001 — the wire contract must not lose a single digit.
 *
 * The failure this guards against is silent: a float like 0.1 + 0.2 stores as
 * 0.30000000000000004, and a JSON response renders it as an exponent, so the
 * ledger stops balancing without any error being raised.
 */
const request = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${backendUrl}/api${path}`, options);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, raw: text };
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

/** FC-DATA-001: `currentStock` is server-derived, and `publicId` is required. */
const createItem = async (cookie: string, label: string) => {
  const created = await request('/items', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicId: `d001-${label}-${randomUUID()}`,
      name: `DATA-001 ${label} ${randomUUID()}`,
      code: `D001-${label}-${randomUUID().slice(0, 8)}`,
      unit: 'ton',
      category: 'raw',
      minLimit: '0',
      maxLimit: '999999999.999',
    }),
  });
  expect(created.response.status, `item ${label} must be created`).toBe(201);
  return data(created.body);
};

const MONEY_FIELDS = ['supplierNet', 'difference', 'packageCount', 'salaryOfWorker', 'delayPenalty', 'calculatedFine'];

/** Exponent notation is never a valid decimal response value. */
const assertNoExponent = (value: string, label: string) => {
  expect(value, `${label} must not use exponent notation`).not.toMatch(/e/i);
  expect(value, `${label} must be a plain decimal string`).toMatch(/^-?\d+(\.\d+)?$/);
};

describe('FC-DATA-001 decimal-safe API contract', () => {
  it('echoes a string quantity back exactly, with no float drift', async () => {
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'item');
    expect(typeof item.publicId, 'the item must expose a string publicId').toBe('string');

    const tx = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: item.publicId,
        type: 'وارد',
        quantity: '0.1',
        supplierNet: '0.2',
        difference: '0',
        packageCount: '1',
        supplierOrReceiver: 'DATA-001 supplier',
      }),
    });
    expect([200, 201]).toContain(tx.response.status);
    const saved = data(tx.body);

    // The stored quantity must be exactly what was sent, at the schema scale.
    // '0.100' is 0.1 — '0.09999999999999998' is what a float would produce.
    expect(String(saved.quantity)).toBe('0.100');
    assertNoExponent(String(saved.quantity), 'quantity');
    expect(String(saved.supplierNet)).toBe('0.200');
    assertNoExponent(String(saved.supplierNet), 'supplierNet');

    // A read-back through the list endpoint must be identical, so the
    // serialization boundary is stable and not per-handler.
    const list = await request('/transactions?limit=200', { headers: { Cookie: cookie } });
    expect(list.response.status).toBe(200);
    const rows: any[] = data(list.body) ?? [];
    const found = rows.find((row) => row.id === saved.id);
    expect(found, 'the created transaction must be listed').toBeTruthy();
    expect(String(found.quantity)).toBe('0.100');
    assertNoExponent(String(found.quantity), 'listed quantity');
  });

  it('rejects a non-integer JS float instead of silently rounding it', async () => {
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'float-item');

    // 0.1 + 0.2 in JavaScript. Accepting this would persist 0.30000000000000004.
    const tx = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: item.publicId,
        type: 'وارد',
        quantity: 0.1 + 0.2,
        supplierOrReceiver: 'DATA-001 float',
      }),
    });
    expect(tx.response.status, 'a drifting float must be refused with 400').toBe(400);

    const message = JSON.stringify(tx.body);
    expect(message).toMatch(/string|decimal|precision|send decimals as strings/i);
  });

  it('keeps the ledger balanced across a full day of movements', async () => {
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'ledger-item');
    const today = new Date().toISOString().slice(0, 10);

    // Ten receipts of 0.1 and three issues of 0.3. In binary floating point
    // 10 * 0.1 = 0.9999999999999999, so this only balances under Decimal.
    const post = async (type: string, quantity: string) => {
      const result = await request('/transactions', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({
          date: today,
          itemId: item.publicId,
          type,
          quantity,
          supplierOrReceiver: `DATA-001 ${type}`,
        }),
      });
      expect([200, 201], `${type} ${quantity} must be accepted`).toContain(result.response.status);
      return data(result.body);
    };

    for (let i = 0; i < 10; i += 1) await post('وارد', '0.1');
    for (let i = 0; i < 3; i += 1) await post('صادر', '0.3');

    const detail = await request(`/items/${item.publicId}`, { headers: { Cookie: cookie } });
    expect(detail.response.status).toBe(200);
    const stock = data(detail.body);
    const onHand = String(stock.currentStock);
    assertNoExponent(onHand, 'currentStock');
    expect(onHand, '10 x 0.1 minus 3 x 0.3 must leave exactly 0.1, not 0.09999999999999998').toBe('0.100');
  });

  it('rejects a value that exceeds the declared maximum', async () => {
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'max-item');

    const tx = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: item.publicId,
        type: 'وارد',
        // DECIMAL_MAX is 999999999.999, so this is one order of magnitude over.
        quantity: '1000000000',
        supplierOrReceiver: 'DATA-001 overflow',
      }),
    });
    expect(tx.response.status, 'an out-of-range quantity must be refused').toBe(400);
  });

  it('serializes every money field on a transaction as a decimal string', async () => {
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'money-item');

    const money: Record<string, string> = {
      supplierNet: '1234.5',
      difference: '0.001',
      packageCount: '2.5',
      salaryOfWorker: '99.99',
      delayPenalty: '0.005',
      calculatedFine: '10.1',
    };

    const tx = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        itemId: item.publicId,
        type: 'وارد',
        quantity: '5',
        supplierOrReceiver: 'DATA-001 money',
        ...money,
      }),
    });
    expect([200, 201]).toContain(tx.response.status);
    const saved = data(tx.body);

    for (const field of MONEY_FIELDS) {
      const value = saved[field];
      expect(value, `${field} must be present on the response`).not.toBeUndefined();
      assertNoExponent(String(value), field);
      // A JSON number here would mean a float escaped the boundary.
      expect(typeof value, `${field} must serialize as a string`).toBe('string');
    }
    expect(String(saved.quantity)).toBe('5.000');
  });

  it('corrects a quantity without leaving a float residue on the ledger', async () => {
    // FC-CERTIFY-001 found this: the update path computed the stock correction
    // as `newDelta - oldDelta` in a float, so correcting 0.1 to 0.7 left
    // 0.5999999999999999 instead of 0.6.
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'update-path');

    const created = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ date: new Date().toISOString().slice(0, 10), itemId: item.publicId, type: 'وارد', quantity: '0.1', supplierOrReceiver: 'DATA-001 update' }),
    });
    expect([200, 201], `the movement must be accepted, got ${created.response.status}: ${created.raw}`).toContain(created.response.status);
    // A transaction is addressed by its `id` on the response; there is no
    // publicId on this payload.
    const transactionId = data(created.body).id;
    expect(typeof transactionId, 'the created transaction must expose an id').toBe('string');

    const corrected = await request(`/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ quantity: '0.7' }),
    });
    expect(corrected.response.status, 'the correction must be accepted').toBe(200);

    const detail = await request(`/items/${item.publicId}`, { headers: { Cookie: cookie } });
    const onHand = String(data(detail.body).currentStock);
    assertNoExponent(onHand, 'currentStock after correction');
    expect(onHand, '0.1 corrected to 0.7 must leave exactly 0.7').toBe('0.700');
  });

  it('accepts the payload the operations screen actually builds', async () => {
    // The regression this card could not catch: every other test posted a
    // hand-written payload, so the fact that the screen built `Number(quantity)`
    // was invisible until an operator entered 10.5 and got a 400. These values
    // are exactly what the screen produces now that it uses toApiDecimal: the
    // strings the operator typed, passed through untouched.
    const cookie = await login(adminUsername, adminPassword);
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const item = await createItem(cookie, 'screen-payload');

    const screenRow = {
      date: new Date().toISOString().slice(0, 10),
      itemId: item.publicId,
      type: 'وارد',
      quantity: '10.5',
      supplierNet: '125.75',
      difference: '-115.25',
      packageCount: '3',
      delayPenalty: '0.005',
      calculatedFine: '10.1',
      supplierOrReceiver: 'DATA-001 screen',
    };

    const bulk = await request('/transactions/bulk', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ transactions: [screenRow] }),
    });
    expect([200, 201], `bulk failed: ${bulk.raw}`).toContain(bulk.response.status);
    const bulkRows = data(bulk.body)?.data ?? data(bulk.body);
    expect(String(Array.isArray(bulkRows) ? bulkRows[0]?.quantity : bulkRows?.quantity)).toBe('10.500');

    // A single posting of a value the operator typed with three decimals.
    const single = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ ...screenRow, quantity: '0.1', supplierNet: undefined, difference: undefined, packageCount: undefined, delayPenalty: undefined, calculatedFine: undefined }),
    });
    expect([200, 201], `single failed: ${single.raw}`).toContain(single.response.status);
    expect(String(data(single.body).quantity)).toBe('0.100');

    const stock = await request(`/items/${item.publicId}`, { headers: { Cookie: cookie } });
    expect(String(data(stock.body).currentStock), '10.5 + 0.1 through the UI path').toBe('10.600');
  });
});
