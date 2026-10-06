import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * An import has to be able to finish, and it has to be able to fail honestly.
 *
 * Every test in this file is written against a defect that was found by reading
 * the code and has to be pinned here, because the shape of all of them is the
 * same: **the import reports failure while the data is already committed.**
 *
 * The first one is the reason this file exists. `bulkImportFromExcel` records the
 * audit row after its insert loop has finished, and it records the created items
 * as a comma-joined list of publicIds in `AuditLog.entityId`. That column carries
 * `@@index([entityId])`, and a b-tree index entry in PostgreSQL is capped at
 * 2704 bytes — a third of an 8 kB page. A publicId is `item-` plus a UUID, so 41
 * characters; 65 of them with their commas is 2729 bytes. The write fails.
 *
 * So importing 65 or more rows cannot succeed: the items are created, the audit
 * insert throws, the caller gets a 500, the list on screen is never refreshed,
 * and the realtime event that would have told the other sessions never fires.
 * The existing `items-order-import.spec.ts` imports twelve rows — 2687 bytes,
 * just under the cliff — which is why nothing caught it.
 *
 * The tests here import 500 rows. That is not an exaggeration to make a point;
 * it is two orders of magnitude below the documented maximum, and it is the number
 * a real stock file reaches on its first day of use.
 *
 * Probes are identified by category, never by a publicId prefix, and cleanup is a
 * DELETE scoped to that category. See the sibling spec for why: the import mints
 * publicIds itself, and a wildcard cleanup once deleted an operator's item.
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

const PROBE_CATEGORY = 'zz-e2e-import-integrity';
const PROBE_CODE_PREFIX = 'zz-e2e-int-';

const countProbes = (): number =>
  Number(psql(`SELECT count(*) FROM "Item" WHERE category = '${PROBE_CATEGORY}';`) || '0');

const cleanup = () => {
  psql(`DELETE FROM "Item" WHERE category = '${PROBE_CATEGORY}';`);
};

const rows = (count: number, marker: string) =>
  Array.from({ length: count }, (_, index) => ({
    sourceRow: index + 2,
    name: `صنف ${marker} ${String(index + 1).padStart(4, '0')}`,
    code: `${PROBE_CODE_PREFIX}${marker}-${String(index + 1).padStart(4, '0')}-${randomUUID().slice(0, 6)}`,
    category: PROBE_CATEGORY,
    unit: 'kg',
    minLimit: 0,
    maxLimit: 1000,
  }));

afterAll(() => {
  try { cleanup(); } catch { /* best effort; the next run sweeps too */ }
});

describe('FC-ITEM-IMPORT an import of a real size completes and reports what it did', () => {
  it('imports 500 rows, and the 65th does not break it', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const payload = rows(500, 'big');

    const imported = await request('/items/import-excel', {
      method: 'POST',
       headers: { ...headers, 'Idempotency-Key': `w3-import-${randomUUID()}` },
      body: JSON.stringify({ items: payload }),
    });

    // The headline. Before the fix this was a 500: the items were committed and
    // the audit insert that named them overflowed its index.
    expect(
      imported.response.status,
      'a 500 here means the rows were created and the caller was told the import failed. ' +
        'The catalogue grew, the list on screen did not, and no other session was told.',
    ).toBe(201);

    const body = data(imported.body);
    expect(body.success, 'every row in this file is valid, so every row must land').toBe(500);
    expect(body.failed).toBe(0);
    expect(body.total).toBe(500);
    expect(body.errors).toEqual([]);

    // And the rows really are there, which is what makes the 500 above a lie
    // rather than a clean refusal.
    expect(countProbes()).toBe(500);
  }, 300_000);

  it('the audit row for a large import is bounded, and it records what happened', async () => {
    await login();

    // The table is `audit_logs`, not `AuditLog`: the Prisma model is mapped with
    // `@@map`. Reading the model name is how this test first failed, and it failed
    // for the wrong reason — an error about a missing relation instead of about
    // the audit row it was written to check.
    const row = psql(
      `SELECT length("entityId"), "action", "status"
         FROM "audit_logs"
        WHERE "action" = 'IMPORT'
        ORDER BY "timestamp" DESC
        LIMIT 1;`,
    );

    // entityId was the comma-joined list of every created publicId. Even after it
    // is bounded, it has to stay far below a b-tree entry, or the next large
    // import fails the same way.
    const [entityIdLength, action, status] = row.split('|');
    expect(action, 'a bulk import must leave an audit row').toBe('IMPORT');
    expect(Number(entityIdLength), 'the audit row must not embed one id per created item').toBeLessThan(500);
    expect(['SUCCESS', 'success', 'FAILED', 'failed']).toContain(status);
  }, 120_000);

  it('an empty import is refused at the boundary, and a rejected one is still recorded', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    // Part one: an empty list is now a 400 from the DTO, not a 201 that created
    // nothing. This test originally asserted the opposite shape — that the service
    // would write an audit row for `[]` — and the `ArrayMinSize(1)` added in Wave 1
    // made the request fail before it ever reached the service. That is a stronger
    // guarantee: the refusal now costs nothing, writes nothing, and cannot be
    // mistaken for a success that happened to create nothing.
    const empty = await request('/items/import-excel', {
      method: 'POST',
       headers: { ...headers, 'Idempotency-Key': `w3-import-${randomUUID()}` },
      body: JSON.stringify({ items: [] }),
    });
    expect(empty.response.status, 'an empty import must be refused, not accepted as a no-op').toBe(400);

    // Part two: an import that arrives and is then rejected — every row refused —
    // must still leave a record, and must record it as a failure. `logItemAction`
    // defaults to 'SUCCESS' and the old call site never passed anything else, so an
    // operator probing which codes exist left no evidence they had.
    const before = Number(
      psql(`SELECT count(*) FROM "audit_logs" WHERE "action" = 'IMPORT';`) || '0',
    );

    // Two rows whose codes already exist, so both are rejected and nothing lands.
    const taken = [randomUUID().slice(0, 8), randomUUID().slice(0, 8)];
    for (const suffix of taken) {
      const created = await request('/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          publicId: `probe-${randomUUID()}`,
          name: `صنف ${randomUUID().slice(0, 6)}`,
          code: `TAKEN-${suffix}`,
          category: PROBE_CATEGORY,
          unit: 'kg',
        }),
      });
      expect(created.response.status).toBe(201);
    }

    const rejected = await request('/items/import-excel', {
      method: 'POST',
       headers: { ...headers, 'Idempotency-Key': `w3-import-${randomUUID()}` },
      body: JSON.stringify({
        items: taken.map((suffix, index) => ({
          sourceRow: index + 2,
          name: `متعارض ${randomUUID().slice(0, 6)}`,
          code: `taken-${suffix}`,
          category: PROBE_CATEGORY,
          unit: 'kg',
        })),
      }),
    });

    const body = data(rejected.body);
    expect(rejected.response.status).toBe(201);
    expect(body.success, 'nothing may land when every row collides').toBe(0);
    expect(body.failed).toBe(2);

    const after = Number(
      psql(`SELECT count(*) FROM "audit_logs" WHERE "action" = 'IMPORT';`) || '0',
    );
    expect(after, 'an import that created nothing must still be recorded').toBeGreaterThan(before);

    const status = psql(
      `SELECT "status" FROM "audit_logs" WHERE "action" = 'IMPORT' ORDER BY "timestamp" DESC LIMIT 1;`,
    );
    expect(
      String(status).toUpperCase(),
      'an import where every row was refused is a failure, not a success that created nothing',
    ).toBe('FAILED');
  }, 180_000);
});
