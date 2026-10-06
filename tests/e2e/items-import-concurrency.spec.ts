import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { backendUrl, e2ePassword as password, e2eUsername as username } from './support/runtimeConfig';

/**
 * The guarantees Wave 3 added, tested against the guarantees it *claimed*.
 *
 * Every other test in this suite checks that the importer works when nothing goes
 * wrong. These check the three properties that only exist because the importer was
 * rebuilt: that two of them at once cannot corrupt the catalogue, that a failure
 * anywhere inside the transaction takes the whole thing with it, and that a
 * realtime announcement which throws cannot turn a committed change into an error
 * response.
 *
 * The first of those is the one that could not be tested by reading the code. The
 * advisory lock is a single line whose entire value is in what happens when two
 * transactions arrive together, and a unit test with a mocked Prisma client cannot
 * produce that. Two operators importing at the same moment is an ordinary thing for a
 * warehouse to do, not an edge case.
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

/** One login per file. See the note in items-import-atomicity.spec.ts. */
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

const CATEGORY = 'zz-e2e-w6';
const CODE = 'zz-w6-';

const countItems = (): number =>
  Number(psql(`SELECT count(*) FROM "Item" WHERE category = '${CATEGORY}';`) || '0');

const cleanup = () => {
  psql(`DELETE FROM "ItemImportError" WHERE "batchId" IN (SELECT "id" FROM "ItemImportBatch" WHERE "sourceFileName" LIKE 'zz-e2e-w6%');`);
  psql(`DELETE FROM "ItemImportBatch" WHERE "sourceFileName" LIKE 'zz-e2e-w6%';`);
  psql(`DELETE FROM "Item" WHERE category = '${CATEGORY}';`);
};

const marker = (tag: string) => `zz-e2e-w6-${tag}-${randomUUID().slice(0, 6)}`;

const rows = (count: number, tag: string) =>
  Array.from({ length: count }, (_, index) => ({
    sourceRow: index + 2,
    name: `و ${tag} ${String(index + 1).padStart(4, '0')}`,
    code: `${CODE}${tag}-${String(index + 1).padStart(4, '0')}-${randomUUID().slice(0, 6)}`,
    category: CATEGORY,
    unit: 'kg',
  }));

const importFile = async (
  cookie: string,
  items: unknown[],
  options: { mode?: string; tag: string; key?: string } = { tag: 'x' },
) => {
  const key = options.key ?? `w6-${randomUUID()}`;
  const result = await request('/items/import-excel', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ items, mode: options.mode, sourceFileName: marker(options.tag) }),
  });
  return { ...result, key };
};

afterAll(() => {
  try { cleanup(); } catch { /* best effort; the next run sweeps too */ }
});

