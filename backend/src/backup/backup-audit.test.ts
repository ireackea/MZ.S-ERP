import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B4 — the seven events the backup section must leave behind.
 *
 * The section wrote no audit rows at all. `BACKUP_CREATE`, `BACKUP_RESTORE` and
 * `BACKUP_DELETE` were declared in the action union and referenced by nothing, so
 * after restoring the entire database, or after deleting the only copy of it, the
 * answer to "who did this" was nothing at all. For the operations in this file that
 * is the specific gap that matters: they are the ones that cannot be undone and
 * cannot be reconstructed from the data afterwards.
 *
 * The assertions below are about the two properties that make an audit trail worth
 * having, not about coverage counts:
 *
 * - **After the outcome.** A row written before a restore is a row claiming a
 *   restore that may have died halfway, and the failure row then contradicts it.
 * - **Never fatal.** These are file operations, not database transactions, so the
 *   row cannot share a `tx` with the change it describes. If it cannot be written,
 *   the operator's action must still stand — otherwise a failed audit turns a
 *   successful backup into a 500, which is a worse system than no audit.
 *
 * A fake audit service is used rather than Prisma: what is being tested is the
 * service's obligation to record, its ordering, and its behaviour when recording
 * fails — none of which need a database.
 */

type AuditCall = { action: string; entityId: string; status: string; details: any; username: string };

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

describe('the backup audit trail', () => {
  let workspace: string;
  let previousCwd: string;
  let calls: AuditCall[];
  let failNextWrite = false;
  let service: BackupService;

  const backupDir = () => path.join(workspace, 'backups');

  const seed = (rows: Record<string, unknown>[], files: string[] = []) => {
    writeFileSync(path.join(backupDir(), 'index.json'), JSON.stringify(rows, null, 2), 'utf8');
    for (const name of files) writeFileSync(path.join(backupDir(), name), 'archive', 'utf8');
  };

  const actions = () => calls.map((call) => call.action);

  beforeEach(async () => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-audit-'));
    mkdirSync(backupDir(), { recursive: true });
    process.chdir(workspace);
    calls = [];
    failNextWrite = false;

    const audit = {
      logItemAction: async (
        _userId: string,
        action: string,
        _entityType: string,
        entityId: string,
        details: any,
        username: string,
        status: string,
      ) => {
        if (failNextWrite) throw new Error('audit table unavailable');
        calls.push({ action, entityId, status, details, username });
      },
    };

    service = new BackupService({} as never, {} as never, audit as never);

    // The constructor bootstraps the workspace without awaiting it. Awaiting the same

    // idempotent call here makes the fixture deterministic instead of racing a timer.

    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('records a deletion, and names the actor and the file that went', async () => {
    seed([entry('a'), entry('b')], ['a.ffbkp', 'b.ffbkp']);

    await service.deleteBackup('a', { type: 'user', mode: 'manual', username: 'admin', role: 'admin' });

    expect(actions()).toEqual(['BACKUP_DELETED']);
    expect(calls[0]).toMatchObject({ action: 'BACKUP_DELETED', entityId: 'a', status: 'SUCCESS' });
    // The reason for a refusal is the interesting part of a refusal, and it lives
    // in the exception body rather than in `error.message`.
    expect(calls[0].details.fileName).toBe('a.ffbkp');
    expect(calls[0].username).toBe('admin');
  });

  it('records a refused deletion too, because an attempt to remove the last copy is the event', async () => {
    seed([entry('only')], ['only.ffbkp']);

    await expect(service.deleteBackup('only', { type: 'user', mode: 'manual', username: 'admin' })).rejects.toThrow();

    expect(actions()).toEqual(['BACKUP_DELETED']);
    expect(calls[0].status, 'a refusal must not be filed as a success').toBe('FAILED');
    expect(String(calls[0].details.reason), 'the row must say why it was refused').toMatch(/النسخة الأخيرة/);
  });

  it('records a failed restore with the stage, so a dead preview and a dead apply are distinguishable', async () => {
    // A failed `pg_restore --clean` leaves the database partly rebuilt. It is the
    // worst state this system can be in, and it is the one that used to leave
    // nothing behind: `RESTORE_APPLIED` is written only on success, so without
    // this row there is no evidence the attempt happened at all.
    await service.recordRestoreFailure({
      actor: { type: 'user', mode: 'manual', username: 'admin' },
      backupId: 'abc',
      stage: 'apply',
      reason: 'pg_restore: error: could not open file "pgdata/base/5/16384"',
    });

    expect(actions()).toEqual(['RESTORE_FAILED']);
    expect(calls[0]).toMatchObject({ action: 'RESTORE_FAILED', status: 'FAILED', entityId: 'abc' });
    expect(calls[0].details.stage).toBe('apply');
    expect(String(calls[0].details.message)).toMatch(/pg_restore/);
  });

  it('records a schedule change as a diff, because the new value alone cannot say who turned it off', async () => {
    // "The schedule changed" is not an answer to "who disabled the backups, and
    // when". A row carrying only the resulting value cannot distinguish a change
    // from a schedule that was always that way.
    const result = await service.updateSchedule(
      { enabled: false, hour: 4 },
      { type: 'user', mode: 'manual', username: 'admin', role: 'admin' },
    );

    expect(result.enabled).toBe(false);
    const row = calls.find((call) => call.action === 'SCHEDULE_CHANGED');
    expect(row, 'a schedule change must leave a row').toBeTruthy();
    expect(row!.details.changed).toEqual(expect.arrayContaining(['enabled', 'hour']));
    expect(row!.details.before).toMatchObject({ enabled: true });
    expect(row!.details.after).toMatchObject({ enabled: false, hour: 4 });
    expect(row!.username).toBe('admin');
  });

  it('never records the encryption password or the restore PIN', async () => {
    // The secrets are fields of the same object the diff is built from, and this
    // row is broadly readable. They must not be in it.
    await service.updateSchedule(
      { restorePin: '9182', encryptionPassword: 'hunter2' },
      { type: 'user', mode: 'manual', username: 'admin' },
    );

    const serialised = JSON.stringify(calls);
    expect(serialised).not.toContain('9182');
    expect(serialised).not.toContain('hunter2');
  });

  it('lets the operator keep their result when the audit cannot be written', async () => {
    seed([entry('a'), entry('b')], ['a.ffbkp', 'b.ffbkp']);
    failNextWrite = true;

    // The deletion happened. The file is gone. Turning that into a 500 would leave
    // the operator believing their backup still exists.
    await expect(service.deleteBackup('a', { type: 'user', mode: 'manual', username: 'admin' })).resolves.toEqual({
      deleted: true,
    });
    expect(existsSync(path.join(backupDir(), 'a.ffbkp'))).toBe(false);
  });

  it('degrades loudly rather than silently when there is no audit service at all', async () => {
    // Built without one, as the unit tests do. A missing audit must not be a
    // missing record discovered months later.
    const bare = new BackupService({} as never, {} as never);
    bare.onModuleDestroy();

    const logged: string[] = [];
    (bare as never as { logger: { error: (...args: unknown[]) => void } }).logger.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };

    await (bare as never as { recordRestoreFailure: (p: unknown) => Promise<void> }).recordRestoreFailure({
      backupId: 'x',
      stage: 'preview',
      reason: 'test',
    });

    expect(logged.join('\n')).toMatch(/BACKUP_RESTORE|RESTORE_FAILED|no audit service/i);
  });
});
