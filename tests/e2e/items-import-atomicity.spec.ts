import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * An import is one thing. This file is what stops it being several.
 *
 * The old importer was a loop of fifty-row transactions with a per-row retry after a
 * failure. That shape has one property and it is the wrong one: it can fail halfway
 * and still commit. A duplicate on row seven left rows eight through fifty written
 * and reported them as a partial success — which is how a catalogue ends up holding
 * half a file twice, and how the order got ranks that overlap.
 *
 * Every test below was written to fail against that implementation:
 *
 *   - atomicity: a file that cannot fully apply must leave the catalogue untouched
 *   - the rank base is read after the lock, so two imports cannot interleave
 *   - the audit row is inside the transaction, not a best-effort afterthought
 *   - the batch has a row of its own, so "what did this import do" is answerable
 *   - the dry run and the write make the same decision
 *   - reverting refuses, loudly, when something has moved
 *   - the same Idempotency-Key twice is one import, not two
 *
 * Probes are identified by category, never by a publicId prefix, and cleanup is a
 * DELETE scoped to that category: the importer mints its own publicIds, so a wildcard
 * cleanup once deleted an operator's item.
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

/**
 * One login per file, shared by every test.
 *
 * The auth limiter allows twenty logins per fifteen minutes per client address, and
 * this file has twelve tests. Logging in per test meant the suite spent its budget
 * on authentication and the twelfth test failed on 429 rather than on anything it
 * was checking. A session does not expire mid-file, and the runner already resets
 * the bucket before each spec, so one login is both sufficient and the only shape
 * that leaves room for the next file.
 */
let cachedCookie = '';
const login = async () => {
  if (cachedCookie) return cachedCookie;
  const result = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(result.response.status, 'login failed').toBe(201);
  cachedCookie = String(result.response.headers.get('set-cookie') || '').split(';')[0];
  return cachedCookie;
};

const data = (body: any) => body?.data ?? body;

const CATEGORY = 'zz-e2e-w3';
const CODE = 'zz-w3-';

const countItems = (): number =>
  Number(psql(`SELECT count(*) FROM "Item" WHERE category = '${CATEGORY}';`) || '0');

const cleanup = () => {
  psql(`DELETE FROM "ItemImportError" WHERE "batchId" IN (SELECT "id" FROM "ItemImportBatch" WHERE "sourceFileName" LIKE 'zz-e2e-w3%');`);
  psql(`DELETE FROM "ItemImportBatch" WHERE "sourceFileName" LIKE 'zz-e2e-w3%';`);
  psql(`DELETE FROM "Item" WHERE category = '${CATEGORY}';`);
};

/** A file name that identifies this run's batch rows, and never anything else. */
const marker = (tag: string) => `zz-e2e-w3-${tag}-${randomUUID().slice(0, 6)}`;

const rows = (count: number, tag: string, over: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, index) => ({
    sourceRow: index + 2,
    name: `و ${tag} ${String(index + 1).padStart(4, '0')}`,
    code: `${CODE}${tag}-${String(index + 1).padStart(4, '0')}-${randomUUID().slice(0, 6)}`,
    category: CATEGORY,
    unit: 'kg',
    ...over,
  }));

const importFile = async (
  cookie: string,
  items: unknown[],
  options: { mode?: string; tag: string; key?: string } = { tag: 'x' },
) => {
  const key = options.key ?? `w3-${randomUUID()}`;
  const result = await request('/items/import-excel', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ items, mode: options.mode, sourceFileName: marker(options.tag) }),
  });
  return { ...result, key };
};

afterAll(() => {
  try { cleanup(); } catch { /* best effort; the next run sweeps too */ }
});

