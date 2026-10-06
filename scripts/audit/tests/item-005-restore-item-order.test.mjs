import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');

/**
 * A restore must not be able to hand back a catalogue nobody ordered.
 *
 * `20260928090000_add_item_sort_order` gave the column a default of 1000000 and
 * `20260928110000_normalise_item_sort_order` then split every rank that collided
 * on it. The second migration is a one-off. It does not re-run when data comes
 * back, and data comes back on every restore: `restorePrismaSnapshot` re-inserts
 * items with `createMany`, which lets every column take its default.
 *
 * So a snapshot taken before the column existed replays the whole catalogue onto
 * 1000000 — the exact collision the migration repaired — and the read path breaks
 * the tie by id, so the restored order is an accident. Nobody sees an error. The
 * operator arranged 648 items, restored from a backup taken an hour earlier, and
 * got a different catalogue with no message explaining why.
 *
 * The rule this encodes: after the items are re-inserted, the restore path repairs
 * shared ranks itself. It is the only moment the entire catalogue lands at once.
 */
const backupService = read('backend/src/backup/backup.service.ts');

test('the restore path repairs ranks that a snapshot collapsed onto the column default', () => {
  // Scope to the snapshot restore, not the whole file, so this cannot be satisfied
  // by an unrelated statement elsewhere in a 2000-line service.
  const start = backupService.indexOf('private async restorePrismaSnapshot');
  const alternative = backupService.indexOf('async restorePrismaSnapshot');
  const anchor = start >= 0 ? start : alternative;
  assert.notEqual(anchor, -1, 'If the method was renamed, point this guard at the new name rather than deleting it.');

  const end = backupService.indexOf('\n  async ', anchor);
  const body = backupService.slice(anchor, end === -1 ? undefined : end);

  assert.match(
    body,
    /item\.createMany/,
    'The restore must still re-insert items, or this guard is pointed at the wrong method.',
  );
  assert.match(
    body,
    /GROUP BY "sortOrder"[\s\S]*?HAVING count\(\*\) > 1/,
    'The restore must detect a shared rank. Without the detection a healthy restore pays for two window functions over the whole catalogue on every run.',
  );
  assert.match(
    body,
    /PARTITION BY "sortOrder"/,
    'A shared rank must be split rather than left alone. Splitting is what keeps each cluster in its existing order instead of alphabetising it.',
  );
  assert.match(
    body,
    /WHERE "sortOrder" IS NULL/,
    'Rows that arrived with no rank must join the end deterministically, the same way 20260928110000 did, or the tail of the catalogue is arbitrary.',
  );
  assert.match(
    body,
    /syncPrimaryKeySequences/,
    'The sequence sync must stay in this method. createMany with explicit ids does not advance the Item id sequence, so a restore followed by an import would collide on the primary key.',
  );
});

test('the sortOrder default is declared in the schema, not only in a migration', () => {
  const schema = read('backend/prisma/schema.prisma');
  assert.match(
    schema,
    /sortOrder\s+Int\?\s+@default\(1000000\)/,
    'The migration 20260928090000 sets DEFAULT 1000000 in the database, but an undeclared default is drift: the next `prisma migrate dev` emits a migration to drop it, and the column then stops doing the one job its comment says it does — parking a row inserted by any path at the end of the catalogue. If the model legitimately no longer has a default, change the migration too and say why here.',
  );
});

test('the repair is guarded by a count, not run unconditionally on every restore', () => {
  const detection = backupService.indexOf('GROUP BY "sortOrder"');
  assert.notEqual(detection, -1, 'the shared-rank detection must exist');

  // Positively assert the guard rather than asserting the absence of the write:
  // a regex for "this must not appear here" passes vacuously once someone moves
  // the statement, which is the failure mode this file exists to prevent.
  assert.match(
    backupService,
    /if\s*\(\s*Number\(sharedRanks\[0\]\?\.count\s*\?\?\s*0n\)\s*>\s*0\s*\)\s*\{\s*await tx\.\$executeRaw/,
    'The rank-splitting statement must sit inside the count check. Both it and the unranked-tail statement are O(n log n) over the whole catalogue, and this code path runs on every restore, so an unguarded form taxes a healthy restore to prevent a rare one.',
  );
  assert.match(
    backupService,
    /if\s*\(\s*Number\(unranked\[0\]\?\.count\s*\?\?\s*0n\)\s*>\s*0\s*\)\s*\{\s*await tx\.\$executeRaw/,
    'The unranked-tail statement must be guarded the same way. Most snapshots carry a rank for every row, so this one is almost always a no-op and must not cost a window function.',
  );
});
