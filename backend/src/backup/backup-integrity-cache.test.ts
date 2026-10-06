import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B6 — integrity verification, cached by content, and re-checkable on demand.
 *
 * `verifyIntegrity` streams the whole file through SHA-256. `listBackups` called it
 * for every archive on every call, so opening the backup screen with twelve archives
 * read the entire store from disk — and the health panel, the reset screen and the
 * dashboard each asked separately.
 *
 * The cache key is the checksum the manifest already records, which is what makes it
 * safe rather than merely fast: a file that changes changes its checksum, so a changed
 * file cannot be answered from the old verdict.
 *
 * What a content-keyed cache cannot do is notice a file corrupted *after* the last
 * check. That is why `verify: true` exists. A green badge that can only be re-checked
 * on a timer is a claim, and an operator auditing their backups must be able to turn
 * it into a measurement — so both halves are asserted here, including that the forced
 * read finds corruption the cache would have hidden.
 */

const FILE_NAME = 'full_2026-09-30_stamp_cached.ffbkp';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** The smallest thing `readEnvelope` accepts: a real, signed-looking FFBKUP2 shell. */
const envelope = (payloadBase64: string, id = 'cached-archive-01') =>
  JSON.stringify({
    signature: 'FFBKUP2',
    version: 2,
    id,
    type: 'full',
    trigger: 'manual',
    createdAt: '2026-09-30T02:00:00.000Z',
    actor: { type: 'user', mode: 'manual' },
    passwordProtected: false,
    algorithm: 'aes-256-gcm',
    ivBase64: 'aXZpdA==',
    saltBase64: 'c2FsdA==',
    authTagBase64: 'dGFn',
    payloadSha256: 'f'.repeat(64),
    payloadBase64,
    metadata: { users: 0, items: 0, openingBalances: 0, transactions: 0, configFiles: 0 },
  });

const manifestRow = (body: string, id = 'cached-archive-01', name = FILE_NAME) => ({
  id,
  fileName: name,
  type: 'full',
  trigger: 'manual',
  createdAt: '2026-09-30T02:00:00.000Z',
  sizeBytes: Buffer.byteLength(body),
  checksumSha256: sha256(body),
  integrity: 'verified',
  passwordProtected: false,
  actor: { type: 'user', mode: 'manual', username: 'admin' },
  metadata: { users: 0, items: 0, openingBalances: 0, transactions: 0, configFiles: 0 },
  complete: true,
});

describe('the integrity cache', () => {
  let workspace: string;
  let previousCwd: string;
  let service: BackupService;

  const cache = () => (service as never as { integrityCache: Map<string, { valid: boolean; at: number }> }).integrityCache;

  beforeEach(async () => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-integrity-'));
    mkdirSync(path.join(workspace, 'backups'), { recursive: true });
    process.chdir(workspace);
    service = new BackupService({} as never, {} as never);
    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  const seed = (rows: Array<ReturnType<typeof manifestRow>>, files: Record<string, string>) => {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(path.join(workspace, 'backups', name), body, 'utf8');
    }
    writeFileSync(path.join(workspace, 'backups', 'index.json'), JSON.stringify(rows, null, 2), 'utf8');
  };

  it('verifies once for repeated listings, not once per listing', async () => {
    const body = envelope('ZGF0YQ==');
    seed([manifestRow(body)], { [FILE_NAME]: body });

    // Count how many times the archive is actually read, by wrapping the private
    // verify the cache sits in front of. The point of the cache is precisely that this
    // number does not grow with the number of listings.
    const internals = service as never as { verifyIntegrity: (entry: unknown) => Promise<boolean> };
    const original = internals.verifyIntegrity.bind(service);
    let reads = 0;
    internals.verifyIntegrity = async (entry: unknown) => {
      reads += 1;
      return original(entry);
    };

    const first = await service.listBackups();
    const second = await service.listBackups();
    const third = await service.listBackups();

    expect(first[0].integrityVerified).toBe(true);
    expect(second[0].integrityVerified).toBe(true);
    expect(third[0].integrityVerified).toBe(true);
    expect(reads, 'the archive must be hashed once, not once per listing').toBe(1);
  });

  it('re-reads on demand, and finds corruption the cache would have hidden', async () => {
    const body = envelope('ZGF0YQ==');
    seed([manifestRow(body)], { [FILE_NAME]: body });

    // The first listing caches `verified`.
    expect((await service.listBackups())[0].integrityVerified).toBe(true);

    // The file is damaged on disk. The manifest's checksum no longer matches it —
    // which is exactly the condition a cache keyed on that checksum cannot notice.
    writeFileSync(path.join(workspace, 'backups', FILE_NAME), body.slice(0, -5), 'utf8');

    const cached = await service.listBackups();
    expect(
      cached[0].integrityVerified,
      'this is the known limit of a content-keyed cache, and the reason ?verify=1 exists',
    ).toBe(true);

    const forced = await service.listBackups(undefined, { verify: true });
    expect(forced[0].integrityVerified, 'a forced read must tell the truth').toBe(false);
    expect(forced[0].integrityLabel).toBe('failed');

    // And the truth is now what is cached, so the next ordinary listing is honest
    // rather than reverting to the stale verdict.
    expect((await service.listBackups())[0].integrityVerified).toBe(false);
  });

  it('keys on the checksum, so a replaced file is re-read rather than trusted', async () => {
    // A different archive at the same id — an operator re-importing, for instance.
    // The content changed, so the key changed, so the old verdict must not be reused.
    const first = envelope('ZGF0YQ==');
    seed([manifestRow(first)], { [FILE_NAME]: first });
    expect((await service.listBackups())[0].integrityVerified).toBe(true);

    const internals = service as never as { verifyIntegrity: (entry: unknown) => Promise<boolean> };
    const original = internals.verifyIntegrity.bind(service);
    let reads = 0;
    internals.verifyIntegrity = async (entry: unknown) => {
      reads += 1;
      return original(entry);
    };

    const replacement = envelope('b3RoZXI=');
    seed([manifestRow(replacement)], { [FILE_NAME]: replacement });
    const after = await service.listBackups();

    expect(reads, 'a changed file is a new key, so it must be hashed again').toBe(1);
    // And the new content genuinely verifies — this archive is well-formed, unlike the
    // damaged file in the case above. The point is the re-read, not the verdict.
    expect(after[0].integrityVerified).toBe(true);
  });

  it('drops the verdict for a deleted archive, and keeps the others', async () => {
    const first = envelope('ZGF0YQ==');
    const second = envelope('b3RoZXI=', 'other-archive-1');
    const otherName = 'full_2026-09-29_stamp_other.ffbkp';
    const deletedKey = 'cached-archive-01';

    seed(
      [manifestRow(first), manifestRow(second, 'other-archive-1', otherName)],
      { [FILE_NAME]: first, [otherName]: second },
    );

    await service.listBackups();
    const before = cache().size;
    expect(before, 'the listing must have cached something to prove the point').toBe(2);

    await service.deleteBackup(deletedKey);

    // Only the deleted one goes. Clearing the whole map here would be the tempting
    // implementation and the wrong one: it would throw away the other archive's
    // verdict, which is still true, and make the next listing re-read a store that may
    // hold hundreds of megabytes.
    expect(
      [...cache().keys()].some((key) => key.startsWith(`${deletedKey}:`)),
      'a verdict for a file that no longer exists is a dead entry nothing will ever clear',
    ).toBe(false);
    expect(cache().size, 'the surviving archive keeps its verdict').toBe(before - 1);
  });
});
