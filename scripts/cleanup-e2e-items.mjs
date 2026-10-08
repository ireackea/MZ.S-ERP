/**
 * Remove e2e probe items from the database — explicitly, never automatically.
 *
 * ## Why this is a script and not a step in the suite runner
 *
 * The suite leaks roughly 48 items per run. That is untidy, and it used to be worse:
 * `items-order-profile` seeds *deterministic* names so that alphabetical order is the
 * reverse of creation order, and a second run collided with the first. That is fixed at
 * the source — the sweep now lives in a `finally` — and two consecutive runs pass.
 *
 * What remains is inert residue. This script exists so it can be cleared deliberately,
 * not so the suite can clear it by itself.
 *
 * The reason is not caution for its own sake. `items-order-profile.spec.ts` carries this
 * warning in its own comments: a wildcard cleanup *once deleted an operator's item*. The
 * suite runs against the same database the business uses. A runner step that deletes rows
 * on every invocation is one mistyped marker away from deleting something that matters,
 * and it would do it silently and quickly.
 *
 * ## Safety
 *
 * Three properties, and each one is load-bearing:
 *
 * 1. **An allow-list of prefixes, never a pattern.** Only `publicId`s that begin with one
 *    of the listed markers are considered. A marker that is not on the list is left
 *    alone, so a new spec cannot be swept by accident and an operator's `publicId` cannot
 *    be guessed at.
 * 2. **It prints what it will delete and stops**, unless `--apply` is passed.
 * 3. **Children first.** `Transaction` and `StockDeficit` cascade from `Item`, but
 *    `stocktaking_entries` is `RESTRICT`, so the statement would abort without them —
 *    and an aborted transaction deletes nothing, which is the behaviour we want from a
 *    destructive tool that goes wrong.
 *
 * Usage:
 *   node scripts/cleanup-e2e-items.mjs            # report only
 *   node scripts/cleanup-e2e-items.mjs --apply    # delete
 */
import { execFileSync } from 'node:child_process';

/** The `publicId` prefixes each spec mints for its own probes. */
const PROBE_PREFIXES = [
  'zz-e2e-',      // items-order-import, items-order-profile, and the import specs
  'd001-',        // data-001-decimal
  'def-',         // def-001-stock-deficit
  'stock-',       // stock-adjustment, inventory-boundary
  'attach-',      // item-attachments
  'rep-',         // report-contract
  'scope-',       // scope-isolation
  'api',          // items-api
  'data-',        // data-003-domains
  'phase1-',      // phase1-security
  'adjustment-',  // stock-adjustment
  'aud-',         // audit-durability
];

const apply = process.argv.includes('--apply');

const sql = (statement) =>
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql',
      '-U', process.env.POSTGRES_USER || 'feedfactory',
      '-d', process.env.POSTGRES_DB || 'feed_factory_db',
      '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8', timeout: 120_000 },
  ).trim();

const where = PROBE_PREFIXES
  .map((prefix) => `"publicId" LIKE '${prefix.replace(/'/g, "''")}%'`)
  .join(' OR ');

const report = `SELECT
  (SELECT count(*) FROM "Item" WHERE ${where}) AS items,
  (SELECT count(*) FROM "Transaction" WHERE "itemId" IN (SELECT id FROM "Item" WHERE ${where})) AS txns,
  (SELECT count(*) FROM "StockDeficit" WHERE "itemId" IN (SELECT id FROM "Item" WHERE ${where})) AS deficits,
  (SELECT count(*) FROM stocktaking_entries WHERE "itemId" IN (SELECT id FROM "Item" WHERE ${where})) AS entries;
`;

// Four columns, four names. This previously read five — `[, items, txns, deficits,
// entries]` — so every number was shifted one to the left and the last printed as
// `undefined`. On a tool whose only output is "this many rows I am about to delete", a
// shifted count is worse than none: it reports 39 when it means 10. The stray `undefined`
// is what exposed it, which is why the dry run exists and why this now refuses to
// continue unless all four arrived.
const parts = sql(report).split('|').map((part) => part.trim());
const [items, txns, deficits, entries] = parts;
if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
  console.error(`report returned ${parts.length} columns (${JSON.stringify(parts)}); refusing to continue.`);
  process.exit(1);
}

console.log(`probe prefixes: ${PROBE_PREFIXES.join(' ')}`);
console.log(`would delete — items: ${items} · transactions: ${txns} · deficits: ${deficits} · entries: ${entries}`);
console.log(`would KEEP   — every other row, including all operator data.`);

if (!apply) {
  console.log('\ndry run. pass --apply to delete.');
  process.exit(0);
}

if (Number(items) === 0) {
  console.log('\nnothing to do.');
  process.exit(0);
}

const statement = `
BEGIN;
DELETE FROM stocktaking_entries WHERE "itemId" IN (SELECT id FROM "Item" WHERE ${where});
DELETE FROM "StockDeficit"      WHERE "itemId" IN (SELECT id FROM "Item" WHERE ${where});
DELETE FROM "Item"              WHERE ${where};
COMMIT;
`;

console.log('\ndeleting…');
sql(statement);
console.log('done.');