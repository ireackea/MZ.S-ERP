import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * A code is a code regardless of how it is typed.
 *
 * The import folded its lookup keys with trim and lowercase and then compared
 * them with `IN`, which is exact, against a case-sensitive unique index. So a
 * catalogue could hold `ITEM-1` and `item-1` at the same time: the studio showed
 * the second row as ready to import, the server's pre-check found nothing, the
 * insert succeeded because PostgreSQL considers the two values different, and
 * nothing anywhere reported anything. The operator ended up with two items whose
 * only difference was letter case, discovered later during a stocktake.
 *
 * Two things have to be true for this to stay fixed, and one without the other is
 * worth nothing:
 *
 *   1. The database refuses it. `Item_code_folded_key` (20260929050000) is a
 *      partial unique index on `lower(btrim("code"))`.
 *   2. The server predicts it. The pre-check queries with the identical
 *      expression, so the row is rejected *before* the insert and the operator is
 *      told which row and why, rather than the whole batch rolling back and being
 *      re-run one row at a time.
 *
 * The first test asserts the second one directly, because a pre-check that
 * disagrees with the constraint is worse than no pre-check: it produces a
 * confusing batch failure instead of a clean per-row message.
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

const PROBE_CATEGORY = 'zz-e2e-code-case';
const cleanup = () => psql(`DELETE FROM "Item" WHERE category = '${PROBE_CATEGORY}';`);

const importRows = async (cookie: string, rows: unknown[]) => {
  const result = await request('/items/import-excel', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': `w3-import-${randomUUID()}` },
    body: JSON.stringify({ items: rows }),
  });
  return { status: result.response.status, body: data(result.body) };
};

afterAll(() => {
  try { cleanup(); } catch { /* best effort; the next run sweeps too */ }
});

describe('FC-ITEM-IMPORT a code is a code regardless of case or padding', () => {
  it('the database refuses a code that differs only by case', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const code = `CASE-${randomUUID().slice(0, 8)}`;
    const name = `صنف ${randomUUID().slice(0, 6)}`;

    const first = await request('/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({ publicId: `probe-${randomUUID()}`, name, code, category: PROBE_CATEGORY, unit: 'kg' }),
    });
    expect(first.response.status, 'the first item must be created').toBe(201);

    // The direct write is the one that must fail. `POST /items` never checked
    // case-sensitivity, so this is what proves the index rather than a
    // pre-check is doing the work.
    const second = await request('/items', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: `${name} (نسخة)`,
        code: code.toLowerCase(),
        category: PROBE_CATEGORY,
        unit: 'kg',
      }),
    });
    expect(second.response.status, 'a code differing only by case must be refused by the database').toBe(409);

    const rows = psql(
      `SELECT count(*) FROM "Item" WHERE category = '${PROBE_CATEGORY}' AND lower(btrim("code")) = lower('${code}');`,
    );
    expect(Number(rows), 'exactly one row may exist for a folded code').toBe(1);
  }, 180_000);

  it('the import predicts it, per row, instead of failing the whole batch', async () => {
    const cookie = await login();
    cleanup();

    const existing = `PREDICT-${randomUUID().slice(0, 8)}`;
    await request('/items', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: `صنف ${randomUUID().slice(0, 6)}`,
        code: existing,
        category: PROBE_CATEGORY,
        unit: 'kg',
      }),
    });

    // Three rows: one whose code collides only by case, one entirely new, and one
    // that is fine. The collision must not cost the other two their place.
    const fresh = `FRESH-${randomUUID().slice(0, 8)}`;
    const result = await importRows(cookie, [
      { sourceRow: 2, name: `متعارض ${randomUUID().slice(0, 6)}`, code: existing.toLowerCase(), category: PROBE_CATEGORY, unit: 'kg' },
      { sourceRow: 3, name: `جديد ${randomUUID().slice(0, 6)}`, code: fresh, category: PROBE_CATEGORY, unit: 'kg' },
    ]);

    expect(result.status).toBe(201);
    expect(result.body.total, 'both rows were submitted').toBe(2);
    expect(result.body.success, 'the non-colliding row must land').toBe(1);
    expect(result.body.failed, 'the colliding row must be rejected on its own').toBe(1);

    const [error] = result.body.errors;
    expect(error?.row, 'the rejection must name the row so the operator can find it').toBe(2);
    expect(
      String(error?.message || ''),
      'the message must say the code is taken, not leak a Prisma internal',
    ).toContain('مستخدم مسبقًا');

    // And the catalogue still holds exactly one row for the folded code.
    const rows = psql(
      `SELECT count(*) FROM "Item" WHERE category = '${PROBE_CATEGORY}' AND lower(btrim("code")) = lower('${existing}');`,
    );
    expect(Number(rows)).toBe(1);
  }, 180_000);

  it('padding is part of the code, so "AB " collides with "AB"', async () => {
    const cookie = await login();
    cleanup();

    const code = `PAD-${randomUUID().slice(0, 8)}`;
    await request('/items', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: `صنف ${randomUUID().slice(0, 6)}`,
        code,
        category: PROBE_CATEGORY,
        unit: 'kg',
      }),
    });

    const result = await importRows(cookie, [
      { sourceRow: 2, name: `بمسافة ${randomUUID().slice(0, 6)}`, code: `  ${code}  `, category: PROBE_CATEGORY, unit: 'kg' },
    ]);

    expect(result.body.failed, 'a padded code is the same code').toBe(1);
    const rows = psql(
      `SELECT count(*) FROM "Item" WHERE category = '${PROBE_CATEGORY}' AND lower(btrim("code")) = lower('${code}');`,
    );
    expect(Number(rows)).toBe(1);
  }, 180_000);

  it('codeless items are still allowed, because a partial index must not ban them', async () => {
    const cookie = await login();
    cleanup();

    // Fifty-one of the ninety items in this catalogue have no code. A unique index
    // that treated NULL and empty as one shared value would make the second
    // codeless item impossible to create, which is why the index is partial.
    const result = await importRows(cookie, [
      { sourceRow: 2, name: `بلا كود 1 ${randomUUID().slice(0, 6)}`, category: PROBE_CATEGORY, unit: 'kg' },
      { sourceRow: 3, name: `بلا كود 2 ${randomUUID().slice(0, 6)}`, category: PROBE_CATEGORY, unit: 'kg' },
    ]);

    expect(result.status).toBe(201);
    expect(result.body.success, 'two codeless items must both be created').toBe(2);
    expect(result.body.failed).toBe(0);
  }, 180_000);
});
