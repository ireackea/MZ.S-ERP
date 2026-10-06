import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

/**
 * B19 — a second copy, somewhere the loss of this machine does not reach.
 *
 * ## Why this was not implemented for so long
 *
 * The settings screen offered `usb` and `drive` as destinations. They were saved,
 * validated and echoed back. **Nothing wrote to either.** Every archive went to one
 * directory on one machine — so the control was a claim about resilience the system did
 * not honour, sitting one screen away from a panel that honestly reported
 * `offSiteCopies: 0`. Two contradictory statements about the same fact, and the
 * reassuring one was the false one.
 *
 * The options were removed rather than quietly left in place. This is what replaced them.
 *
 * ## What it is, honestly
 *
 * A configured directory that is **not** the backup directory — which, in practice, means a
 * mounted USB device or a network share. It is not a cloud upload, and it is not a
 * guarantee: it is a second copy at a path an operator chose, verified after it is written.
 *
 * The verification is the whole point. A copy that appears to succeed — `fs.copyFile`
 * returning without error — has still been observed to produce a truncated file on a
 * device that was unplugged at the wrong moment, and a silent second copy is worse than
 * none, because it is counted in the health report as protection that does not exist.
 * So the copy is read back and hashed, and only then called verified.
 */

/** Where the off-host copy goes. Empty or absent means the feature is off. */
export const offsiteDirectory = (): string | null => {
  const raw = String(process.env.BACKUP_OFFSITE_DIR || '').trim();
  return raw.length > 0 ? raw : null;
};

export type OffsiteState = {
  /** False when no destination is configured. Never a lie in either direction. */
  configured: boolean;
  directory: string | null;
};

export type OffsiteCopyResult = {
  /** Where it went, when it went anywhere. */
  path: string | null;
  copied: boolean;
  /** Read back from the destination and hashed — not assumed from `copyFile` returning. */
  verified: boolean;
  bytes: number;
  /** Present when the copy or the verification failed. The local archive is unaffected. */
  error: string | null;
};

/** sha256 of a file, streamed, so a multi-gigabyte archive costs one chunk of memory. */
export const hashFile = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

/**
 * Copy one archive to the off-host directory and verify it landed.
 *
 * Never throws. A dead USB device or an unreachable share must not fail the backup: the
 * local archive is good, the operator needs to know the second copy did not happen, and a
 * thrown error would report the whole backup as failed — which is a lie about the thing
 * that actually matters.
 */
export async function copyOffsite(
  sourcePath: string,
  fileName: string,
  expectedSha256: string,
  destination: string | null,
): Promise<OffsiteCopyResult> {
  const failed = (error: unknown, at: string | null = null): OffsiteCopyResult => ({
    path: at,
    copied: false,
    verified: false,
    bytes: 0,
    error: error instanceof Error ? error.message : String(error),
  });

  if (!destination) {
    return {
      path: null,
      copied: false,
      verified: false,
      bytes: 0,
      error: null,
    };
  }

  // Refuse to copy the archive into the directory it already lives in. Such a destination
  // would satisfy every check and protect against nothing — the health report would count
  // a second copy that is the first copy.
  const normalisedSource = path.resolve(sourcePath);
  const sourceDirectory = path.dirname(normalisedSource);
  const normalisedDestination = path.resolve(destination);

  const insideSourceDirectory =
    normalisedDestination === sourceDirectory ||
    normalisedDestination.startsWith(`${sourceDirectory}${path.sep}`);

  if (insideSourceDirectory) {
    return failed(
      new Error('الوجهة الخارجية هي نفس مجلد النسخ الاحتياطية، فستكون النسخة في مكانها.'),
      normalisedDestination,
    );
  }

  let target = path.join(normalisedDestination, fileName);
  try {
    await fsPromises.mkdir(normalisedDestination, { recursive: true });
    await fsPromises.copyFile(normalisedSource, target);

    const written = await hashFile(target);
    if (written !== expectedSha256) {
      // The file exists and looks like a backup. It is not one.
      await fsPromises.unlink(target).catch(() => undefined);
      return failed(
        new Error(
          'البصمة عند الوجهة لا تطابق المصدر، فحُذفت النسخة الناقصة. '
          + 'النسخة الأصلية سليمة في مجلدها.',
        ),
        target,
      );
    }

    const stat = await fsPromises.stat(target);
    return { path: target, copied: true, verified: true, bytes: stat.size, error: null };
  } catch (error) {
    // An unplugged device leaves the file system unhappy in ways that are not ours to
    // translate; the message is passed through and the backup is not failed.
    await fsPromises.unlink(target).catch(() => undefined);
    return failed(error, target);
  }
}

/**
 * How many archives actually have a verified off-host copy.
 *
 * Derived from the recorded results rather than from whether a directory is configured,
 * because a configured destination and a working one are different claims, and the
 * health report is where an operator looks to find out which one is true.
 */
export function countVerifiedOffsiteCopies(
  entries: ReadonlyArray<{ offsite?: { verified?: boolean } | null }>,
): number {
  return entries.reduce(
    (total, entry) => total + (entry.offsite?.verified === true ? 1 : 0),
    0,
  );
}

export const offsiteState = (): OffsiteState => ({
  configured: offsiteDirectory() !== null,
  directory: offsiteDirectory(),
});