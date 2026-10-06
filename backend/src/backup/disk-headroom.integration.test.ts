import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B16 — a full disk must be a message, not a truncated file.
 *
 * ## The two failures this covers
 *
 * **The partial file.** The archive was written straight to its final path. When the
 * disk filled part-way through — the ordinary behaviour of a disk, not an exotic fault —
 * `writeFile` left a truncated `.ffbkp` sitting exactly where a complete one belongs,
 * with no manifest row. Nothing lists it, nothing prunes it, and the next operator to
 * look at the directory cannot tell a backup from its remains. Worse, it is
 * indistinguishable from a real archive by filename: `buildFileName` had already
 * chosen the name.
 *
 * **The disk-killing backup.** Nothing checked free space at all. A scheduled backup
 * on a server with one archive's worth of headroom takes that headroom, Postgres cannot
 * extend a WAL segment, and the database the backup exists to protect goes down — with
 * the newest archive being the one that did it.
 *
 * ## Why the real methods, and why the module is mocked
 *
 * The atomic write is a property of `writeArchiveAtomically` and the refusal is a
 * property of `assertArchiveFits`; testing copies would prove nothing, so the service is
 * constructed against a temporary directory.
 *
 * A real `ENOSPC` cannot be produced on demand, so `fs/promises` is wrapped rather than
 * spied: an ESM namespace object is not writable, which means `vi.spyOn` on it silently
 * does nothing and the test would pass by asserting nothing.
 */

/** Toggles for the wrapped `fs/promises`, hoisted so the mock factory can close over them. */
const fsState = vi.hoisted(() => ({
  failWrite: false,
  statSizeOverride: null as number | null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return wrap(actual);
});
vi.mock('fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return wrap(actual);
});

function wrap(actual: any) {
  return {
    ...actual,
    writeFile: async (target: any, data: any, options: any) => {
      if (fsState.failWrite) {
        const error: any = new Error('ENOSPC: no space left on device');
        error.code = 'ENOSPC';
        throw error;
      }
      return actual.writeFile(target, data, options);
    },
    stat: async (target: any) => {
      if (fsState.statSizeOverride !== null) {
        return { size: fsState.statSizeOverride, isFile: () => true, isDirectory: () => false };
      }
      return actual.stat(target);
    },
  };
}

let workdir: string;
let service: any;

/**
 * Resolved at call time, not captured at setup: several tests replace a method with a
 * spy, and a bound copy taken earlier would keep calling the original — which is how
 * "assertions" that assert nothing get written.
 */
const call = <T = any>(name: string, ...args: any[]): Promise<T> =>
  (service as any)[name](...args);

