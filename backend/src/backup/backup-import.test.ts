import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';
import { inspectEnvelope, isRefusal, judgeImport } from './archive-import';

/**
 * B21 — the door back in.
 *
 * The failure: an operator downloads a backup, deletes it from the list to free
 * space, and is left holding a file the section will not read. There was no path that
 * accepted an archive from outside, so the only copy of the database outside the
 * system was unreachable and the one operation that needed it — a restore — could
 * not use it.
 *
 * These tests build a *real* archive with the service's own key derivation and
 * encryption, then import it. A mocked envelope would prove only that the shape
 * check reads the fields it expects; the thing worth proving is that a file this
 * system produced can come back in and be restorable afterwards, and that a file it
 * did not produce cannot.
 */

const MASTERSECRET = 'test-master-secret-value-for-import-specs-32-chars';

const manifest = (workspace: string) =>
  JSON.parse(readFileSync(path.join(workspace, 'backups', 'index.json'), 'utf8'));

const listFiles = (workspace: string) =>
  require('node:fs')
    .readdirSync(path.join(workspace, 'backups'))
    .filter((name: string) => name.endsWith('.ffbkp'));

describe('importing a backup archive from outside', () => {
  let workspace: string;
  let previousCwd: string;
  let previousSecret: string | undefined;
  let service: BackupService;

  /**
   * A real envelope, sealed the way the backup path seals one.
   *
   * Written out rather than mocked because every interesting property of an import is
   * a property of the *bytes*: the auth tag has to verify, the payload checksum has
   * to match, and the id has to survive encryption as identity. A hand-written
   * object literal in a test asserts nothing about any of that.
   */
  const buildArchive = async (options: {
    id?: string;
    type?: string;
    createdAt?: string;
    missingModels?: string[];
    passwordProtected?: boolean;
    corruptAuthTag?: boolean;
    omitAuthTag?: boolean;
    password?: string;
  } = {}): Promise<string> => {
    const {
      id = 'imported-archive-0001',
      type = 'full',
      createdAt = '2026-09-20T10:00:00.000Z',
      missingModels,
      passwordProtected = false,
      corruptAuthTag = false,
      omitAuthTag = false,
      password,
    } = options;

    const secret = (password || MASTERSECRET);
    const { createCipheriv, createHash, pbkdf2Sync, randomBytes } = await import('node:crypto');
    const master = MASTERSECRET;
    const salt = randomBytes(16);
    const key = pbkdf2Sync(`${secret}:${master}`, salt, 210000, 32, 'sha256');
    const iv = randomBytes(12);

    const payload = JSON.stringify({
      type,
      trigger: 'manual',
      createdAt,
      configFiles: [],
      counts: { users: 2, items: 148, openingBalances: 0, transactions: 0, configFiles: 0 },
      manifest: {
        databaseDump: { sha256: 'a'.repeat(64), byteLength: 1024 },
        missingModels: missingModels ?? [],
        migrations: [],
        schemaVersion: 24,
      },
      dbBase64: Buffer.from('SELECT 1;').toString('base64'),
    });

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = corruptAuthTag
      ? Buffer.from(cipher.getAuthTag().map((byte) => (byte ^ 0xff)))
      : cipher.getAuthTag();

    const envelope: Record<string, unknown> = {
      signature: 'FFBKUP2',
      version: 2,
      id,
      type,
      trigger: 'manual',
      createdAt,
      actor: { type: 'user', mode: 'manual', username: 'someone' },
      passwordProtected,
      algorithm: 'aes-256-gcm',
      ivBase64: iv.toString('base64'),
      saltBase64: salt.toString('base64'),
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      payloadBase64: encrypted.toString('base64'),
      metadata: { users: 2, items: 148, openingBalances: 0, transactions: 0, configFiles: 0 },
    };
    if (!omitAuthTag) envelope.authTagBase64 = authTag.toString('base64');

    const file = path.join(workspace, 'incoming-test.ffbkp');
    writeFileSync(file, JSON.stringify(envelope), 'utf8');
    return file;
  };

  const importFile = (filePath: string, extra: Record<string, unknown> = {}) =>
    service.importArchive({
      filePath,
      originalName: 'نسخة بالوحدات.ffbkp',
      actor: { type: 'user', mode: 'import', username: 'admin', userId: 'u1' },
      ...extra,
    });

  beforeEach(async () => {
    previousCwd = process.cwd();
    previousSecret = process.env.BACKUP_ENCRYPTION_SECRET;
    process.env.BACKUP_ENCRYPTION_SECRET = MASTERSECRET;
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-import-'));
    mkdirSync(path.join(workspace, 'backups'), { recursive: true });
    process.chdir(workspace);
    service = new BackupService({} as never, {} as never);
    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
    if (previousSecret === undefined) delete process.env.BACKUP_ENCRYPTION_SECRET;
    else process.env.BACKUP_ENCRYPTION_SECRET = previousSecret;
  });

  it('takes an archive back, and the list can restore it like any other', async () => {
    const file = await buildArchive();

    const result = await importFile(file);

    expect(result.backup.id).toBe('imported-archive-0001');
    expect(result.backup.integrityVerified).toBe(true);
    // The point of the whole item: it is in the manifest, so the ordinary
    // preview-and-confirm path can now reach it.
    expect(manifest(workspace).map((row: { id: string }) => row.id)).toContain('imported-archive-0001');
    expect(listFiles(workspace)).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('records where it came from, instead of claiming it was created here', async () => {
    const file = await buildArchive();
    await importFile(file);

    const row = manifest(workspace)[0];
    // "Who pressed the button" and "where did this file come from" are different
    // questions. An imported archive filed as `manual` is a lie for an auditor to
    // disprove.
    expect(row.trigger).toBe('import');
    expect(row.actor.mode).toBe('import');
  });

  it('keeps the date the archive claims, and warns when the policy would delete it', async () => {
    // The date is what the archive says about itself. Resetting it to now would make
    // a two-year-old backup look fresh — and would be the one thing that could make
    // a file the operator re-imported get deleted by the next backup without anyone
    // noticing.
    const file = await buildArchive({ createdAt: '2024-01-05T08:00:00.000Z' });
    const result = await importFile(file);

    expect(manifest(workspace)[0].createdAt).toBe('2024-01-05T08:00:00.000Z');
    expect(
      result.warnings.join(' '),
      'an import that vanishes on the next backup must say so at import time, not be discovered later',
    ).toMatch(/الاحتفاظ/);
  });

  it('refuses a file that is not one of ours', async () => {
    const file = path.join(workspace, 'notes.ffbkp');
    writeFileSync(file, 'these are my shopping notes, not a backup', 'utf8');

    await expect(importFile(file)).rejects.toThrow(/ليست أرشيف|ليس أرشيف/);
    expect(manifest(workspace)).toEqual([]);
  });

  it('refuses a file sealed with a different key, rather than storing a row that can never be restored', async () => {
    // This is the case that matters most. An archive from another server, or from
    // before the master secret changed, cannot be decrypted later. Storing it would
    // add a row that lists as a backup and fails at the moment of restore — the same
    // dead end this item exists to remove, reached by a longer road.
    const file = await buildArchive({ password: 'a-different-master-secret' });

    await expect(importFile(file)).rejects.toThrow();
    expect(manifest(workspace)).toEqual([]);
    expect(listFiles(workspace)).toEqual([]);
  });

  it('refuses an archive whose auth tag does not verify', async () => {
    const file = await buildArchive({ corruptAuthTag: true });
    await expect(importFile(file)).rejects.toThrow();
    expect(manifest(workspace)).toEqual([]);
  });

  it('refuses a truncated envelope rather than half-importing it', async () => {
    const file = await buildArchive({ omitAuthTag: true });
    await expect(importFile(file)).rejects.toThrow(/بصمة/);
    expect(manifest(workspace)).toEqual([]);
  });

  it('refuses the same archive twice, and never overwrites the file already stored', async () => {
    const first = await buildArchive({ id: 'same-archive-000001' });
    await importFile(first);

    const second = await buildArchive({ id: 'same-archive-000001' });
    await expect(importFile(second)).rejects.toThrow(/موجودة في القائمة/);

    // One row, one file. A second row for the same archive is a duplicate the
    // operator never asked for, and a second file under the same name is whichever
    // one happened to be written last.
    expect(manifest(workspace)).toHaveLength(1);
    expect(listFiles(workspace)).toHaveLength(1);
  });

  it('stores an incomplete archive and says so, instead of refusing the operator\'s own copy', async () => {
    // Refusing here would mean: the operator uploads a real backup of their data and
    // is told "no" — which is the failure this door was built to end. The list
    // renders the state and the restore refuses it with a reason.
    const file = await buildArchive({ missingModels: ['Transaction'] });
    const result = await importFile(file);

    expect(manifest(workspace)).toHaveLength(1);
    expect(manifest(workspace)[0].complete).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/ناقصة/);
  });

  it('does not let the uploaded name become a path', async () => {
    const file = await buildArchive();
    await importFile(file);

    // The stored name is built from the authenticated id, never from
    // `originalName`. A caller-supplied name is a path, and a path is not an identity.
    const stored = manifest(workspace)[0].fileName as string;
    expect(stored).toMatch(/^full_2026-09-20T10-00-00-000Z_imported\.ffbkp$/);
    expect(stored).not.toContain('..');
  });
});

describe('the import decision, on its own', () => {
  it('reads the envelope shape without pretending to check authenticity', () => {
    const good = inspectEnvelope({
      signature: 'FFBKUP2',
      version: 2,
      payloadBase64: 'eA==',
      authTagBase64: 'eQ==',
    });
    expect(good.ok).toBe(true);

    // A file that is not an archive must be refused on shape, before any key
    // derivation is paid for.
    expect(isRefusal(inspectEnvelope({ signature: 'SOMETHING', version: 2 }))).toBe(true);
    expect(isRefusal(inspectEnvelope(null))).toBe(true);
    expect(isRefusal(inspectEnvelope({ signature: 'FFBKUP2', version: 1 }))).toBe(true);
  });

  it('refuses an id that could become a path segment', () => {
    expect(isRefusal(judgeImport({ id: '../../etc/passwd', type: 'full', createdAt: '2026-01-01T00:00:00.000Z' }))).toBe(
      true,
    );
    expect(isRefusal(judgeImport({ id: 'short', type: 'full', createdAt: '2026-01-01T00:00:00.000Z' }))).toBe(true);
    expect(isRefusal(judgeImport({ id: '', type: 'full', createdAt: '2026-01-01T00:00:00.000Z' }))).toBe(true);
  });

  it('refuses a date it would have to guess', () => {
    // Guessing a missing date would make an old archive look new, which is the one
    // outcome that could get a file the operator deliberately re-imported deleted by
    // retention without anyone being told.
    expect(isRefusal(judgeImport({ id: 'archive-000001', type: 'full', createdAt: '' }))).toBe(true);
    expect(isRefusal(judgeImport({ id: 'archive-000001', type: 'full', createdAt: 'yesterday' }))).toBe(true);
    expect(isRefusal(judgeImport({ id: 'archive-000001', type: 'full', createdAt: '2026-01-01' }))).toBe(true);
  });

  it('accepts a well-formed identity and reports restorability rather than refusing it', () => {
    const ok = judgeImport({ id: 'archive-000001', type: 'inventory', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.restorable).toBe(true);
      expect(ok.type).toBe('inventory');
    }

    const partial = judgeImport({
      id: 'archive-000001',
      type: 'full',
      createdAt: '2026-01-01T00:00:00.000Z',
      missingModels: ['Item'],
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.restorable).toBe(false);
  });

  it('refuses a type it does not know, rather than storing it as something it is not', () => {
    expect(isRefusal(judgeImport({ id: 'archive-000001', type: 'everything', createdAt: '2026-01-01T00:00:00.000Z' }))).toBe(
      true,
    );
  });
});
