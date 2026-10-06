#!/usr/bin/env node
// FC-ITEM-IMPORT — the read-only conflict report that Wave 1 step 3 depends on.
//
// The rule this exists to enforce is in the plan: no migration before an actual
// conflict report. A unique index on `lower("code")` cannot be created on a
// catalogue that already holds two rows differing only by case, and discovering
// that while the migration runs turns a data fix into an outage. So this script
// looks first, prints exactly what it found, and changes nothing.
//
// It also reports the two things that make the index worth having at all:
// how many rows have no code, and how many share a barcode. A catalogue where
// most rows are codeless is a catalogue where the import's duplicate check has
// nothing to match on, which is the other half of the same defect.
//
// Read-only by construction: every statement is a SELECT, the connection is
// opened read-only, and the script exits 1 when a conflict exists so a pipeline
// can gate on it without parsing the output.
//
// Usage:
//   node scripts/audit/item-import-duplicate-probe.mjs
//   E2E_BASE_URL=... node scripts/audit/item-import-duplicate-probe.mjs
//
// The connection string is read from DATABASE_URL so it works identically on the
// host and inside the backend container.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readEnvFile = (relative) => {
  try {
    return readFileSync(join(repoRoot, relative), 'utf8');
  } catch {
    return '';
  }
};

const envValue = (key) => {
  const fromProcess = String(process.env[key] || '').trim();
  if (fromProcess) return fromProcess;
  for (const file of ['.env', 'backend/.env']) {
    const line = readEnvFile(file)
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${key}=`));
    if (!line) continue;
    const value = line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
    if (value) return value;
  }
  return '';
};

const connectionString = envValue('DATABASE_URL') || envValue('DATABASE_DIRECT_URL');
if (!connectionString) {
  console.error('duplicate-probe: no DATABASE_URL. Set it, or run this from the repository root where .env lives.');
  process.exit(2);
}

let pg;
try {
  ({ default: pg } = await import('pg'));
} catch {
  console.error('duplicate-probe: the `pg` package is not resolvable from here.');
  console.error('Run it from the repository root, or as: docker compose exec backend node <this file>.');
  process.exit(2);
}

// `options: '-c default_transaction_read_only=on'` makes every statement in this
// session a read. A bug in a query string therefore cannot write even if the
// statement is wrong, which is the property that makes it safe to point at a
// production catalogue.
const client = new pg.Client({ connectionString, options: '-c default_transaction_read_only=on' });

const QUERIES = {
  totals: `
    SELECT
      (SELECT count(*) FROM "Item") AS items,
      (SELECT count(*) FROM "Item" WHERE "code" IS NULL) AS codeless,
      (SELECT count(*) FROM "Item" WHERE "barcode" IS NULL) AS baredless,
      (SELECT count(*) FROM "Item" WHERE "isArchived") AS archived`,
  codeConflicts: `
    SELECT lower(btrim("code")) AS folded, count(*) AS rows, array_agg("id" ORDER BY "id") AS ids,
           array_agg("code" ORDER BY "id") AS spellings
      FROM "Item"
     WHERE "code" IS NOT NULL AND btrim("code") <> ''
     GROUP BY lower(btrim("code"))
    HAVING count(*) > 1
     ORDER BY folded`,
  barcodeConflicts: `
    SELECT lower(btrim("barcode")) AS folded, count(*) AS rows,
           array_agg("id" ORDER BY "id") AS ids, array_agg("barcode" ORDER BY "id") AS spellings
      FROM "Item"
     WHERE "barcode" IS NOT NULL AND btrim("barcode") <> ''
     GROUP BY lower(btrim("barcode"))
    HAVING count(*) > 1
     ORDER BY folded`,
  // A code that differs from its own folded form is harmless on its own, but it
  // is the reason the conflict list above is short: an operator can create `ABC`
  // today and `abc` next week, and until the second one exists nothing looks
  // wrong. This shows how much of the catalogue is already in that state.
  mixedCase: `
    SELECT count(*) AS rows
      FROM "Item"
     WHERE "code" IS NOT NULL AND "code" <> lower("code")`,
  whitespace: `
    SELECT count(*) AS rows
      FROM "Item"
     WHERE "code" IS NOT NULL AND btrim("code") <> "code"`,
};

const pad = (value, width) => String(value ?? '').padEnd(width);

try {
  await client.connect();

  const totals = (await client.query(QUERIES.totals)).rows[0];
  console.log('duplicate-probe — read-only. Nothing is written.');
  console.log('');
  console.log(`items        ${totals.items}`);
  console.log(`codeless     ${totals.codeless}`);
  console.log(`barcode-less ${totals.baredless}`);
  console.log(`archived     ${totals.archived}`);

  const mixedCase = (await client.query(QUERIES.mixedCase)).rows[0].rows;
  const whitespace = (await client.query(QUERIES.whitespace)).rows[0].rows;
  console.log(`mixed-case   ${mixedCase} code(s) not already lowercase`);
  console.log(`padded       ${whitespace} code(s) with surrounding whitespace`);
  console.log('');

  const codeConflicts = (await client.query(QUERIES.codeConflicts)).rows;
  const barcodeConflicts = (await client.query(QUERIES.barcodeConflicts)).rows;

  console.log(`code conflicts (case-insensitive): ${codeConflicts.length}`);
  for (const row of codeConflicts) {
    console.log(`  ${pad(row.folded, 32)} rows=${row.rows} ids=[${row.ids}] spellings=[${row.spellings}]`);
  }

  console.log(`barcode conflicts (case-insensitive): ${barcodeConflicts.length}`);
  for (const row of barcodeConflicts) {
    console.log(`  ${pad(row.folded, 32)} rows=${row.rows} ids=[${row.ids}] spellings=[${row.spellings}]`);
  }

  console.log('');

  const totalConflicts = codeConflicts.length + barcodeConflicts.length;
  if (totalConflicts === 0) {
    console.log('VERDICT: clear. A partial unique index on lower("code") and lower("barcode") can be created.');
    if (totals.codeless > 0) {
      console.log('');
      console.log(
        `NOTE: ${totals.codeless} item(s) have no code. The import only de-duplicates on code and ` +
          'barcode, and the studio\'s fuzzy name match is a warning whose default decision is "create", ' +
          'so re-importing a codeless file duplicates it silently. That is a separate defect from the ' +
          'index and it is not fixed by one.',
      );
    }
    process.exit(0);
  }

  console.log('VERDICT: conflicts exist. The index cannot be created until these are resolved by hand.');
  console.log('Do not resolve them automatically: merging or deleting an item is an operator decision,');
  console.log('and each one may already have transactions, opening balances or order lines.');
  process.exit(1);
} catch (error) {
  console.error('duplicate-probe failed:', error instanceof Error ? error.message : String(error));
  process.exit(2);
} finally {
  await client.end().catch(() => undefined);
}
