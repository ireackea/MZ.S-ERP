import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const exists = (path) => existsSync(join(repoRoot, path));

/**
 * The same rule, written in four places, is now written in one.
 *
 * Four hand-maintained lists described the importable item fields and they did not
 * agree with each other:
 *
 *   The download template offered `currentStock`, which the server has no field for.
 *   With `forbidNonWhitelisted` that is a 400 for the whole request, so an operator
 *   who filled in their stock figures got a green preview and every item at zero.
 *   The alias table gave that field nine spellings at 99% confidence, the quality
 *   score counted it as one of ten passing checks, and the sidebar rendered it as a
 *   red "غير مطابق" forever, because no file could satisfy it.
 *
 *   The catalogue export omitted `packageWeight` entirely, so the export-then-import
 *   round trip a spreadsheet-shaped product invites zeroed every package weight.
 *
 *   `toImportPayload` folded `englishName` into `description` and dropped it, while
 *   the DTO still declared it and the service still had a fallback for it — dead
 *   code that looked alive.
 *
 * The guards below are written so that reintroducing a second list is the thing that
 * fails, not merely reintroducing a bug.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the four write paths share one set of row rules', () => {
  assert.ok(
    exists('backend/src/item/item-normalize.ts'),
    'backend/src/item/item-normalize.ts must exist. Four paths used to carry their own copy of these ' +
      'rules and had drifted: the import trimmed and formula-guarded, create did not, update compared ' +
      'limits against only the fields that arrived, and syncItems checked nothing.',
  );

  const normalize = read('backend/src/item/item-normalize.ts');
  for (const rule of [
    'ITEM_FIELD_LIMITS',
    'ITEM_NUMERIC_MAX',
    'DEFAULT_MIN_LIMIT',
    'DEFAULT_MAX_LIMIT',
    'DEFAULT_CATEGORY',
    'startsWithFormulaPrefix',
    'readItemNumber',
    'foldItemKey',
    'normalizeItemRow',
    'describeOverlong',
  ]) {
    assert.match(
      normalize,
      new RegExp(`export (const|function|type) ${rule}\\b`),
      `${rule} must be exported from the one place. A rule that is private cannot be reused, which is ` +
        'how the second copy appears.',
    );
  }

  const service = read('backend/src/item/item.service.ts');
  for (const [label, signature] of [
    ['create', 'async create('],
    ['update', 'async update('],
    ['syncItems', 'async syncItems('],
    ['bulkImportFromExcel', 'async bulkImportFromExcel('],
  ]) {
    assert.match(
      stripComments(service),
      new RegExp(`normalizeItemRow\\(`),
      'normalizeItemRow must be reachable from every write path. If one of them grew its own copy, ' +
        'this assertion is where it should be noticed.',
    );
    assert.ok(signature.length > 0);
    assert.ok(label.length > 0);
  }
});

test('the row rules are unit-tested without a database', () => {
  assert.ok(
    exists('backend/src/item/item-normalize.test.ts'),
    'The rules must be testable without Prisma. That is the reason they are pure functions, and the ' +
      'reason item.service has no unit tests at all: a rule that needs a connection to assert cannot be ' +
      'written as a unit test, so it goes untested.',
  );
  const spec = read('backend/src/item/item-normalize.test.ts');
  for (const behaviour of [
    'distinguishes a blank cell from a value that is not a number',
    'reads a percentage as a scale, not as a magnitude',
    'reports every problem with the row, not only the first',
    'requires a category only when the caller asks for it',
  ]) {
    assert.ok(
      spec.includes(behaviour),
      `A test for "${behaviour}" is expected. Each of these was a real behaviour difference between ` +
        'the four copies, and each is a regression someone will otherwise reintroduce.',
    );
  }
});

test('the field list is declared once and everything else derives from it', () => {
  assert.ok(exists('frontend/src/pages/items/import/import-fields.ts'), 'The single field list must exist.');

  const fields = read('frontend/src/pages/items/import/import-fields.ts');
  assert.match(fields, /export const IMPORT_FIELDS/, 'The list must be exported for the projections to use.');

  // The template, the alias table and the payload must all be projections.
  const service = stripComments(read('frontend/src/services/itemsService.ts'));
  assert.match(
    service,
    /IMPORTABLE_FIELDS/,
    'toImportPayload must build from the importable set. It used to be a destructuring line that listed ' +
      'which fields to drop, which is a second list of the same fact.',
  );

  const shared = read('frontend/src/pages/items/shared.ts');
  assert.match(
    shared,
    /buildImportTemplateRow\(\)/,
    'The template must be generated. A hand-written template row is what offered a column the server refuses.',
  );

  const page = stripComments(read('frontend/src/pages/items/ItemsPageContent.tsx'));
  assert.match(
    page,
    /IMPORT_FIELDS/,
    'The export must derive its columns from the list. It omitted packageWeight entirely because it was ' +
      'written from a different list than the one the matcher used.',
  );
});

test('no hand-written import field list survives anywhere', () => {
  // The shape is the giveaway: an object literal whose keys are importable field
  // names, declared outside import-fields.ts.
  const offenders = [];
  for (const path of [
    'frontend/src/pages/items/shared.ts',
    'frontend/src/services/itemsService.ts',
    'frontend/src/pages/items/ItemsPageContent.tsx',
  ]) {
    const source = stripComments(read(path));
    // A list that maps field names to Arabic labels is a second definition of the
    // fields. A single-key lookup in an unrelated object is not.
    if (/label:\s*'كود الصنف'/.test(source) || /'كود الصنف'\s*:/.test(source)) {
      offenders.push(path);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A hand-written import field list survives in: ${offenders.join(', ')}. The template, the export and ` +
      'the matcher must all be projections of import-fields.ts.',
  );
});

test('currentStock is declared, refused, and explained — not merely absent', () => {
  const fields = read('frontend/src/pages/items/import/import-fields.ts');
  assert.match(
    fields,
    /field:\s*'currentStock'/,
    'The field must be declared. Deleting it from the list would make the studio report a perfectly good ' +
      'stock column as "missing", which is the confusion this is meant to end.',
  );
  assert.match(fields, /importable:\s*false[\s\S]{0,200}?notImportableReason/, 'A refused field must say why.');
  assert.match(
    fields,
    /notImportableReason:\s*\n?\s*'[^']*(الرصيد|الحركات)/,
    'The reason must be in Arabic and must name the ledger, because that is what the operator needs to know: ' +
      'their figures went somewhere real, just not here.',
  );

  // And it must not be scored. It used to be one of ten quality checks, and the
  // check passed unconditionally because the parser had already defaulted it to 0.
  const intelligence = stripComments(read('frontend/src/pages/items/import/itemImportIntelligence.ts'));
  const qualityBlock = intelligence.slice(
    intelligence.indexOf('const qualityChecks'),
    intelligence.indexOf('qualityChecks.length'),
  );
  assert.doesNotMatch(
    qualityBlock,
    /currentStock/,
    'currentStock must not be a scored quality check. It always passed, so filling it in raised the score ' +
      'for data the import discards.',
  );
  assert.match(
    intelligence,
    /NON_IMPORTABLE_STOCK_MESSAGE/,
    'The studio must say once, in Arabic, that the column is not imported.',
  );
});

test('the import payload carries englishName instead of folding it into description', () => {
  const service = stripComments(read('frontend/src/services/itemsService.ts'));
  assert.doesNotMatch(
    service,
    /description\s*\|\|\s*englishName/,
    'englishName must not be folded into description. The template has two separate columns, and merging ' +
      'them meant whichever the operator filled in lost its own meaning while the DTO still declared both.',
  );
  assert.match(service, /payload\.englishName/, 'The payload must carry englishName as itself.');
  assert.match(service, /payload\.description/, 'The payload must carry description as itself.');
});