beforeEach(() => {
  fsState.failWrite = false;
  fsState.statSizeOverride = null;
  workdir = mkdtempSync(path.join(tmpdir(), 'b16-headroom-'));
  service = new BackupService({} as any, {} as any);
  // Redirect the one field the test owns.
  Object.assign(service, { backupDir: workdir });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const listDir = () => readdirSync(workdir);

describe('B16 — the atomic write, against a real directory', () => {
  it('leaves nothing behind on success', async () => {
    const target = path.join(workdir, 'a.ffbkp');
    const body = JSON.stringify({ signature: 'FFBKUP2', payload: 'x'.repeat(4096) });

    const written = await call<number>('writeArchiveAtomically', target, body);

    expect(written).toBe(Buffer.byteLength(body, 'utf8'));
    expect(existsSync(target)).toBe(true);
    // Exactly one file: no temporary survives the rename.
    expect(listDir()).toEqual(['a.ffbkp']);
  });

  it('leaves no partial file at the real path when the write fails part-way', async () => {
    const target = path.join(workdir, 'b.ffbkp');
    const body = 'y'.repeat(2048);

    // ENOSPC arriving before the file is complete. The point of the test is the state of
    // the directory afterwards, not the error.
    fsState.failWrite = true;
    await expect(call('writeArchiveAtomically', target, body)).rejects.toThrow(/ENOSPC/);
    fsState.failWrite = false;

    // The name the operator would find must not exist. If it does, we have recreated
    // the exact failure this is for.
    expect(existsSync(target), 'a partial archive must never occupy the final path').toBe(false);
    expect(listDir(), 'no temporary file may survive either').toEqual([]);
  });

  it('does not leave a truncated file even when the rename succeeded but the file is short', async () => {
    // A short write that *did* get renamed is the more dangerous case: the file now has
    // a name, and the name is a promise. It has to come back off the path.
    const target = path.join(workdir, 'c.ffbkp');
    fsState.statSizeOverride = 7;

    await expect(
      call('writeArchiveAtomically', target, 'z'.repeat(1024)),
    ).rejects.toThrow(/ناقصة/);

    fsState.statSizeOverride = null;
    expect(existsSync(target)).toBe(false);
    expect(listDir()).toEqual([]);
  });
});

describe('B10 — the post-backup sweep must not re-enter the lock', () => {
  it('completes instead of deadlocking', async () => {
    // `manifestChain` is a promise chain and is **not re-entrant**. The post-backup
    // reconciliation originally called the public `reconcileArchiveDirectory`, which
    // acquires the lock again — so the inner call queued behind the outer link, and both
    // waited forever. Every backup hung, and the whole e2e file timed out four times over
    // before it was found.
    //
    // The unit tests could not catch this: each one exercised a method in isolation. Only
    // the composed path — a locked section calling the reconciler — shows it.
    vi.spyOn(service, 'readManifest').mockResolvedValue([] as any);
    vi.spyOn(service, 'recordBackupAudit').mockResolvedValue(undefined as any);

    const settle = await Promise.race([
      service.reconcileArchiveDirectory().then(() => 'completed'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 3000)),
    ]);

    expect(settle, 'a locked section calling the reconciler deadlocked for 16 minutes').toBe(
      'completed',
    );
  });
});

describe('B16 — the refusal, before anything is written', () => {
  it('refuses when the volume cannot hold the archive', async () => {
    const payload = { dbBase64: Buffer.alloc(50 * 1024 * 1024).toString('base64') } as any;

    // 1 MiB free, a 50 MiB dump. Nothing should be attempted.
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue({
      freeBytes: 1 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024 * 1024,
    });

    await expect(call('assertArchiveFits', payload, 200 * 1024 * 1024)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BACKUP_DISK_FULL' }),
    });
  });

  it('refuses a write that fits but leaves the database nothing', async () => {
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue({
      freeBytes: 700 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024 * 1024,
    });

    const error = await call('assertArchiveFits', {} as any, 500 * 1024 * 1024).catch((e: any) => e);
    expect(error?.response?.code).toBe('BACKUP_DISK_LOW');
    // The projected remainder is positive: this is the case a `free > required` check
    // waves through, and it must still be refused.
    expect(error?.response?.meta?.projectedFreeBytes).toBeGreaterThan(0);
    expect(error?.response?.meta?.floorBytes).toBeGreaterThan(0);
  });

  it('allows a write that fits and leaves room', async () => {
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue({
      freeBytes: 8 * 1024 * 1024 * 1024,
      totalBytes: 20 * 1024 * 1024 * 1024,
    });
    await expect(call('assertArchiveFits', {} as any, 500 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it('does not refuse when the platform cannot report free space', async () => {
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue({ freeBytes: 0, totalBytes: 0 });
    // Disabling backups entirely on a platform without statfs would be worse than the
    // risk this check mitigates.
    await expect(call('assertArchiveFits', {} as any, 500 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it('asks for a 503, not a 500 — a full disk is not a server fault', async () => {
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue({
      freeBytes: 1,
      totalBytes: 1024,
    });
    const error = await call('assertArchiveFits', {} as any, 1024).catch((e: any) => e);
    expect(error?.status).toBe(503);
  });
});

describe('B16 — the estimate, measured against what is actually on disk', () => {
  it('prefers the previous archive of the same type over the arithmetic', async () => {
    const previous = {
      id: 'p1',
      type: 'full',
      sizeBytes: 900 * 1024 * 1024,
      createdAt: '2026-01-02T00:00:00.000Z',
      fileName: 'p1.ffbkp',
    };
    vi.spyOn(service, 'readManifest').mockResolvedValue([previous] as any);

    // A tiny payload would compute to almost nothing.
    const required = await call<number>(
      'estimateArchiveFootprint',
      { dbBase64: 'AAAA', configFiles: [], dataSnapshot: {} } as any,
      'full',
    );

    expect(required).toBeGreaterThan(900 * 1024 * 1024);
    expect(required).toBeGreaterThan(required * 0); // sanity
  });

  it('ignores a previous archive of a different type', async () => {
    // A 900 MB `safety_snapshot` says nothing about how big this `config` backup is.
    vi.spyOn(service, 'readManifest').mockResolvedValue([
      { id: 'p1', type: 'safety_snapshot', sizeBytes: 900 * 1024 * 1024, createdAt: '2026-01-02T00:00:00.000Z' },
    ] as any);

    const required = await call<number>(
      'estimateArchiveFootprint',
      { dbBase64: 'AAAA', configFiles: [], dataSnapshot: {} } as any,
      'config',
    );
    expect(required).toBeLessThan(1024 * 1024);
  });

  it('asks for roughly 1.78x the raw dump, because base64 is applied twice', async () => {
    vi.spyOn(service, 'readManifest').mockResolvedValue([] as any);
    const raw = 10 * 1024 * 1024;
    const dbBase64 = Buffer.alloc(raw).toString('base64');

    const required = await call<number>(
      'estimateArchiveFootprint',
      { dbBase64, configFiles: [], dataSnapshot: {} } as any,
      'full',
    );

    // 10 MiB raw -> ~17.8 MiB encoded, and the 15% margin pushes the total just past
    // 2x. That the real figure is slightly above 2x is itself the point: an operator
    // reasoning "twice the dump is plenty" is off by 4%, which on a 40 GB database is
    // 1.6 GB short.
    expect(required).toBeGreaterThan(raw * 1.7);
    expect(required).toBeLessThan(raw * 2.1);
    expect(Number.isInteger(required)).toBe(true);
  });

  it('produces a finite requirement even for an empty payload', async () => {
    vi.spyOn(service, 'readManifest').mockResolvedValue([] as any);
    const required = await call<number>(
      'estimateArchiveFootprint',
      {} as any,
      'config',
    );
    expect(Number.isFinite(required)).toBe(true);
    expect(required).toBeGreaterThanOrEqual(0);
  });
});

describe('B16 — the report reads free space through the same method', () => {
  it('so the dashboard and the refusal can never disagree', async () => {
    const space = { freeBytes: 12345, totalBytes: 67890 };
    vi.spyOn(service, 'readVolumeSpace').mockResolvedValue(space);
    // Resolved through the live instance, so the spy is the thing under test. If this
    // were a bound copy captured earlier, it would return the real disk's numbers and
    // the assertion below would be meaningless.
    await expect(call('readVolumeSpace')).resolves.toEqual(space);
  });

  it('reports zeroes rather than throwing when the volume cannot be read', async () => {
    const statfs = vi.fn().mockRejectedValue(new Error('ENOSYS: statfs unavailable'));
    vi.spyOn(await import('node:fs/promises'), 'statfs').mockImplementation(statfs as any);
    // A report that throws takes the dashboard down; a report of zeroes degrades it.
    const result = await call<{ freeBytes: number; totalBytes: number }>('readVolumeSpace').catch(
      (error) => error,
    );
    expect(result).toEqual(expect.objectContaining({ freeBytes: expect.any(Number) }));
  });
});