/**
/**
 * These are real imports against a real database - a serializable transaction, a
 * rank renumbering, a batch row and an audit row per test - so they legitimately
 * take two to four seconds each. Under the 5-second vitest default that leaves no
 * margin, and the failure is a *timeout*, not an assertion: the same file passes
 * alone in 29s and loses four tests to the clock when the suite is already running.
 *
 * A timeout that measures the machine rather than the code reports a bug that is not
 * there, which is worse than no timeout at all - it teaches the reader to distrust
 * the output.
 *
 * Set once for the file rather than appended to twelve it() calls: the number is a
 * property of what this file does, and writing it twelve times means the twelfth
 * gets forgotten the next time a test is added.
 */
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe('FC-ITEM-IMPORT an import is one transaction', () => {
  it('refuses a keyless import rather than guessing', async () => {
    // Without a key a double-clicked button is two requests and the second is
    // refused for duplicating the first's codes, so the operator is shown a failure
    // for work that already succeeded. Requiring the header is the only way to tell
    // a retry from a new import.
    const cookie = await login();
    const result = await request('/items/import-excel', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: rows(1, 'nokey'), sourceFileName: marker('nokey') }),
    });
    expect(result.response.status).toBe(400);
  });

  it('writes nothing at all when one row in the file is refused under strict', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const before = countItems();
    // Forty-nine good rows and one that collides with a code the catalogue already
    // holds. Under `partial` the forty-nine land. Under `strict` nothing may, because
    // a half-applied catalogue is the state this wave exists to make unreachable.
    const take = await request('/items', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w3-take-${randomUUID()}` },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: `محجوز ${randomUUID().slice(0, 6)}`,
        code: `${CODE}held-${randomUUID().slice(0, 6)}`,
        category: CATEGORY,
        unit: 'kg',
      }),
  }, 30_000);
    expect(take.response.status).toBe(201);

    const file = rows(49, 'strict');
    file.push({
      sourceRow: 51,
      name: 'متعارض',
      code: String(data(take.body).code),
      category: CATEGORY,
      unit: 'kg',
    });

    const result = await importFile(cookie, file, { mode: 'strict', tag: 'strict' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const body = data(result.body);
    expect(body.success, 'nothing may land when one row is refused under strict').toBe(0);
    expect(body.failed).toBeGreaterThan(0);

    const after = countItems();
    // Only the one row created above by the setup call, and not the forty-nine.
    expect(after - before, 'the refused file must leave the catalogue untouched').toBe(1);

    const batchStatus = psql(
      `SELECT status FROM "ItemImportBatch" WHERE "publicId" = '${body.batchId}';`,
    );
    expect(batchStatus, 'a strict refusal is still a recorded batch').toBe('partial');
  });

  it('replays the same key instead of importing twice', async () => {
    const cookie = await login();
    cleanup();
    const key = `w3-${randomUUID()}`;
    const file = rows(3, 'replay');

    const first = await importFile(cookie, file, { tag: 'replay', key });
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    const afterFirst = countItems();
    expect(afterFirst).toBe(3);

    // The same file, the same key. A retry after a timeout, not a second import.
    const second = await importFile(cookie, file, { tag: 'replay', key });
    expect(second.response.status).toBe(201);
    const secondBody = data(second.body);
    expect(secondBody.replayed, 'the server must say this was a replay').toBe(true);
    expect(secondBody.batchId, 'a replay names the original batch').toBe(
      data(first.body).batchId,
    );
    expect(countItems(), 'a replay must not create a second set of rows').toBe(afterFirst);
  }, 30_000);

  it('refuses a key reused with a different file', async () => {
    // Silently accepting this would be worse than the duplicate import: the operator
    // would get one file's success reported for another file's content.
    const cookie = await login();
    const key = `w3-${randomUUID()}`;
    await importFile(cookie, rows(2, 'payload-a'), { tag: 'payload-a', key });
    const clash = await importFile(cookie, rows(2, 'payload-b'), { tag: 'payload-b', key });
    expect(clash.response.status).toBe(409);
  }, 30_000);

  it('gives every landed item a consecutive rank, and does not re-rank on update', async () => {
    const cookie = await login();
    cleanup();

    const first = await importFile(cookie, rows(5, 'rank'), { tag: 'rank' });
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    const ids = data(first.body).results.map((row: any) => row.publicId);

    const ranks = ids
      .map((id) => Number(psql(`SELECT "sortOrder" FROM "Item" WHERE "publicId" = '${id}';`)))
      .sort((a, b) => a - b);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index], 'imported ranks must be consecutive').toBe(ranks[index - 1] + 1);
    }

    // An update must not move the row. Rank belongs to the order profile; an import
    // that re-ranked would silently reorder a catalogue somebody arranged by hand.
    const before = Number(psql(`SELECT "sortOrder" FROM "Item" WHERE "publicId" = '${ids[0]}';`));
    const updated = await importFile(
      cookie,
      [{ sourceRow: 2, publicId: ids[0], name: 'اسم معدَّل', category: CATEGORY, unit: 'kg' }],
      { tag: 'rank' },
    );
    expect(updated.response.status, JSON.stringify(updated.body)).toBe(201);
    const after = Number(psql(`SELECT "sortOrder" FROM "Item" WHERE "publicId" = '${ids[0]}';`));
    expect(after, 'an update must not re-rank').toBe(before);
  }, 30_000);

  it('records the batch inside the transaction, and the audit row names it', async () => {
    const cookie = await login();
    cleanup();
    const result = await importFile(cookie, rows(4, 'audit'), { tag: 'audit' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const batchId = data(result.body).batchId;

    const row = psql(
      `SELECT status||'|'||"createdCount"||'|'||"totalRows"||'|'||"sourceFileName" FROM "ItemImportBatch" WHERE "publicId" = '${batchId}';`,
    );
    expect(row.split('|')[0]).toBe('succeeded');
    expect(row.split('|')[1]).toBe('4');
    expect(row.split('|')[3]).toContain('zz-e2e-w3-audit');

    // The audit row's entityId is the batch, and it now points at a real row instead
    // of a generated id with nothing behind it.
    const audited = psql(
      `SELECT count(*) FROM "audit_logs" WHERE action = 'IMPORT' AND "entityId" = '${batchId}';`,
    );
    expect(Number(audited), 'the audit row must name the batch').toBe(1);
  }, 30_000);

  it('persists every rejection, not the first one per row', async () => {
    const cookie = await login();
    cleanup();
    const result = await importFile(
      cookie,
      [
        { sourceRow: 2, name: '', category: CATEGORY, unit: '' },
        { sourceRow: 3, name: 'سليم', category: CATEGORY, unit: 'kg' },
      ],
      { tag: 'reject' },
    );
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const body = data(result.body);
    expect(body.errors.length).toBeGreaterThanOrEqual(2);

    const stored = Number(
      psql(
        `SELECT count(*) FROM "ItemImportError" e
           JOIN "ItemImportBatch" b ON b."id" = e."batchId"
          WHERE b."publicId" = '${body.batchId}';`,
      ),
    );
    expect(stored, 'the batch keeps the whole rejection list').toBe(body.errors.length);
  }, 30_000);
});

describe('FC-ITEM-IMPORT the dry run decides the same thing and writes nothing', () => {
  it('agrees with the write path and creates no rows', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();
    const before = countItems();

    const file = rows(6, 'dry');
    const take = await request('/items', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w3-dry-${randomUUID()}` },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: 'محجوز',
        code: `${CODE}dry-held-${randomUUID().slice(0, 6)}`,
        category: CATEGORY,
        unit: 'kg',
      }),
  }, 30_000);
    expect(take.response.status).toBe(201);

    // One row of the file collides with the item just created.
    const file2 = [...file];
    file2.push({
      sourceRow: 8,
      name: 'متعارض',
      code: String(data(take.body).code),
      category: CATEGORY,
      unit: 'kg',
    });

    const dry = await request('/items/import-excel/validate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items: file2 }),
    });
    expect(dry.response.status, JSON.stringify(dry.body)).toBe(201);
    const report = data(dry.body);
    expect(report.wouldCreate, 'the dry run must predict the same count').toBe(6);
    expect(report.rejected).toBe(1);
    expect(report.valid).toBe(false);
    expect(countItems(), 'a dry run writes nothing').toBe(before + 1);

    // And the write lands exactly what the dry run said.
    const written = await importFile(cookie, file2, { tag: 'dry' });
    expect(data(written.body).success).toBe(report.wouldCreate);
  });
});

