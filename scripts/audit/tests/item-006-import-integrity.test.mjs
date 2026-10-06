import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const exists = (path) => existsSync(join(repoRoot, path));

const itemService = read('backend/src/item/item.service.ts');
const profileService = read('backend/src/item/item-order-profile.service.ts');
const schema = read('backend/prisma/schema.prisma');

/**
 * Comments are stripped before every assertion about absence.
 *
 * These guards quote the code they replaced in the comments explaining why, so a
 * plain text search finds the old form in the prose and reports a violation that
 * is not there. A guard that cries wolf on its own documentation gets deleted
 * rather than fixed, and then nothing is guarded at all. This is the same rule the
 * rest of `scripts/audit` follows.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const code = {
  item: stripComments(itemService),
  profile: stripComments(profileService),
  batch: stripComments(read('backend/src/item/import-batch.ts')),
};

const methodBody = (source, signature) => {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} was not found. If it was renamed, point this guard at the new name.`);
  const end = source.indexOf('\n  async ', start + signature.length);
  const nextPrivate = source.indexOf('\n  private ', start + signature.length);
  const candidates = [end, nextPrivate].filter((value) => value > start);
  const stop = candidates.length ? Math.min(...candidates) : undefined;
  return source.slice(start, stop === undefined ? undefined : stop);
};

const migrationText = () => {
  const dir = join(repoRoot, 'backend/prisma/migrations');
  const matches = readdirSync(dir).filter((name) => name.startsWith('20260929'));
  const text = matches
    .map((name) => readFileSync(join(dir, name, 'migration.sql'), 'utf8'))
    .join('\n');
  assert.notEqual(matches.length, 0, 'No 20260929 migration found. If it was renamed, point this guard at it.');
  return text;
};

/**
 * Wave 1 is the set of fixes that change no behaviour an operator can observe,
 * except by no longer losing data. Each guard here pins one of them, and each names
 * the failure it prevents — because every one of them was a *silent* failure, which
 * is exactly the class that survives without a test.
 */

// ── The import audit row must be bounded, and must never decide the request ─────

test('the import audit row names the batch, not every created item', () => {
  const body = methodBody(code.item, 'async bulkImportFromExcel');

  assert.doesNotMatch(
    body,
    /results\s*\.map\([^)]*\)\s*\.join\(\s*','\s*\)/,
    'The audit entityId must not be a comma-joined list of created publicIds. That column carries ' +
      '@@index([entityId]) and a b-tree entry in PostgreSQL is capped at 2704 bytes; a publicId is 41 ' +
      'characters, so sixty-five items overflow it. The write then throws after the rows are committed ' +
      'and the caller is answered 500 for an import that succeeded.',
  );
  assert.match(
    body,
    /const batchPublicId = `import-\$\{randomUUID\(\)\}`/,
    'The batch identifier must be a generated short token, not derived from the payload. It is what ' +
      'the ItemImportBatch table will key on, and it has to fit an index entry at any import size.',
  );
});

