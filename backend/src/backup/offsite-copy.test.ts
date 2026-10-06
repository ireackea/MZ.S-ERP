import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { hashFile } from './offsite-copy';
import { copyOffsite, countVerifiedOffsiteCopies, offsiteDirectory } from './offsite-copy';

/**
 * B19 — the option that was offered and did nothing, made real.
 *
 * ## What this replaces
 *
 * The settings screen offered `usb` and `drive`. They were saved, validated and echoed
 * back, and **nothing ever wrote to either** — every archive went to one directory on one
 * machine. A silent second copy is worse than none, because it is counted in the health
 * report as protection that does not exist, so the honest thing was to remove the option
 * and implement the capability behind an explicit configuration.
 *
 * ## Why verification is the whole point
 *
 * `fs.copyFile` returning without error is not evidence that the bytes arrived. A device
 * unplugged at the wrong moment produces a truncated file and a success code, and a
 * truncated second copy is the most dangerous outcome available: it looks like protection,
 * it is counted as protection, and it will not open on the day it is needed.
 */

let sourceDir: string;
let destDir: string;
let archivePath: string;
let archiveSha: string;
let previousEnv: string | undefined;

const ARCHIVE_NAME = 'full_2026-01-01T00-00-00-000Z_abc12345.ffbkp';
const CONTENT = '{"signature":"FFBKUP2","version":2}';

beforeEach(async () => {
  sourceDir = mkdtempSync(path.join(tmpdir(), 'offsite-src-'));
  destDir = mkdtempSync(path.join(tmpdir(), 'offsite-dst-'));
  archivePath = path.join(sourceDir, ARCHIVE_NAME);
  writeFileSync(archivePath, CONTENT, 'utf8');
  archiveSha = await hashFile(archivePath);
  previousEnv = process.env.BACKUP_OFFSITE_DIR;
  delete process.env.BACKUP_OFFSITE_DIR;
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.BACKUP_OFFSITE_DIR;
  else process.env.BACKUP_OFFSITE_DIR = previousEnv;
  rmSync(sourceDir, { recursive: true, force: true });
  rmSync(destDir, { recursive: true, force: true });
});

describe('with no destination configured', () => {
  it('reports "off" rather than pretending to succeed', async () => {
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, null);
    expect(result.copied).toBe(false);
    expect(result.verified).toBe(false);
    // No error: being off is not a failure.
    expect(result.error).toBeNull();
    expect(offsiteDirectory()).toBeNull();
  });

  it('treats a whitespace-only setting as off', async () => {
    // The class of bug that once let a "configured" gate hold an empty value.
    process.env.BACKUP_OFFSITE_DIR = '   ';
    expect(offsiteDirectory()).toBeNull();
  });
});

describe('with a destination configured', () => {
  it('copies and verifies by reading the destination back', async () => {
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, destDir);

    expect(result.copied).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.error).toBeNull();
    expect(result.path).toBe(path.join(destDir, ARCHIVE_NAME));
    expect(readFileSync(result.path!, 'utf8')).toBe(CONTENT);
  });

  it('creates the destination directory if it is not there yet', async () => {
    // A freshly plugged device usually has no subdirectory for this.
    const nested = path.join(destDir, 'factory', 'backups');
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, nested);
    expect(result.verified).toBe(true);
    expect(existsSync(path.join(nested, ARCHIVE_NAME))).toBe(true);
  });

  it('refuses a destination that is the backup directory itself', async () => {
    // It would satisfy every check and protect against nothing.
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, sourceDir);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('نفس مجلد');
  });
});

describe('a copy that did not arrive is reported as such', () => {
  it('rejects a destination whose bytes differ, and removes the bad file', async () => {
    // The dangerous case: `copyFile` succeeded, the file exists, and it is not a backup.
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, 'f'.repeat(64), destDir);

    expect(result.copied).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('البصمة');
    // Left in place, a file with the right name and the wrong bytes is a trap.
    expect(existsSync(path.join(destDir, ARCHIVE_NAME))).toBe(false);
  });

  it('reports an unreachable destination without failing the backup', async () => {
    // A device that is unplugged, or a share that is down, must not make the local
    // archive look like it failed.
    const unreachable = path.join(destDir, 'not', 'a', 'real', 'mount');
    const result = await copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, unreachable);

    // On a permissive filesystem this may succeed; either way it must be truthful.
    if (result.verified) {
      expect(readFileSync(result.path!, 'utf8')).toBe(CONTENT);
    } else {
      expect(result.copied).toBe(false);
      expect(result.error).toBeTruthy();
    }
    // The source is untouched either way — it is the copy of the backup, not its origin.
    expect(existsSync(archivePath)).toBe(true);
    expect(readFileSync(archivePath, 'utf8')).toBe(CONTENT);
  });

  it('never throws, whatever the destination does', async () => {
    // It is called from the backup path; a throw here would mark a good archive failed.
    const hostile = path.join(sourceDir, ARCHIVE_NAME, 'impossible');
    await expect(
      copyOffsite(archivePath, ARCHIVE_NAME, archiveSha, hostile),
    ).resolves.toBeTruthy();
  });
});

describe('the health report counts verified copies, not configured ones', () => {
  it('a configured destination that never worked counts as zero', () => {
    // Counting configuration would report protection that was never delivered.
    expect(
      countVerifiedOffsiteCopies([
        { offsite: { verified: false } },
        { offsite: { verified: false } },
        { offsite: null },
        {},
      ]),
    ).toBe(0);
  });

  it('counts only the ones that were read back and matched', () => {
    expect(
      countVerifiedOffsiteCopies([
        { offsite: { verified: true } },
        { offsite: { verified: false } },
        { offsite: { verified: true } },
        { offsite: null },
      ]),
    ).toBe(2);
  });

  it('handles an empty manifest', () => {
    expect(countVerifiedOffsiteCopies([])).toBe(0);
  });
});