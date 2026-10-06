/**
 * B5 / B13 — deciding whether the backups are actually all right.
 *
 * ## What was invisible
 *
 * The section reported what it knew and nothing it could not: a list of archives, a
 * storage total, a next-run time. It never answered the only question an operator has
 * — *can I lose everything right now and get it back?* — so "the backups are running"
 * was a belief, and a schedule that had silently stopped for a month looked identical
 * to one that had never failed.
 *
 * The three screens that could have shown it each invented their own version, or showed
 * nothing: the reset screen asked the manifest for the newest row, the dashboard
 * showed a total, and `App` showed nothing at all. Three consumers, three answers, and
 * no way to keep them in agreement.
 *
 * This module is the answer, and only the answer. It is pure — no filesystem, no
 * database, no Nest — so the rules can be read and tested directly. `BackupStateService`
 * gathers the facts and calls it; nothing else decides anything.
 *
 * ## The rules, and why each one exists
 *
 * - **Age.** A backup from six weeks ago is not a backup. This is the rule that
 *   catches a schedule that stopped running, which is the most common way to lose data
 *   without noticing.
 * - **Integrity.** A backup that cannot be read is not a backup. Distinct from age: a
 *   fresh archive on a failing disk is the case age alone would call healthy.
 * - **Restorability.** An archive that verifies but was built before a migration is
 *   intact and useless. Reported separately, because "verified" and "restorable" are
 *   different claims and gate 1.6 exists because one was shown for the other.
 * - **3-2-1.** Three copies, two media, one off-site. Counted honestly: the copies
 *   inside one directory are one copy, and the answer says so rather than reporting
 *   the file count and letting the operator believe in redundancy they do not have.
 */

export type BackupHealthFacts = {
  /** Newest first, as the manifest returns them. */
  archives: Array<{
    id: string;
    type: string;
    createdAt: string;
    sizeBytes: number;
    integrity: string;
    complete?: boolean;
  }>;
  schedule: {
    enabled: boolean;
    lastRunAt?: string | null;
    lastRunKey?: string | null;
    frequency: string;
    hour: number;
    minute: number;
  } | null;
  /** How many of the archives are known to have left this machine. */
  offSiteCopies?: number;
  /** How many distinct storage locations hold a copy, including this one. */
  storageLocations?: number;
  now?: number;
};

export type BackupVerdict = 'ok' | 'stale' | 'unhealthy' | 'none';