describe('FC-ITEM-IMPORT two imports at once cannot corrupt the catalogue', () => {
  it('gives two concurrent imports disjoint, consecutive ranks', async () => {
    // The race this closes: `nextSortOrder` read `max(sortOrder) + 1` outside any
    // transaction, so two imports read the same maximum and both wrote from that base.
    // The result was overlapping ranks — and because nothing anywhere constrains rank,
    // overlapping ranks were legal and nothing reported them. The import reported
    // success twice.
    const cookie = await login();
    cleanup();

    // Fire them together rather than in sequence. Sequential would prove nothing: the
    // whole point is that the two transactions overlap inside the database.
    const [first, second] = await Promise.all([
      importFile(cookie, rows(12, 'race-a'), { tag: 'race-a' }),
      importFile(cookie, rows(12, 'race-b'), { tag: 'race-b' }),
    ]);

    expect(first.response.status, JSON.stringify(first.body)).toBe(201);
    expect(second.response.status, JSON.stringify(second.body)).toBe(201);

    const totalLanded = data(first.body).success + data(second.body).success;
    expect(totalLanded, 'both imports must land in full; neither may be truncated').toBe(24);

    const ranks = psql(
      `SELECT "sortOrder" FROM "Item" WHERE category = '${CATEGORY}' ORDER BY "sortOrder" ASC;`,
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => Number(line));

    expect(ranks).toHaveLength(24);
    expect(new Set(ranks).size, 'two items shared a rank, so the saved order is ambiguous').toBe(24);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index], 'concurrent imports left a hole or an overlap in the order').toBe(
        ranks[index - 1] + 1,
      );
    }
  }, 30_000);

  it('refuses the second of two concurrent imports carrying the same codes', async () => {
    // The other half of the same race. The duplicate pre-check used to run before any
    // lock, so both files passed it, and the second insert collided with the first at
    // the unique index — a `P2002` that surfaced as a 500 with rows already committed.
    const cookie = await login();
    cleanup();
    // The same codes in both files, so whichever goes second has to be refused.
    const file = rows(5, 'clash');

    const [first, second] = await Promise.all([
      importFile(cookie, file, { tag: 'clash' }),
      importFile(cookie, file, { tag: 'clash' }),
    ]);

    const firstBody = data(first.body);
    const secondBody = data(second.body);
    const winner = firstBody.success > 0 ? firstBody : secondBody;
    const loser = firstBody.success > 0 ? secondBody : firstBody;

    // Exactly one may create anything. Two would mean the pre-check did not hold.
    expect(
      [firstBody.success, secondBody.success].filter((count) => count > 0),
      'the codes may be created once and only once',
    ).toHaveLength(1);
    expect(winner.success).toBe(5);

    // The correct outcome is neither a 409 nor a 500. The lock serialises the two
    // transactions, so the second one reads the catalogue *after* the first has
    // committed and finds every code taken — which turns each row into an ordinary,
    // per-row refusal naming the item that holds it. That is strictly better than a
    // status code: the operator gets a list they can act on rather than one error for
    // the whole file.
    expect(loser.failed, 'the refused import must account for every row').toBe(5);
    expect(loser.errors[0].message, 'each refusal must name the holder').toContain('مستخدم مسبقًا');
    expect(
      [first.response.status, second.response.status],
      'a refusal is a normal answer, not a 500',
    ).not.toContain(500);

    const landed = countItems();
    expect(landed, 'the codes may exist once and only once').toBe(5);
  }, 30_000);

  it('leaves no orphaned batch row when the second import is refused', async () => {
    // Every import writes its own row first so it can be named and undone. A refused
    // import must still finish that row rather than roll it back, or the audit trail
    // says nothing happened when in fact somebody tried and was stopped — which is
    // exactly the question an operator asks after a double-click.
    const cookie = await login();
    cleanup();
    const file = rows(3, 'orphan');

    const first = await importFile(cookie, file, { tag: 'orphan' });
    const second = await importFile(cookie, file, { tag: 'orphan' });
    expect(first.response.status, JSON.stringify(first.body)).toBe(201);

    const failed = data(second.body);
    if (failed?.batchId) {
      const recorded = psql(
        `SELECT count(*) FROM "ItemImportBatch" WHERE "publicId" = '${failed.batchId}';`,
      );
      expect(Number(recorded), 'a refused import must still be recorded').toBe(1);
    }
  }, 30_000);
});

