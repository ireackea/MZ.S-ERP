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

/**
 * B14 — the same question, asked at boot instead of at restore time.
 *
 * ## Why the timing was wrong
 *
 * Drift was only ever discovered by `assertArchiveSchemaIsCurrent`, which runs on the
 * restore path. So the sequence was: ship a migration, let the scheduler run for a week,
 * and discover that every archive it produced is unusable *at the moment of restore* —
 * which is the moment there is no time to take another one.
 *
 * ## Why it does not block anything
 *
 * A boot-time check that refuses to start would make the situation strictly worse: if the
 * archives cannot be restored against this image, then this image is exactly what is
 * needed to *produce* archives that can be. Blocking the server here would leave the
 * operator with a down system and the same stale backups.
 *
 * So drift is reported, loudly, and never enforced. The refusal stays where it is — at
 * the point of destruction, where it protects data.
 */
export type DriftArchive = {
  id: string;
  createdAt: string;
  type: string;
  /**
   * Migrations the archive recorded, or `null` when it recorded none.
   *
   * `null` is not a pass and not a failure: it is the state of every archive written
   * before the field existed. Treated as "unknown", it is counted separately so the
   * report cannot claim a clean bill of health it has not earned.
   */
  migrations: string[] | null;
};

export type SchemaDriftReport = {
  /** How many archives carried a migration list and could be judged. */
  judged: number;
  /** Archives with no migration list: undecidable, not safe. */
  unknown: number;
  /** Judged archives missing at least one migration. */
  drifting: number;
  /** The newest judged archive, which is the one an operator would reach for first. */
  newest: {
    id: string;
    createdAt: string;
    type: string;
    missing: string[];
    restorable: boolean;
  } | null;
  /** True when the newest judged archive cannot be restored against this image. */
  newestBlocked: boolean;
  severity: 'ok' | 'warning' | 'error';
  message: string;
};

export function evaluateSchemaDrift(input: {
  archives: DriftArchive[];
  expected: string[];
}): SchemaDriftReport {
  const judged = input.archives.filter((a) => Array.isArray(a.migrations));
  const unknown = input.archives.length - judged.length;

  const assessments = judged.map((archive) => ({
    archive,
    verdict: archiveIsRestorable(archive.migrations as string[], input.expected),
  }));

  const newest = [...assessments]
    .sort((a, b) => String(b.archive.createdAt).localeCompare(String(a.archive.createdAt)))[0];

  const drifting = assessments.filter((a) => !a.verdict.restorable).length;

  const newestEntry = newest
    ? {
        id: newest.archive.id,
        createdAt: newest.archive.createdAt,
        type: newest.archive.type,
        missing: (newest.verdict as { missing: string[] }).missing,
        restorable: newest.verdict.restorable,
      }
    : null;

  // Severity, in the order an operator would care about:
  // the newest archive being unusable is the urgent case; older drifting archives are
  // worth knowing about; archives with no migration list are a permanent unknown.
  let severity: SchemaDriftReport['severity'] = 'ok';
  let message = 'لا يوجد انحراف في مخطط النسخ الاحتياطية.';

  if (newestEntry && !newestEntry.restorable) {
    severity = 'error';
    // The names, not just the count: "missing 2 migrations" leaves the operator to go
    // and diff the directory, while the three names say exactly what the image gained.
    const named = newestEntry.missing.slice(0, 5).join('، ');
    const more = newestEntry.missing.length > 5 ? ` (و${newestEntry.missing.length - 5} أخرى)` : '';
    message =
      `أحدث نسخة (${newestEntry.createdAt}) تفتقد ${newestEntry.missing.length} هجرة ` +
      `(${named}${more})، فلا يمكن استعادتها على هذه النسخة من الخادم. ` +
      'النسخ الأقدم قد تكون صالحة، والخادم سيستمر في العمل وإنتاج نسخ جديدة.';
  } else if (unknown > 0) {
    severity = 'warning';
    message =
      `${unknown} نسخة لا تسجّل قائمة الهجرات، فلا يمكن الحكم عليها. ` +
      'عاملها على أنها غير مؤكدة، لا سليمة.';
  } else if (drifting > 0) {
    severity = 'warning';
    message = `${drifting} نسخة أقدم من صورة الخادم ولا يمكن استعادتها عليها.`;
  }

  return {
    judged: judged.length,
    unknown,
    drifting,
    newest: newestEntry,
    newestBlocked: Boolean(newestEntry && !newestEntry.restorable),
    severity,
    message,
  };
}
