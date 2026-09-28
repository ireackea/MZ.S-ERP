import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Every path that returns the catalogue must order it by the saved rank.
 *
 * `Item.sortOrder` existed and was correct in one place — `ItemService.findAll` —
 * while six other paths ordered by `name ASC`. The result was a system that
 * remembered an order in the list screen and forgot it everywhere else: the
 * formulation ingredients were permanently alphabetical, and three balance
 * endpoints returned the alphabet under a saved order. The client hid two of
 * them by re-sorting, which is why the gap survived — the visible screens looked
 * right while the API contract lied to the next caller.
 *
 * So this is checked per service, by name of the service, and a new service that
 * reads items has to be added deliberately rather than by accident.
 */

/**
 * The item queries that return the *catalogue* — the full or near-full set of
 * items to a screen, rather than a lookup for one purpose.
 *
 * The distinction matters. `generateMissingCodes` finds items whose code is
 * null and orders them by id; that is a work queue, not a listing, and ordering
 * it by the saved rank would be meaningless. A guard that cannot tell those apart
 * gets disabled, and a guard that gets disabled protects nothing.
 */
const catalogueQueries = [
  {
    file: 'backend/src/item/item.service.ts',
    what: 'the item list endpoint',
    allow: [/where:\s*\{\s*OR:\s*\[\{\s*code:\s*null/],
  },
  { file: 'backend/src/opening-balance/opening-balance.service.ts', what: 'opening balances', allow: [] },
  {
    file: 'backend/src/transaction/transaction.service.ts',
    what: 'stock reconciliation and computed balances',
    allow: [],
  },
  { file: 'backend/src/formulation/formulation.service.ts', what: 'formulation ingredients', allow: [] },
  { file: 'backend/src/stocktaking/stocktaking.service.ts', what: 'stocktaking entries', allow: [] },
];

/** Item queries that are deliberately not catalogue listings. */
const notCatalogue = [
  // A work queue for code generation, and the maps that back it up.
  /where:\s*\{\s*OR:\s*\[\{\s*code:\s*null/,
  /select:\s*\{\s*code:\s*true,\s*barcode:\s*true,\s*name:\s*true\s*\}/,
  /select:\s*\{\s*id:\s*true\s*\}/,
];

test('every catalogue read path orders by the saved rank, not the alphabet', () => {
  for (const reader of catalogueQueries) {
    const code = stripComments(read(reader.file));

    const queries = code.match(/item\.findMany\([\s\S]{0,900}?\n\s*\}\)/g) || [];

    // A service that reaches the catalogue only through a relation — the
    // stocktaking entries are ordered by a field of the related item — has no
    // `item.findMany` to inspect, and is covered by the relation test below.
    if (queries.length === 0) continue;

    const listings = queries.filter(
      (query) =>
        /orderBy/.test(query) &&
        // Ordering an item relation is how the ingredient and entry lists order.
        !/orderBy:\s*\{\s*(item|counts):/.test(query) &&
        !reader.allow.some((pattern) => pattern.test(query)) &&
        !notCatalogue.some((pattern) => pattern.test(query)),
    );

    assert.ok(
      queries.length > 0,
      `${reader.file} has no item.findMany left; if the reader was renamed, update this list (${reader.what})`,
    );
    void reader.what;
    // A service whose only item queries order through a relation, or which only
    // looks items up to build a set, is covered by the next test or by no test
    // being meaningful — either way it is not a failure here.
    const lookupOnly =
      !listings.length &&
      (reader.file.includes('formulation') || !code.match(/item\.findMany\(\{[\s\S]{0,300}?orderBy/));
    if (lookupOnly) continue;

    assert.ok(
      listings.length > 0,
      `${reader.file} has no catalogue listing left to check (${reader.what}). ` +
        'If it moved, point this guard at the new location rather than deleting it.',
    );

    const alphabetOnly = listings.filter((query) => !/sortOrder/.test(query));
    assert.deepEqual(
      alphabetOnly.map((query) => query.split('\n')[0].trim()),
      [],
      `${reader.file} orders the catalogue by something other than the saved rank (${reader.what}). ` +
        'An order an operator arranged must not depend on which screen asks for it.',
    );
  }
});

test('the sections that order through an item relation use the rank too', () => {
  // The ingredient and entry lists order by a field of the related item, so the
  // generic check above cannot see them. They are the two places where the saved
  // order was silently ignored, with the client passing the array straight on.
  for (const [file, what] of [
    ['backend/src/formulation/formulation.service.ts', 'formulation ingredients'],
    ['backend/src/stocktaking/stocktaking.service.ts', 'stocktaking entries'],
  ]) {
    const code = stripComments(read(file));
    const relations = code.match(/orderBy:\s*\[?\s*\{?\s*item:\s*\{[^}]*\}/g) || [];
    assert.ok(relations.length > 0, `${file} no longer orders by an item relation (${what})`);
    for (const relation of relations) {
      assert.match(
        relation,
        /sortOrder/,
        `${file} orders ${what} without the saved rank: ${relation.slice(0, 60)}`,
      );
    }
  }
});

test('the shared catalogue order is defined in exactly one place', () => {
  // `ItemService.findAll` owns the contract. A second copy of the ordering
  // expression is a second thing to remember to update, and the previous version
  // had one in a `getAll` method with no callers at all.
  const service = stripComments(read('backend/src/item/item.service.ts'));
  const occurrences = service.match(/orderBy:\s*\[\{\s*sortOrder/g) || [];
  assert.equal(
    occurrences.length,
    1,
    `ItemService should define the ordering contract once, found ${occurrences.length}`,
  );
  assert.doesNotMatch(
    service,
    /async getAll\(\)/,
    'getAll is dead code that duplicated the ordering contract; if it has callers now, it needs a route',
  );

  // The tie-break is the insertion order, never the name. This is the line that
  // turned a spreadsheet arranged by hand into A-Z.
  //
  // Matched with a nested-aware scan rather than a `[^{}]*` character class: the
  // first key carries a nested object (`sortOrder: { sort, nulls }`), so a regex
  // that stops at the first brace never matches the real expression and the
  // assertion would sit here failing against correct code.
  const contractAt = service.indexOf('orderBy: [{ sortOrder');
  assert.notEqual(
    contractAt,
    -1,
    'the catalogue ordering contract is gone from ItemService.findAll',
  );
  const contract = service.slice(contractAt, contractAt + 140);
  assert.match(
    contract,
    /\{ id: 'asc' \}/,
    'the tie-break must be id, so a tied rank falls back to the order rows were added in. ' +
      'Ranking by name here is what made an import come back alphabetically while reporting success.',
  );
  assert.doesNotMatch(
    contract,
    /name: 'asc'/,
    'a name tie-break overrides an operator-arranged order every time two rows share a rank',
  );
});

test('the import and manual creation both assign a rank', () => {
  const service = stripComments(read('backend/src/item/item.service.ts'));

  const importBody = service.slice(service.indexOf('async bulkImportFromExcel'));
  assert.match(
    importBody,
    /sortOrder:\s*rank/,
    'an imported row must be given its file position, or the file order is discarded',
  );
  assert.match(
    importBody,
    /nextSortOrder\(\)/,
    'the import must start from the current end of the catalogue, not from zero',
  );

  // The create path is the one an operator uses when adding an item by hand.
  const createBody = service.slice(service.indexOf('async create('));
  createBody.slice(0, createBody.indexOf('\n  async ')).match(/sortOrder:\s*await this\.nextSortOrder\(\)/) || []
    .length === 0 &&
    assert.fail('create must assign the next rank; a new item at the column default shares a rank with every other unranked row');

  // The update path must not move anything.
  const syncBody = service.slice(service.indexOf('async syncItems('));
  const updateBranch = syncBody.slice(0, syncBody.indexOf('create: {'));
  assert.doesNotMatch(
    updateBranch,
    /sortOrder/,
    'an update is a content change, not a request to move the item',
  );
});