test('a committed import always carries its audit row, because it is in the transaction', () => {
  const body = methodBody(code.item, 'async bulkImportFromExcel');

  // This test used to require a `try { ... } catch { console.error }` around the
  // audit write. That was the Wave 1 fix and it was the right fix at the time: the
  // write lived past the transaction boundary, where a failure could only be logged.
  //
  // Wave 3 moved the audit write *inside* the transaction, which is stronger — a
  // committed import can no longer lack its audit row at all, so there is nothing left
  // to catch. The guard is rewritten rather than deleted because the property it
  // protects did not change; the mechanism that provides it did.
  assert.match(
    body,
    /executeIdempotently\([\s\S]*?async \(tx, result\) => \{[\s\S]*?tx\.auditLog\.create\(/,
    'The audit row must be written on the transaction, as the audit callback of ' +
      '`executeIdempotently`. Outside it, a committed import can exist with no record that it did.',
  );
  assert.doesNotMatch(
    body,
    /logItemAction\(/,
    'The old best-effort `logItemAction` call is gone by design. It could not join the ' +
      'transaction, so it had to be wrapped in a catch that turned a missing audit row into a ' +
      'console line and nothing else.',
  );
  assert.match(
    body,
    /status: result\.success > 0 \? 'success' : 'failed'/,
    'An import that created nothing must be audited as failed. The status defaults to success and ' +
      'nothing else sets it, so a file where every row was rejected was recorded as a success.',
  );
});

test('an import is audited even when it created nothing', () => {
  const body = methodBody(code.item, 'async bulkImportFromExcel');
  assert.doesNotMatch(
    body,
    /if \(userId && outcome\.value\.success > 0\)[\s\S]{0,200}audit/,
    'The old guard was `userId && results.length > 0`, so a rejected file produced no audit row at ' +
      'all. An operator probing which codes exist left no evidence they had done so.',
  );
  // The audit now runs for every caller of the idempotency wrapper, unconditionally,
  // so the absence of a length guard is the property rather than a pattern to match.
  assert.doesNotMatch(
    body,
    /success > 0\) \{[\s\S]{0,120}tx\.auditLog/,
    'The audit must not be conditional on the import having created something.',
  );
});

// ── Duplicate detection must agree with the constraint it predicts ──────────────

test('the duplicate pre-check uses the same expression as the unique index', () => {
  const migration = migrationText();
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "Item_code_folded_key"/,
    'The partial unique index on the folded code is the guarantee. Application code that only checks is ' +
      'a suggestion, and the one that was here was case-sensitive.',
  );
  assert.match(
    migration,
    /lower\(btrim\("code"\)\)/,
    'The index expression must be lower(btrim(...)) so that a padded code is the same code.',
  );
  assert.match(
    migration,
    /WHERE "code" IS NOT NULL/,
    'The index must be partial. Fifty-one of the ninety items in this catalogue have no code, and a ' +
      'whole-column unique index would make the second codeless item impossible to create.',
  );

  // The lookup moved out of `bulkImportFromExcel` into `readExistingImportKeys` when
  // Wave 3 made the import a single transaction. It has to be a method of its own for
  // that to be possible: the query must run on `tx`, after the advisory lock, and a
  // block of query code inlined in the middle of a transaction is how it ended up on
  // the root client in the first place. The guard follows the code rather than pinning
  // a location that no longer holds it.
  const readKeys = methodBody(code.item, 'private async readExistingImportKeys');
  assert.match(
    readKeys,
    /lower\(btrim\(item\."code"\)\)\s*=\s*ANY\(/,
    'The pre-check must fold exactly the way the index folds. A pre-check that disagrees with the ' +
      'constraint is worse than none: it turns a clean per-row message into a batch rollback.',
  );
  assert.doesNotMatch(
    readKeys,
    /code:\s*\{\s*in:\s*uniqueCodes\s*\}/,
    'The old lookup was an IN filter on a text column, which is an exact comparison, applied to keys ' +
      'that had already been lowercased. A stored ABC never matched a folded abc.',
  );
  assert.match(
    readKeys,
    /Prisma\.join\(conditions,\s*' OR '\)/,
    'The conditions must be joined as SQL fragments. A folded key list is operator-supplied and must ' +
      'be bound as a parameter, not spliced into statement text.',
  );
  assert.match(
    readKeys,
    /client:\s*PrismaService\s*\|\s*Prisma\.TransactionClient/,
    'The lookup must accept whichever client the caller holds. The write path passes `tx` so the read ' +
      'and the write it decides are in the same transaction; the dry run passes the root client because ' +
      'it writes nothing.',
  );
});

test('the read-only conflict probe must exist and must stay read-only', () => {
  const probePath = 'scripts/audit/item-import-duplicate-probe.mjs';
  assert.ok(exists(probePath), `${probePath} must exist. The plan forbids a migration before an actual ` +
    'conflict report, and this is the report.');

  const probe = read(probePath);
  assert.match(
    probe,
    /default_transaction_read_only=on/,
    'The probe must run in a read-only transaction so a wrong query cannot write. It is pointed at the ' +
      'catalogue, and a data fix is an operator decision.',
  );
  assert.match(probe, /HAVING count\(\*\) > 1/, 'The probe must actually look for conflicts.');
  assert.match(probe, /process\.exit\(1\)/, 'A conflict must fail the script, so a pipeline can gate on it.');
  for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ALTER', 'DROP']) {
    assert.doesNotMatch(
      probe,
      new RegExp(`\\\\b${verb}\\\\b`),
      `The probe must contain no ${verb}. It is a report, and the next person to run it will assume ` +
        'that from the name.',
    );
  }
});

// ── Permanent delete must be deliberate and must say what it destroys ───────────

test('a permanent delete requires an archived item', () => {
  const body = methodBody(code.item, 'async deletePermanently');
  assert.match(
    body,
    /ITEM_NOT_ARCHIVED/,
    'Permanent deletion must be refused for an active item. The product has a reversible archive path, ' +
      'and reaching past it skips the review that makes the action deliberate.',
  );
  assert.match(
    body,
    /isArchived/,
    'The pre-check must read the current archive state rather than assume it.',
  );
});

test('a permanent delete refuses when the ledger would go with it', () => {
  const body = methodBody(code.item, 'async deletePermanently');
  assert.match(
    body,
    /ITEM_HAS_LEDGER/,
    'Deleting an item cascades to its transactions and opening balances. Nothing checked, so a purge ' +
      'of a stocked item erased the ledger behind it, and a reconciliation then read green over the hole.',
  );
  for (const relation of ['transactions', 'openingBalances', 'orderItems']) {
    assert.ok(
      body.includes(relation),
      `The refusal must report ${relation}. An operator told "this cannot be deleted" without being told ` +
        'why cannot tell which of their records is holding the item.',
    );
  }
});

test('there is one permanent-delete path, and it is audited with an actor', () => {
  assert.doesNotMatch(
    code.item,
    /async deleteByPublicIds[\s\S]{0,400}?prisma\.item\.deleteMany/,
    'deleteByPublicIds must delegate to deletePermanently. It was a second copy of the same hard delete ' +
      'with no guard, no audit row and no actor, so a guard added to one route would not apply to the other.',
  );
  const body = methodBody(code.item, 'async deleteByPublicIds');
  assert.match(
    body,
    /return this\.deletePermanently\(/,
    'deleteByPublicIds must delegate rather than duplicate.',
  );

  const controller = read('backend/src/item/item.controller.ts');
  const route = /@Post\('delete'\)[\s\S]{0,80}?async deleteMany([\s\S]{0,600}?)\n {2}\}/.exec(stripComments(controller));
  assert.ok(route, 'POST /items/delete must still exist.');
  assert.match(
    route[1],
    /req\.user\?\.sub\s*\|\|\s*req\.user\?\.id/,
    'The bulk delete route must pass an actor. It audited nothing identifiable, and it is one of the two ' +
      'operations in this module that cannot be undone.',
  );
});

// ── Row-level validation, not whole-request rejection ─────────────────────────

test('the import DTO bounds text the way the single-item routes do', () => {
  const dto = read('backend/src/item/dto/bulk-import.dto.ts');
  const createDto = read('backend/src/item/dto/item.dto.ts');

  for (const [field, cap] of [['name', 120], ['code', 64], ['barcode', 64], ['category', 80], ['unit', 32], ['description', 1000]]) {
    assert.ok(
      createDto.includes(`@MaxLength(${cap})`),
      `The single-item DTO is expected to cap ${field} at ${cap}. If that changed, update this guard.`,
    );
    assert.match(
      dto,
      new RegExp(`MaxLength\\(${cap}\\)`),
      `The import DTO must cap ${field} at ${cap}. It capped nothing, so a 600 kB name was written to a ` +
        'TEXT column and then flowed into every list response, every export, the HTML report and the ' +
        'backup archive.',
    );
  }
});

test('the import DTO accepts a fractional package weight', () => {
  const dto = read('backend/src/item/dto/bulk-import.dto.ts');
  assert.doesNotMatch(
    dto,
    /@IsInt\(\)[\s\S]{0,200}?packageWeight/,
    'packageWeight must not be integer-validated. The product\'s own item form offers it with ' +
      'step="0.001", so 1.5 is a legitimate weight and one decimal point in one cell used to fail the ' +
      'entire import with a validation array rendered into a toast.',
  );
});

test('an empty import is a refusal at the DTO, not a success at the service', () => {
  const dto = read('backend/src/item/dto/bulk-import.dto.ts');
  assert.match(
    dto,
    /@ArrayMinSize\(1\)/,
    'An empty list passed every rule, produced no rows, wrote no audit row, and answered 201 with zeros. ' +
      'A refusal reported as a success is worse than a rejection.',
  );
  assert.match(
    dto,
    /@ArrayMaxSize\(MAX_BULK_IMPORT_ROWS\)/,
    'The row cap must come from the shared limits module. It was a literal here and a different literal ' +
      'in the service, with no shared source.',
  );
  assert.ok(
    exists('backend/src/item/import-limits.ts'),
    'import-limits.ts must exist as the single source for the import row and batch limits.',
  );
  const limits = read('backend/src/item/import-limits.ts');
  for (const name of ['MAX_BULK_IMPORT_ROWS', 'BULK_IMPORT_BATCH_SIZE']) {
    assert.match(limits, new RegExp(`export const ${name}`), `${name} must be exported from one place.`);
  }
});

// ── Field rules must hold on every write path, not only the import ─────────────

test('an empty category is a bad request, not a server fault', () => {
  assert.match(
    schema,
    /category\s+String\s+@default\(/,
    'Item.category is expected to be NOT NULL with a default. If that changed, revisit this guard.',
  );
  const body = /private itemWriteData\([\s\S]*?\n  \}/.exec(itemService);
  assert.ok(body, 'itemWriteData must exist.');
  assert.doesNotMatch(
    body[0],
    /category:\s*dto\.category\?\.trim\(\)\s*\|\|\s*null/,
    'An empty category must fall back to the column default, not null. The column is NOT NULL, ' +
      'PrismaExceptionFilter does not catch PrismaClientValidationError, and the two create paths ' +
      'disagreed about the same input — one wrote the default, the other raised a 500.',
  );
});

test('the reorder threshold pair is checked on the values that will be stored', () => {
  assert.match(
    itemService,
    /private assertLimitOrder\(/,
    'A shared assertion must exist for the case only the database can answer: what a half-present pair ' +
      'will actually be written as.',
  );
  assert.doesNotMatch(
    itemService,
    /dto\.minLimit != null && dto\.maxLimit != null/,
    'Comparing only the two numbers in the payload let `{ minLimit: 5000 }` write an inverted pair — ' +
      'the exact state the import rejects.',
  );

  // create, update and the import reach the pair through `normalizeItemRow`, which
  // checks it on the values that will be stored. syncItems is the one that has to
  // consult the row first, because it upserts a half-present pair onto whatever is
  // already there, so it keeps the narrower method on top.
  for (const [label, signature, via] of [
    ['create', 'async create(', 'itemWriteData('],
    ['update', 'async update(', 'itemWriteData('],
    // The import reached `normalizeItemRow` directly until Wave 3 moved the rules
    // into `buildImportPlan`, which the write path and the dry run both call. Following
    // the call one level further is the same guarantee with one more hop, and the hop
    // is the point: a dry-run that re-derived its own rules would answer differently
    // from the write it is predicting.
    ['bulkImportFromExcel', 'async bulkImportFromExcel(', 'buildImportPlan('],
  ]) {
    const body = methodBody(code.item, signature);
    assert.match(
      body,
      new RegExp(via.replace('(', '\\(')),
      `${label} must reach the shared row rules through ${via}. The status filter and the dashboard ` +
        'threshold both read these columns, so an inverted pair is not cosmetic.',
    );
  }

  const sync = methodBody(code.item, 'async syncItems(');
  assert.match(
    sync,
    /assertLimitOrder\(/,
    'syncItems must consult the stored bounds. It upserts, so a half-present pair is validated against ' +
      'what will be written rather than against the fragment that arrived — and it is how the desktop ' +
      'client pushes a whole catalogue.',
  );
  assert.match(
    sync,
    /select:\s*\{\s*id:\s*true,\s*minLimit:\s*true,\s*maxLimit:\s*true\s*\}/,
    'The stored bounds must be selected in the same read. A second query between the check and the write ' +
      'is a window in which another session can change them.',
  );

  // And the plan must classify with the shared normaliser, rather than the import
  // normalising and then classifying. Otherwise there are two halves again, and the
  // dry run inherits whichever one it happened to call — which is precisely how a
  // preview comes to disagree with the write it was previewing.
  const plan = methodBody(code.batch, 'export const buildImportPlan');
  assert.match(
    plan,
    /normalizeItemRow\(item,\s*\{\s*requireCategory:\s*true,?\s*\}\)/,
    'buildImportPlan must classify rows with the shared normaliser. The import is a commit of this ' +
      'plan, and a plan built by other rules makes the preview a lie.',
  );
});

// ── Announcements must never decide the fate of a committed write ──────────────

test('every item write announces through the guarded helper', () => {
  const helper = /private emitItemsChanged\([\s\S]*?\n  \}/.exec(itemService);
  assert.ok(helper, 'emitItemsChanged must exist.');
  assert.match(
    helper[0],
    /catch\s*\(/,
    'emitSync is synchronous and unguarded (realtime.service.ts:39-50), so the guard belongs here.',
  );
  assert.match(
    helper[0],
    /console\.error\(/,
    'A lost announcement must be reported, not swallowed.',
  );

  // Counted against the file with the helper's own body removed: the one legitimate
  // `emitSync` in this module is the one inside the guarded helper, and a guard that
  // cannot tell it apart from an unguarded call site is a guard nobody trusts.
  const helperStart = code.item.indexOf('private emitItemsChanged');
  const nextBoundary = code.item.indexOf('\n  private ', helperStart + 10);
  // `indexOf` answers -1 when the helper is the last member of the class, and
  // `slice(-1)` then returns one character — which would leave the whole file
  // outside the helper and report a violation that does not exist.
  const helperEnd = nextBoundary > helperStart ? nextBoundary : code.item.length;
  const outsideHelper = code.item.slice(0, helperStart) + code.item.slice(helperEnd);
  const inline = [...outsideHelper.matchAll(/this\.realtimeService\.emitSync\(/g)];
  assert.equal(
    inline.length,
    0,
    `Found ${inline.length} direct emitSync call(s) outside the helper. Six of the seven write paths ` +
      'hand-rolled the identical scope array, so a guard added to one call site would have protected one ' +
      'route out of seven.',
  );
});

test('a reorder is announced after its transaction, never inside it', () => {
  const body = methodBody(code.item, 'async reorderItems');
  const transactionStart = body.indexOf('this.prisma.$transaction');
  const emit = body.indexOf('emitItemsChanged');
  assert.notEqual(emit, -1, 'reorderItems must announce its change.');
  assert.ok(
    emit > transactionStart,
    'The announcement must come after the transaction is awaited. Emitting from inside tells every ' +
      'connected client to refetch while the transaction can still roll back, and a rollback produces no ' +
      'second event to correct it.',
  );
});

test('applying or refreshing a saved order is announced at all', () => {
  assert.match(
    profileService,
    /private announceReorder\(/,
    'ItemOrderProfileService has injected RealtimeService since it was written without ever calling it.',
  );
  assert.match(
    profileService,
    /catch\s*\(/,
    'The announcement must be guarded for the same reason as every other one.',
  );
  for (const signature of ['async apply(', 'async refresh(']) {
    const body = methodBody(code.profile, signature);
    assert.match(
      body,
      /announceReorder\(/,
      `${signature} must announce. materialise rewrites Item.sortOrder for the whole catalogue — the ` +
        'column every list endpoint orders by — so an unannounced reorder leaves every other session ' +
        'showing an order that no longer exists.',
    );
    const emit = body.indexOf('announceReorder(');
    assert.ok(
      emit > body.indexOf('$transaction'),
      `${signature} must announce after the transaction resolves, for the same reason as reorderItems.`,
    );
  }
});