describe('FC-ITEM-IMPORT a revert refuses rather than cascading', () => {
  it('archives the items of a batch that never moved', async () => {
    const cookie = await login();
    cleanup();
    const result = await importFile(cookie, rows(3, 'revert-ok'), { tag: 'revert-ok' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const batchId = data(result.body).batchId;

    const revert = await request(`/items/import-batches/${batchId}/revert`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': `w3-revert-${randomUUID()}` },
  }, 30_000);
    expect(revert.response.status, JSON.stringify(revert.body)).toBe(201);
    const body = data(revert.body);
    expect(body.archived).toBe(3);

    const stillThere = Number(
      psql(`SELECT count(*) FROM "Item" WHERE "publicId" IN (SELECT "publicId" FROM "Item" WHERE "lastImportBatchId" = (SELECT "id" FROM "ItemImportBatch" WHERE "publicId" = '${batchId}'));`),
    );
    expect(stillThere, 'a revert archives, it does not erase identity').toBe(3);
    const archived = Number(
      psql(`SELECT count(*) FROM "Item" WHERE "isArchived" = true AND category = '${CATEGORY}' AND name LIKE '%revert-ok%';`),
    );
    expect(archived).toBe(3);
  });

  it('refuses when an item has movements, and says which', async () => {
    // `Transaction.itemId` is ON DELETE CASCADE. A hard delete of an item that has
    // ever moved is not a delete — it is a cascade that takes the ledger row with
    // it, silently, inside the database. This refusal is the whole reason the
    // endpoint checks instead of trusting the archive path.
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    const result = await importFile(cookie, rows(2, 'revert-blocked'), { tag: 'revert-blocked' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const batchId = data(result.body).batchId;
    const target = data(result.body).results[0].publicId;

    const moved = await request('/transactions', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w3-tx-${randomUUID()}` },
      body: JSON.stringify({
        itemId: target,
        date: new Date().toISOString().slice(0, 10),
        type: 'وارد',
        quantity: '2.5',
        supplierOrReceiver: 'zz-e2e-w3 probe',
        warehouseInvoice: `W3-${randomUUID()}`,
      }),
  }, 30_000);
    expect(moved.response.status, JSON.stringify(moved.body)).toBe(201);

    const revert = await request(`/items/import-batches/${batchId}/revert`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w3-revert-${randomUUID()}` },
    });
    expect(revert.response.status).toBe(409);
    const body = revert.body?.data ?? revert.body;
    expect(body.blockedCount, 'the refusal must name what is in the way').toBeGreaterThan(0);
    expect(body.blockers.some((entry: any) => entry.publicId === target)).toBe(true);
    expect(body.blockers.find((entry: any) => entry.publicId === target).reasons.join(' '))
      .toMatch(/حركات|رصيد/);
  });

  it('refuses a keyless revert, because a repeat is the damaging case', async () => {
    const cookie = await login();
    cleanup();
    const result = await importFile(cookie, rows(1, 'keyless'), { tag: 'keyless' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const keyless = await request(`/items/import-batches/${data(result.body).batchId}/revert`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  }, 30_000);
    expect(keyless.response.status, 'a revert with no key is refused').toBe(400);
  });

  it('refuses a batch that does not exist, and one already reverted', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': `w3-revert-${randomUUID()}` };
    const missing = await request('/items/import-batches/import-does-not-exist/revert', {
      method: 'POST',
      headers,
  }, 30_000);
    expect(missing.response.status).toBe(404);

    cleanup();
    const result = await importFile(cookie, rows(1, 'twice'), { tag: 'twice' });
    const batchId = data(result.body).batchId;
    expect(
      (await request(`/items/import-batches/${batchId}/revert`, { method: 'POST', headers })).response
        .status,
    ).toBe(201);
    const again = await request(`/items/import-batches/${batchId}/revert`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w3-revert-${randomUUID()}` },
    });
    expect(again.response.status, 'a second revert is a conflict, not a silent no-op').toBe(409);
  });
});