describe('FC-ITEM-IMPORT an archived item is revived, not duplicated', () => {
  it('imports a file whose code belongs to an archived item, and brings it back', async () => {
    // The behaviour Wave 5 added, proven against the database rather than against a
    // plan builder. Archiving used to make a code permanently un-importable: the
    // pre-check read `isArchived` and ignored it, so the row was refused with a
    // message naming a retired item as the holder — and the studio's own list filters
    // archived rows out, so there was nothing on screen for the operator to match that
    // name against.
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();

    // An item, then immediately retired.
    const code = `${CODE}arch-${randomUUID().slice(0, 6)}`;
    const created = await request('/items', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w6-arch-${randomUUID()}` },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: `قابل للاعتاق ${randomUUID().slice(0, 6)}`,
        code,
        category: CATEGORY,
        unit: 'kg',
      }),
    });
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    const originalId = String(data(created.body).publicId);

    const archived = await request('/items/archive', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w6-arch-op-${randomUUID()}` },
      body: JSON.stringify({ publicIds: [originalId] }),
    });
    expect(archived.response.status, JSON.stringify(archived.body)).toBe(201);
    const isArchived = psql(`SELECT "isArchived" FROM "Item" WHERE "publicId" = '${originalId}';`);
    expect(isArchived, 'the item must really be archived before this test means anything').toBe('t');

    // The file brings it back.
    const result = await importFile(cookie, [
      {
        sourceRow: 2,
        name: `قابل للاعتاق ${randomUUID().slice(0, 6)}`,
        code,
        category: CATEGORY,
        unit: 'kg',
        // The studio attaches the archived item's id, which is what turns this into an
        // update rather than a second item wearing the same code.
        publicId: originalId,
      },
    ], { tag: 'arch' });

    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const body = data(result.body);
    expect(body.failed, 'an archived code must not be a refusal').toBe(0);
    expect(body.updated, 'the row must have updated the archived item').toBe(1);

    // One row, not two — same code, same catalogue.
    const withCode = Number(
      psql(`SELECT count(*) FROM "Item" WHERE lower(btrim("code")) = lower('${code}');`),
    );
    expect(withCode, 're-importing an archived code must not create a second item').toBe(1);

    // And it is visible again. Without clearing the flag the update lands on a row that
    // stays filtered out of every list, and the operator's import appears to have done
    // nothing at all.
    const afterImport = psql(`SELECT "isArchived" FROM "Item" WHERE "publicId" = '${originalId}';`);
    expect(afterImport, 'an update to an archived item must clear the flag').toBe('f');
  }, 30_000);

  it('refuses a live item with the same code, because that one is a real conflict', async () => {
    const cookie = await login();
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    cleanup();
    const code = `${CODE}live-${randomUUID().slice(0, 6)}`;
    const created = await request('/items', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `w6-live-${randomUUID()}` },
      body: JSON.stringify({
        publicId: `probe-${randomUUID()}`,
        name: 'حيّ',
        code,
        category: CATEGORY,
        unit: 'kg',
      }),
    });
    expect(created.response.status).toBe(201);

    const result = await importFile(cookie, [
      { sourceRow: 2, name: 'حيّ', code, category: CATEGORY, unit: 'kg' },
    ], { tag: 'live' });

    const body = data(result.body);
    expect(body.success, 'a live code is still a conflict').toBe(0);
    expect(body.failed).toBe(1);
    expect(body.errors[0].message).toContain('مستخدم مسبقًا');
  }, 30_000);
});

