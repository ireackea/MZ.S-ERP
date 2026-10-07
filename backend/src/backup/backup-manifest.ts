import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

/**
 * B18 — the archive index, and nothing else.
 *
 * Split out of `BackupService` because this is the one piece of the service that every
 * other piece reads before doing anything, and it was invisible between two unrelated
 * neighbours in a four-thousand-line file. A corrupt index is the failure that takes out
 * the entire backup system at once, so it deserves to be somewhere you can read on its
 * own.
 *
 * Generic over the entry type on purpose. The logic here is "a JSON array on disk",
 * and nothing about it knows what an archive is; saying so in the type is what keeps
 * this module from having to import the service it was extracted from.
 */
export class ManifestStore<T> {
  constructor(
    private readonly manifestFile: string,
    /** The workspace check, supplied rather than reimplemented, so seeding stays in one place. */
    private readonly ensureWorkspace: () => Promise<void>,
  ) {}

  /**
   * Gate 1.4 — a corrupt index used to return `[]`, so every backup vanished from the
   * UI with no error anywhere. It now refuses, and keeps the damaged file for inspection
   * instead of overwriting it on the next write.
   *
   * Absent is still a legitimate first-run state, so the two are told apart: a file that
   * is not there is an empty index, a file that is there and unreadable is a fault.
   */
  async read(): Promise<T[]> {
    await this.ensureWorkspace();
    let raw: string;
    try {
      raw = await fsPromises.readFile(this.manifestFile, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
      throw new Error('manifest is not an array');
    } catch (error: unknown) {
      const quarantine = `${this.manifestFile}.corrupt-${Date.now()}`;
      await fsPromises.rename(this.manifestFile, quarantine).catch(() => undefined);
      throw new Error(
        `Backup manifest is unreadable (${(error as Error)?.message ?? 'parse error'}). `
        + `The damaged file was kept at ${path.basename(quarantine)}; it has not been overwritten.`,
      );
    }
  }

  /**
   * Gate 1.4 — written through a temporary file and renamed.
   *
   * A crash or a full disk mid-`writeFile` truncated the index, and the next read
   * returned `[]` for every backup. `rename` within a directory is atomic, so a reader
   * sees either the old index or the new one.
   */
  async write(entries: T[]): Promise<void> {
    const temp = `${this.manifestFile}.tmp-${process.pid}-${Date.now()}`;
    const body = JSON.stringify(entries, null, 2);
    await fsPromises.writeFile(temp, body, 'utf8');
    try {
      await fsPromises.rename(temp, this.manifestFile);
    } catch (error) {
      await fsPromises.unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}
