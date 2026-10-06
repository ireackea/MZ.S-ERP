import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * The order an operator arranged must survive.
 *
 * "حفظ ترتيب الأصناف" was built for a specific reason: rows imported from a
 * spreadsheet come in a deliberate order, and that order has to stay. It did not
 * work, and nothing noticed. The import wrote no `sortOrder`, so every imported
 * row took the same column default of 1000000, and the read path broke that tie
 * by **name**. A catalogue arranged by hand came back A-Z — and the import
 * reported success, because the rows were created; only their order was wrong.
 *
 * So this file asserts the order itself, not the row count. A test that checked
 * "20 items imported" passes against the broken behaviour, which is exactly why
 * the gap survived so long.
 *
 * Every item here is created with a name that sorts the *opposite* way to its
 * intended position. The order only survives if it came from the file, never from
 * the alphabet.
 */

const psql = (sql: string): string =>
  execFileSync(
    'docker',
    [
      'compose', '-f', `${process.cwd()}\\docker-compose.yml`,
      'exec', '-T', 'postgres',
      'psql', '-U', process.env.POSTGRES_USER || 'feedfactory',
      '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      '-At', '-F', '|', '-c', sql,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  ).trim();

const request = async (path: string, options: RequestInit = {}) => {
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
  expect(result.response.status, 'login failed').toBe(201);
  return String(result.response.headers.get('set-cookie') || '').split(';')[0];
};

const data = (body: any) => body?.data ?? body;

/**
 * Probes are identified by their *category*, not by their publicId.
 *
 * The import service assigns `item-${randomUUID()}` itself and ignores anything
 * the caller sent, so a publicId prefix cannot be used to find these rows — the
 * first version of this file filtered on one and found nothing, and reported
 * "the import lost the rows" when the import was fine.
 *
 * A category is also what makes cleanup safe. A cleanup that matches a wildcard
 * against a column an operator controls deletes real rows: an earlier version of
 * the sibling spec used `ord-%` on publicId and removed an item whose publicId
 * happened to be `ord-1790474627269`.
 */
const PROBE_CATEGORY = 'zz-e2e-order-probe';
const PROBE_CODE_PREFIX = 'zz-e2e-order-imp-';

const isProbe = (item: { category?: string }) => item.category === PROBE_CATEGORY;

const cleanup = () => {
  psql(`DELETE FROM "Item" WHERE category = '${PROBE_CATEGORY}';`);
};

afterAll(() => {
  try { cleanup(); } catch { /* best effort; the next run sweeps too */ }
});

describe('ITEM-003 the catalog order is the one the operator arranged', () => {
  it('an import keeps the row order of the file, not the alphabet', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    // Twelve rows, named so that alphabetical order is the *reverse* of the
    // order they are sent in. If anything sorts by name, this test fails loudly
    // instead of passing by coincidence.
    const intended = Array.from({ length: 12 }, (_, index) => {
      const seq = String(index + 1).padStart(2, '0');
      return {
        name: `صنف ${String.fromCharCode(90 - index)} ${seq}`,
        code: `${PROBE_CODE_PREFIX}${seq}-${randomUUID().slice(0, 6)}`,
        category: PROBE_CATEGORY,
        unit: 'kg',
      };
    });

    const imported = await request('/items/import-excel', {
      method: 'POST',
       headers: { ...headers, 'Idempotency-Key': `w3-import-${randomUUID()}` },
      body: JSON.stringify({ items: intended.map((row, index) => ({ ...row, sourceRow: index + 2 })) }),
    });

    expect(
      imported.response.status,
      `import must succeed: ${JSON.stringify(imported.body).slice(0, 400)}`,
    ).toBe(201);

    const created = data(imported.body);
    const results = (created.results ?? created) as Array<{ publicId: string; name: string; status: string }>;
    expect(results.length, 'every row must be created').toBe(intended.length);
    expect(results.every((row) => row.status === 'created')).toBe(true);

    // The response order already matches the file. That is necessary but not
    // sufficient — the same array was correct before this fix, while the database
    // was not.
    expect(results.map((row) => row.name)).toEqual(intended.map((row) => row.name));

    // Now the part that was broken: what the list endpoint hands back.
    const list = await request('/items?page=1&limit=1000', { headers });
    expect(list.response.status).toBe(200);

    const all = data(list.body) as Array<{ publicId: string; name: string; category?: string; sortOrder: number | null }>;
    const mine = all.filter(isProbe);
    expect(mine.length, 'the imported rows must be present').toBe(intended.length);

    expect(
      mine.map((item) => item.name),
      'the file order was lost: the read path fell back to the alphabet',
    ).toEqual(intended.map((row) => row.name));

    // And the ranks themselves, so the failure names its cause rather than just
    // its symptom. Equal ranks are what made the tie-break decide the order.
    const ranks = mine.map((item) => item.sortOrder);
    expect(new Set(ranks).size, 'imported rows must not share a rank').toBe(ranks.length);
  }, 300_000);

  it('a new item lands at the end, and the next one after it', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const names = [1, 2].map((n) => `صنف ${n} ${randomUUID().slice(0, 6)}`);
    const created: string[] = [];

    for (const name of names) {
      const result = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          publicId: `${PROBE_CODE_PREFIX}${randomUUID().slice(0, 8)}`,
          name,
          category: PROBE_CATEGORY,
          unit: 'kg',
        }),
      });
      expect(result.response.status).toBe(201);
      created.push(data(result.body).publicId);
    }

    const list = await request('/items?page=1&limit=1000', { headers });
    const all = data(list.body) as Array<{ publicId: string; name: string; category?: string; sortOrder: number | null }>;
    const mine = all.filter(isProbe);

    expect(
      mine.map((item) => item.name),
      'two items added one after another must stay in that order',
    ).toEqual(names);

    // And they are at the end of the catalogue, not folded into the alphabet.
    const lastProbeRank = Math.max(...mine.map((item) => item.sortOrder ?? -1));
    const otherRanks = all.filter((item) => !isProbe(item)).map((item) => item.sortOrder ?? 0);
    expect(
      Math.max(...otherRanks),
      'a new item must join the end of the catalog, not the middle of it',
    ).toBeLessThan(lastProbeRank);
  }, 300_000);

  it('importing into a non-empty catalog leaves the existing order alone', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const existing: string[] = [];
    for (const [index, name] of ['س', 'ص', 'ب'].entries()) {
      const result = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          publicId: `${PROBE_CODE_PREFIX}base-${index}-${randomUUID().slice(0, 6)}`,
          name: `${name} ${randomUUID().slice(0, 6)}`,
          category: PROBE_CATEGORY,
          unit: 'kg',
        }),
      });
      expect(result.response.status).toBe(201);
      existing.push(data(result.body).publicId);
    }

    const beforeList = await request('/items?page=1&limit=1000', { headers });
    const before = (data(beforeList.body) as Array<{ publicId: string }>).map((item) => item.publicId);

    const fresh = [
      { name: `صنف و ${randomUUID().slice(0, 6)}`, code: `${PROBE_CODE_PREFIX}f1-${randomUUID().slice(0, 6)}`, category: PROBE_CATEGORY, unit: 'kg' },
      { name: `صنف ز ${randomUUID().slice(0, 6)}`, code: `${PROBE_CODE_PREFIX}f2-${randomUUID().slice(0, 6)}`, category: PROBE_CATEGORY, unit: 'kg' },
    ];
    const imported = await request('/items/import-excel', {
      method: 'POST',
       headers: { ...headers, 'Idempotency-Key': `w3-import-${randomUUID()}` },
      body: JSON.stringify({ items: fresh.map((row, index) => ({ ...row, sourceRow: index + 2 })) }),
    });
    expect(imported.response.status).toBe(201);

    const afterList = await request('/items?page=1&limit=1000', { headers });
    const after = (data(afterList.body) as Array<{ publicId: string }>).map((item) => item.publicId);

    // The rows that were already there keep their relative order, and the import
    // joins the end. An import that re-sorted the catalogue would break the order
    // an operator had already saved, which is worse than not importing at all.
    const surviving = before.filter((id) => after.includes(id));
    const survivingAfter = after.filter((id) => before.includes(id));
    expect(survivingAfter, 'an import must not move rows that already existed').toEqual(surviving);

    const newIds = fresh.map((row) =>
      (data(imported.body).results ?? data(imported.body)).find(
        (entry: { name: string }) => entry.name === row.name,
      )?.publicId,
    );
    const positions = newIds.map((id) => after.indexOf(id));
    expect(Math.min(...positions), 'imported rows join the end').toBeGreaterThan(
      Math.max(...survivingAfter.map((id) => after.indexOf(id))),
    );
  }, 300_000);

  it('refuses an empty order instead of failing with a server error', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    // An empty array reached `Prisma.join([])`, which throws, so the caller got a
    // 500 for a request that was simply wrong. A 400 that names the problem is
    // the difference between a fixable report and a support ticket.
    const result = await request('/items/reorder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderedPublicIds: [] }),
    });

    expect(result.response.status, JSON.stringify(result.body).slice(0, 200)).toBe(400);
    expect(result.body.message ?? result.body.code).toBeDefined();
  }, 120_000);
});