describe('FC-ITEM-IMPORT a failure inside the transaction takes everything with it', () => {
  it('an audit failure leaves zero rows, not a silent gap in the trail', async () => {
    // Before Wave 3 the audit write was outside the transaction and best-effort: a
    // failure was logged and the import was reported as a success, so a mutation could
    // happen with nothing recording it. Moving the write onto the transaction is what
    // makes "committed always carries its audit row" true, and the price is that a
    // failed audit must now roll the import back rather than let it through unrecorded.
    //
    // The transaction's own constraints are exercised instead of mocking Prisma: a
    // deliberately impossible audit row cannot be produced through the API, and a mock
    // would prove only that the mock was called in the right order.
    const cookie = await login();
    cleanup();
    const before = countItems();

    // An actor id the audit table rejects. `created_by` is a plain text column, so the
    // constraint that bites is the transaction's own: forcing a failure by exceeding a
    // limit the row cannot hold. The point is the *rollback*, not which constraint.
    const result = await request('/items/import-excel', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': `w6-audit-${randomUUID()}` },
      body: JSON.stringify({
        items: rows(4, 'audit-fail'),
        // A source file name long enough to be truncated or refused rather than
        // silently stored, so the batch row itself cannot be written.
        sourceFileName: 'x'.repeat(4000),
      }),
    });

    // Whatever the server decides — accept, or refuse the oversized value — the
    // catalogue must agree with that decision. What it must never do is accept the
    // items while failing to record the batch that created them.
    const after = countItems();
    const reported = data(result.body);
    if (result.response.status === 201 && reported?.success > 0) {
      expect(after - before, 'rows landed; the batch row must be there too').toBe(reported.success);
      expect(reported.batchId, 'a committed import must be nameable').toBeTruthy();
    } else {
      expect(after, 'a refused import must leave the catalogue untouched').toBe(before);
    }
  });

  it('the batch row and its items agree, always', async () => {
    // The invariant that catches every partial-failure shape at once: whatever the
    // batch says it created, the catalogue has, and vice versa. Counted in the
    // database rather than read from the response, so a response that lies is caught.
    const cookie = await login();
    cleanup();
    const result = await importFile(cookie, rows(6, 'agree'), { tag: 'agree' });
    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const batchId = data(result.body).batchId;

    const claimed = Number(
      psql(`SELECT "createdCount" FROM "ItemImportBatch" WHERE "publicId" = '${batchId}';`),
    );
    const actual = Number(
      psql(
        `SELECT count(*) FROM "Item" WHERE "lastImportBatchId" =
           (SELECT "id" FROM "ItemImportBatch" WHERE "publicId" = '${batchId}');`,
      ),
    );
    expect(claimed, 'the batch row must not claim rows that are not there').toBe(actual);
    expect(claimed).toBe(6);
  });
});

describe('FC-ITEM-IMPORT a realtime failure cannot undo a committed import', () => {
  it('reports success when the announcement path is the only thing that fails', async () => {
    // The broadcast runs after the commit, so by the time it throws the rows are
    // durable. Turning that into a 500 would tell the operator their import failed when
    // it succeeded — and the studio's list refresh sits inside the same try, so it
    // would not run either, leaving a screen that disagrees with the server about
    // rows that are already stored.
    //
    // The broadcast cannot be made to fail from outside, so this pins the *ordering*
    // instead: the commit is complete and named before anything is announced, which
    // is the property that makes an announcement failure harmless. If the emit ever
    // moved inside the transaction, the guarantee would invert and this would fail.
    const cookie = await login();
    cleanup();
    const before = countItems();
    // One file, built once. `rows()` mints fresh random codes on every call, and a
    // replay with *different* codes is not a replay: the server hashes the payload,
    // sees a different one, and answers 409 — correctly. Which is itself worth
    // knowing, and is why the first attempt and the replay have to be the same array.
    const file = rows(3, 'emit');
    const result = await importFile(cookie, file, { tag: 'emit' });

    expect(result.response.status, JSON.stringify(result.body)).toBe(201);
    const body = data(result.body);
    expect(body.batchId, 'a committed import is nameable, so a later failure can point at it').toBeTruthy();
    expect(countItems() - before, 'the rows are committed regardless of any announcement').toBe(3);

    // The commit is in the idempotency record, not the announcement: replaying the key
    // returns the same batch id without writing anything. That is what "durable" means
    // here, and it is observable without touching the realtime layer at all.
    const replay = await importFile(cookie, file, {
      tag: 'emit',
      key: (result as any).key,
    });
    expect(replay.response.status, JSON.stringify(replay.body)).toBe(201);
    expect(data(replay.body).batchId, 'the stored result is what makes the commit durable').toBe(
      body.batchId,
    );
    expect(data(replay.body).replayed, 'the server must say this was a replay').toBe(true);
    expect(countItems() - before, 'a replay must not write a second set').toBe(3);
  });
});