export type BackupHealth = {
  verdict: BackupVerdict;
  /**
   * B14 — whether the archives can be restored against this image.
   *
   * Optional because it is populated by the caller rather than derived here: reading it
   * means opening archives, and this function is pure. A caller that does not supply it
   * gets `undefined`, which is deliberately *not* the same as "no drift" — an absent
   * check must not read as a passed one.
   */
  schemaDrift?: import('./schema-drift').SchemaDriftReport;
  /** One sentence, in the words the operator will read. */
  summary: string;
  lastBackup: {
    id: string;
    type: string;
    createdAt: string;
    ageMs: number;
    ageHours: number;
    sizeBytes: number;
    integrity: string;
    restorable: boolean;
  } | null;
  archiveCount: number;
  restorableCount: number;
  threeTwoOne: {
    copies: number;
    storageLocations: number;
    offSite: number;
    satisfied: boolean;
    note: string;
  };
  schedule: {
    enabled: boolean;
    lastRunAt: string | null;
    frequency: string;
    nextRunAtHint: string;
  } | null;
  /** Ordered by severity. An empty list with a verdict other than `ok` is a bug. */
  problems: Array<{ code: string; severity: 'error' | 'warning'; message: string }>;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How old the newest archive may be before the answer stops being `ok`. */
export const STALE_AFTER_HOURS = 26;

/**
 * Twice the schedule interval, so a daily schedule is judged over two days rather
 * than one. A single interval means a run that is 30 hours late is "late", not
 * "missing", and the distinction is the difference between a warning an operator
 * ignores and the one they act on.
 */
export function toleranceHours(frequency: string | undefined): number {
  if (frequency === 'weekly') return 24 * 9;
  if (frequency === 'monthly') return 24 * 35;
  return STALE_AFTER_HOURS * 2;
}

export function evaluateBackupHealth(facts: BackupHealthFacts): BackupHealth {
  const now = facts.now ?? Date.now();
  const problems: BackupHealth['problems'] = [];

  const usable = facts.archives.filter((archive) => archive.integrity === 'verified');
  const restorable = usable.filter((archive) => archive.complete !== false);
  const newest = facts.archives[0] ?? null;

  const lastBackup = newest
    ? {
        id: newest.id,
        type: newest.type,
        createdAt: newest.createdAt,
        ageMs: Math.max(0, now - (Date.parse(newest.createdAt) || now)),
        ageHours: 0,
        sizeBytes: Number(newest.sizeBytes || 0),
        integrity: newest.integrity,
        restorable: newest.complete !== false,
      }
    : null;
  if (lastBackup) lastBackup.ageHours = Math.round(lastBackup.ageMs / HOUR_MS);

  // Age. Measured from the newest archive whether or not it is intact: a fresh
  // corrupt archive is a worse state than a stale good one, and it is reported as its
  // own problem below rather than being folded into the age rule.
  const scheduleEnabled = facts.schedule?.enabled !== false;
  if (!facts.archives.length) {
    problems.push({
      code: 'BACKUP_NONE',
      severity: 'error',
      message: 'لا توجد أي نسخة احتياطية. أي فقد للبيانات الآن غير قابل للاسترجاع.',
    });
  } else if (lastBackup) {
    const limit = toleranceHours(facts.schedule?.frequency) * HOUR_MS;
    if (lastBackup.ageMs > limit) {
      problems.push({
        code: 'BACKUP_STALE',
        severity: 'error',
        message:
          `آخر نسخة عمرها ${lastBackup.ageHours} ساعة، والحدّ ${Math.round(limit / HOUR_MS)} ساعة. `
          + 'الجدولة لم تعد تعمل، أو فشلت بصمت.',
      });
    }
  }

  // Integrity, newest first: the newest failing matters more than an old one.
  const broken = facts.archives.filter((archive) => archive.integrity !== 'verified');
  if (broken.length) {
    const brokenNewest = broken.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    problems.push({
      code: 'BACKUP_CORRUPT',
      severity: 'error',
      message:
        `${broken.length} من ${facts.archives.length} نسخة لا تمرّ التحقق — أحدثها بتاريخ ${brokenNewest.createdAt}. `
        + 'النسخة التالفة ليست نسخة احتياطية.',
    });
  }

  // Restorability. Verified and unusable is a state the list used to show as green.
  const unusable = usable.filter((archive) => archive.complete === false);
  if (unusable.length) {
    problems.push({
      code: 'BACKUP_NOT_RESTORABLE',
      severity: 'error',
      message:
        `${unusable.length} نسخة سليمة لكنها ناقصة ولا يمكن الاستعادة منها. `
        + 'التحقق من السليمة لا يعني أن الاستعادة ستنجح.',
    });
  }

  // The schedule itself. A disabled schedule is a deliberate choice, so it is a
  // warning rather than an error — but silence about it is what let a stopped
  // schedule look healthy.
  if (facts.schedule && facts.schedule.enabled === false) {
    problems.push({
      code: 'BACKUP_SCHEDULE_DISABLED',
      severity: 'warning',
      message: 'الجدولة معطّلة. لا تُنشأ نسخ جديدة تلقائياً.',
    });
  }

  // 3-2-1, counted honestly.
  const locations = Math.max(1, Number(facts.storageLocations ?? 1));
  const offSite = Math.max(0, Number(facts.offSiteCopies ?? 0));
  const satisfied = facts.archives.length >= 3 && locations >= 2 && offSite >= 1;
  if (facts.archives.length > 0 && !satisfied) {
    problems.push({
      code: 'BACKUP_321',
      severity: 'warning',
      message:
        `قاعدة 3-2-1 غير محقّقة: ${facts.archives.length} نسخة على ${locations} وجهة واحدة، `
        + `و${offSite} نسخة خارج الموقع. ثلاث نسخ في مجلد واحد هي نسخة واحدة.`,
    });
  }

  const verdict: BackupVerdict = !facts.archives.length
    ? 'none'
    : problems.some((problem) => problem.severity === 'error')
      ? 'unhealthy'
      : problems.length
        ? 'stale'
        : 'ok';

  const summary = verdict === 'ok'
    ? `النسخ الاحتياطية سليمة. أحدثها عمرها ${lastBackup?.ageHours ?? 0} ساعة.`
    : problems.find((problem) => problem.severity === 'error')?.message
      ?? problems[0]?.message
      ?? '';

  return {
    verdict,
    summary,
    lastBackup,
    archiveCount: facts.archives.length,
    restorableCount: restorable.length,
    threeTwoOne: {
      copies: facts.archives.length,
      storageLocations: locations,
      offSite,
      satisfied,
      note: satisfied
        ? 'ثلاث نسخ على وجهتين، واحدة منها خارج الموقع.'
        : 'النسخ كلها على هذا الجهاز، فيفقدها فقد القرص أو الجهاز كله.',
    },
    schedule: facts.schedule
      ? {
          enabled: facts.schedule.enabled,
          lastRunAt: facts.schedule.lastRunAt ?? null,
          frequency: facts.schedule.frequency,
          nextRunAtHint: `${facts.schedule.hour}:${String(facts.schedule.minute).padStart(2, '0')}`,
        }
      : null,
    problems,
  };
}
