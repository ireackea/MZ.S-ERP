import { describe, expect, it } from 'vitest';
import {
  archiveIsRestorable,
  archiveMigrationNames,
  missingMigrations,
} from './schema-drift';

/**
 * Restoring an archive taken before a migration shipped.
 *
 * The failure this prevents is quiet, which is why it is worth a test. `pg_restore`
 * restores the schema and `_prisma_migrations` together, so an older archive
 * rolls the application back to a schema the running image does not expect while
 * the database goes on claiming the newer migration ran. `migrate deploy` then
 * reports everything applied and changes nothing, and every request touching the
 * missing column fails with a query error and no migration error anywhere near it.
 *
 * That happened here: `Item.sortOrder` had been added, an archive from before it
 * was restored, the column was gone, the migrations table said it was applied, and
 * every item-reorder request returned a 500 until the column was recreated by hand.
 * The data came back. The schema did not, and nothing said so.
 */

const CURRENT = [
  '20260927100000_add_system_settings',
  '20260927110000_audit_log_indexes',
  '20260928090000_add_item_sort_order',
  '20260928110000_normalise_item_sort_order',
];

describe('the migrations an archive records', () => {
  it('reads the names the manifest carries', () => {
    expect(archiveMigrationNames({ migrations: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('ignores a schemaVersion count, which cannot be compared to a name', () => {
    // The original manifest recorded only a count. Folding that in would compare
    // the number 4 against migration directory names, so every archive would look
    // stale and every restore would be refused.
    expect(archiveMigrationNames({ schemaVersion: '4' })).toEqual([]);
    expect(archiveMigrationNames({ migrations: CURRENT, schemaVersion: '4' })).toEqual(CURRENT);
  });

  it('treats a manifest without migrations as carrying none', () => {
    expect(archiveMigrationNames(null)).toEqual([]);
    expect(archiveMigrationNames({})).toEqual([]);
    expect(archiveMigrationNames({ migrations: 'nope' })).toEqual([]);
  });
});

describe('deciding whether an archive may be restored', () => {
  it('refuses an archive that predates the newest migration', () => {
    // The archive from before Item.sortOrder shipped: it carries the first two.
    const verdict = archiveIsRestorable(CURRENT.slice(0, 2), CURRENT);

    expect(verdict.restorable).toBe(false);
    expect(verdict.missing).toEqual([
      '20260928090000_add_item_sort_order',
      '20260928110000_normalise_item_sort_order',
    ]);
  });

  it('refuses even when the counts agree', () => {
    // The case a count cannot catch: the image added one migration and dropped
    // another, so the totals match while the schemas do not.
    const archive = ['some_other_migration'];
    expect(archive.length).toBe(1);
    expect(missingMigrations(archive, CURRENT).length).toBe(CURRENT.length);
    expect(archiveIsRestorable(archive, CURRENT).restorable).toBe(false);
  });

  it('allows an archive that carries every migration', () => {
    expect(archiveIsRestorable(CURRENT, CURRENT)).toEqual({ restorable: true, missing: [] });
  });

  it('allows an archive that is ahead of this image', () => {
    // The image is stale, not the data. Refusing here would block a legitimate
    // recovery, so only the stale direction is enforced.
    expect(archiveIsRestorable([...CURRENT, 'a_newer_migration'], CURRENT).restorable).toBe(true);
  });

  it('refuses an archive that records nothing, because an unknown schema is not vouched for', () => {
    expect(archiveIsRestorable([], CURRENT).restorable).toBe(false);
  });

  it('allows anything when the image cannot read its own migrations', () => {
    // A stripped image has no migrations directory. Refusing every restore there
    // would be worse than the drift it prevents, and the check is a guard rather
    // than the primary safety mechanism.
    expect(archiveIsRestorable([], [])).toEqual({ restorable: true, missing: [] });
  });
});
