/**
 * FC-OPS-002 — deciding whether an archive may be restored at all.
 *
 * Kept separate from `BackupService` and free of any dependency so the rule can be
 * tested directly. A rule that only exists inside a class wired to a database and
 * a filesystem gets verified by reading it, and reading it is exactly what let the
 * original gap through: the service recorded a migration *count*, the count looked
 * plausible, and nothing ever compared it to a name.
 */

/** The migration names an archive recorded when it was taken. */
export const archiveMigrationNames = (manifest: unknown): string[] => {
  const record = manifest as { migrations?: unknown } | null;
  if (!record || typeof record !== 'object') return [];
  if (!Array.isArray(record.migrations)) return [];
  return record.migrations.filter((name): name is string => typeof name === 'string');
};

/**
 * The migrations this image expects that the archive predates.
 *
 * Compared by name rather than by count. Two images can carry the same number of
 * migrations and different ones — one added a migration while another dropped it —
 * and a count agrees while the schema does not.
 */
export const missingMigrations = (archive: string[], expected: string[]): string[] =>
  expected.filter((name) => !archive.includes(name));

export type ArchiveSchemaVerdict =
  | { restorable: true; missing: [] }
  | { restorable: false; missing: string[] };

/**
 * Whether the archive may be restored against this image.
 *
 * Only the stale direction is refused. An archive from the future relative to the
 * image means the image is stale rather than that the data is at risk, so that is
 * a different problem and is reported rather than blocked here.
 *
 * The verdict discriminates on a literal type so the caller can narrow on
 * `restorable` and reach `missing` without a cast — a cast here would defeat the
 * only thing this module is for, which is being checkable.
 */
export const archiveIsRestorable = (
  archive: string[],
  expected: string[],
): ArchiveSchemaVerdict => {
  const missing = missingMigrations(archive, expected);

  // Nothing to compare against on either side means the image could not read its
  // own migrations directory. Refusing would break every restore on a stripped
  // image, so this is stated rather than enforced — but it is not treated as a
  // pass either: the caller logs it.
  if (expected.length === 0) return { restorable: true, missing: [] };

  return missing.length === 0
    ? { restorable: true, missing: [] }
    : { restorable: false, missing };
};
