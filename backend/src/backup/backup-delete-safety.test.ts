import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B2 — deleting a backup is the one action in this section with no confirmation
 * step and no copy afterwards.
 *
 * Everything here used to report success it had not earned:
 *
 * - `readManifest` → `splice` → `writeManifest` → `unlink(...).catch(() => undefined)`,
 *   with no lock. A backup created in that window had its row erased, orphaning the
 *   file: invisible in the list, absent from the reported total, never pruned, and
 *   unaddressable by id. The archive existed and the system said it did not.
 * - A failed `unlink` was swallowed, so `{deleted: true}` was returned for a
 *   deletion that had not happened.
 * - An unknown id returned `200 {deleted: false}`, which the interface renders as a
 *   successful delete.
 * - Nothing stopped the last backup from being deleted. `findBackupById` then
 *   returns null for every id and `monitoring.service` answers
 *   `SYSTEM_RESET_BACKUP_MISSING` — a factory reset refuses, from one click.
 * - Nothing stopped a restore's undo from being deleted while the operator was
 *   still looking at the confirmation screen.
 *
 * The service is constructed against a temporary working directory so the test
 * exercises the real method against real files, and cannot touch the deployment's
 * own `backups/`.
 */

const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  fileName: `${id}.ffbkp`,
  type: 'full',
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  sizeBytes: 10,
  checksumSha256: 'a'.repeat(64),
  integrity: 'verified',
  complete: true,
  trigger: 'manual',
  actor: { type: 'user', mode: 'manual' },
  metadata: { users: 0, items: 0, openingBalances: 0, transactions: 0, configFiles: 0 },
  ...overrides,
});

describe('deleting a backup', () => {
  let workspace: string;
  let previousCwd: string;
  let service: BackupService;

  const backupDir = () => path.join(workspace, 'backups');

  const seed = (rows: Record<string, unknown>[], files: string[] = []) => {
    writeFileSync(path.join(backupDir(), 'index.json'), JSON.stringify(rows, null, 2), 'utf8');
    for (const name of files) writeFileSync(path.join(backupDir(), name), 'archive', 'utf8');
  };

  const manifest = () => JSON.parse(readFileSync(path.join(backupDir(), 'index.json'), 'utf8'));

  beforeEach(async () => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-delete-'));
    mkdirSync(backupDir(), { recursive: true });
    // `backupDir` is a field initialiser, so it resolves `cwd` at construction.
    process.chdir(workspace);
    service = new BackupService({} as never, {} as never);
    // The constructor bootstraps the workspace without awaiting it. Awaiting the same
    // idempotent call here makes the fixture deterministic instead of racing a timer.
    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses to delete the last backup, because a reset then has nothing to restore', async () => {
    seed([entry('only')], ['only.ffbkp']);

    await expect(service.deleteBackup('only')).rejects.toThrow(/النسخة الأخيرة/);

    // The refusal must leave everything as it was — an exception that half-applied
    // would be worse than the original bug.
    expect(manifest()).toHaveLength(1);
    expect(existsSync(path.join(backupDir(), 'only.ffbkp'))).toBe(true);
  });

  it('deletes a backup when another one remains, and removes the file with the row', async () => {
    seed([entry('a'), entry('b')], ['a.ffbkp', 'b.ffbkp']);

    await expect(service.deleteBackup('a')).resolves.toEqual({ deleted: true });

    expect(manifest().map((row: { id: string }) => row.id)).toEqual(['b']);
    expect(existsSync(path.join(backupDir(), 'a.ffbkp')), 'the row is gone, so the file must be too').toBe(false);
    expect(existsSync(path.join(backupDir(), 'b.ffbkp')), 'the untouched backup must survive').toBe(true);
  });

  it('answers 404 for an id that is not in the manifest, not 200 with deleted:false', async () => {
    seed([entry('a'), entry('b')], ['a.ffbkp', 'b.ffbkp']);

    // The old shape: `{deleted: false}` inside a 200. The interface shows a success
    // toast, so a stale bookmark looked exactly like a working delete.
    await expect(service.deleteBackup('does-not-exist')).rejects.toMatchObject({
      status: 404,
    });
    expect(manifest()).toHaveLength(2);
  });

it('treats a file that is already gone as a successful delete, not a failure to undo', async () => {
    // This test used to assert the opposite, and that assertion is what kept a real bug
    // alive: `unlink` failing with ENOENT was read as "the delete did not happen", so the
    // row was written back. ENOENT means the file is *already absent* — which is the
    // outcome the delete wanted.
    //
    // Restoring the row anyway produced an index entry pointing at a file that does not
    // exist. Nothing can repair it: reconciliation skips tracked files, so the phantom
    // row survives every sweep, and no restore can use it. It surfaced in production as
    // three such rows on a live server, and only under repeated deletes.
    seed([entry('a'), entry('b')], ['b.ffbkp']);
    // `a.ffbkp` is deliberately not created.

    await expect(service.deleteBackup('a')).resolves.toEqual({ deleted: true });

    // The row goes, because the row described something that no longer exists.
    expect(manifest().map((row: { id: string }) => row.id)).toEqual(['b']);
    expect(existsSync(path.join(backupDir(), 'a.ffbkp'))).toBe(false);
  });

  it('restores the row when the file genuinely cannot be removed', async () => {
    // The undo is still correct — but only for a real failure. A directory standing where
    // the archive should be makes `unlink` fail with something other than ENOENT.
    seed([entry('a'), entry('b')], ['b.ffbkp']);
    mkdirSync(path.join(backupDir(), 'a.ffbkp'), { recursive: true });

    await expect(service.deleteBackup('a')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BACKUP_DELETE_FAILED' }),
    });

    // The row is back, because the file is still there and nothing tracks it otherwise.
    expect(manifest().map((row: { id: string }) => row.id).sort()).toEqual(['a', 'b']);
  });

  it('refuses to delete the safety snapshot a confirmed-later restore depends on', async () => {
    seed([entry('snapshot', { type: 'safety_snapshot' }), entry('b')], ['snapshot.ffbkp', 'b.ffbkp']);

    // A live preview token, minted the way `createRestorePreview` mints one.
    const token = {
      backupId: 'b',
      safetySnapshotId: 'snapshot',
      expiresAt: Date.now() + 60_000,
      backupFileName: 'b.ffbkp',
      backupChecksumSha256: 'a'.repeat(64),
    };
    (service as never as { restoreTokens: Map<string, unknown> }).restoreTokens.set('live-token', token);

    await expect(service.deleteBackup('snapshot')).rejects.toThrow(/لقطة السلامة/);
    expect(manifest()).toHaveLength(2);
    expect(existsSync(path.join(backupDir(), 'snapshot.ffbkp'))).toBe(true);

    // An expired token is not a claim on anything. The promise of an undo does not
    // outlive the window in which the operator can take it.
    (token as { expiresAt: number }).expiresAt = Date.now() - 1;
    await expect(service.deleteBackup('snapshot')).resolves.toEqual({ deleted: true });
    expect(manifest()).toHaveLength(1);
  });

  it('leaves an unpinned safety snapshot deletable, because retention still needs a bound', async () => {
    // The refusal above is scoped to snapshots a restore is waiting on. A blanket
    // "never delete a snapshot" would make the store grow by a full database dump
    // per restore attempt, on a path nobody watches — so the exemption must be
    // narrow, and this is what keeps it narrow.
    seed([entry('snapshot', { type: 'safety_snapshot' }), entry('b')], ['snapshot.ffbkp', 'b.ffbkp']);

    await expect(service.deleteBackup('snapshot')).resolves.toEqual({ deleted: true });
  });
});
