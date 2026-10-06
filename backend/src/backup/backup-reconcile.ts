/**
 * B10 — the archive directory and the manifest are two things that must agree, and
 * nothing made them agree.
 *
 * ## What went wrong
 *
 * The manifest is an index; the `.ffbkp` files are the data. Every operation that
 * touches one and not the other can leave them disagreeing, and each way of
 * disagreeing is silent:
 *
 * - A crash between writing the file and writing the row leaves a file nothing lists.
 * - A crash between writing the row and writing the file leaves a row pointing at
 *   nothing, and a restore aimed at that id fails *after* the operator confirmed it.
 * - A retained `.tmp-` from a failed atomic write (B16) is neither: it is not an
 *   archive, and it consumes the exact disk space the space check is protecting.
 *
 * None of these show up in `GET /backup/list`, because the list is built from the
 * manifest. So an operator sees a healthy set of backups while the disk fills with
 * files the system will never mention again. That is the worst combination available:
 * the dashboard is reassuring and the disk is the problem.
 *
 * ## Why reconciliation has to be this cautious
 *
 * The obvious implementation — "delete every `.ffbkp` not in the manifest" — is a
 * data-loss bug wearing the costume of a cleanup job. Consider the manifest lost or
 * truncated: suddenly every real archive looks like an orphan, and the sweeper deletes
 * the only copies of the operator's data in response to an index fault.
 *
 * So the rule is asymmetric. An **absent row** is weak evidence (a crash explains it);
 * an **absent file** is strong evidence (rows are written after files on purpose). The
 * sweeper only ever deletes on weak evidence, only when a manifest still exists to
 * contradict it, and never when the result would be zero restorable archives.
 */

/** How long a `.tmp-` must sit untouched before it is treated as abandoned. */
export const TEMP_GRACE_MS = 60 * 60 * 1000; // 1 hour

/**
 * How long an untracked `.ffbkp` must sit untouched before it is called an orphan.
 *
 * ## The race this closes
 *
 * `createBackupInternal` renames the archive into its final name and only afterwards adds
 * its manifest row. Between those two moments the file is complete, correctly named, and
 * **not in the manifest** — which is exactly what an orphan looks like.
 *
 * With two backups running at once, B's post-backup reconciliation read the manifest while
 * A was in that window and deleted A's brand-new archive. A then wrote its row, producing
 * an index entry pointing at a file that no longer existed: un-restorable, un-deletable
 * (it is tracked, so reconciliation skips it), and invisible to the operator until they
 * tried to use it.
 *
 * The grace window is what distinguishes *just crashed* from *in flight*. Neither is
 * distinguishable at the instant of observation, and both are young — so age is the only
 * evidence available, and treating a five-second-old archive as garbage is what caused it.
 */
export const ORPHAN_GRACE_MS = 5 * 60 * 1000; // 5 minutes

export type DirectoryEntry = {
  name: string;
  sizeBytes: number;
  /** Modification time, milliseconds since epoch. */
  mtimeMs: number;
};

export type ReconcileAction =
  | 'KEEP_TRACKED'
  /** Referenced by a manifest row. Never touched, whatever else is true. */
  | 'KEEP_TOO_YOUNG'
  | 'KEEP_UNDECIDED'
  | 'KEEP_NON_ARCHIVE'
  | 'DELETE_ORPHAN'
  | 'DELETE_STALE_TEMP';

export type ReconcileDecision = {
  name: string;
  sizeBytes: number;
  action: ReconcileAction;
  reason: string;
};

export type ReconcilePlan = {
  decisions: ReconcileDecision[];
  toDelete: string[];
  /** Bytes the sweep would reclaim. */
  reclaimableBytes: number;
  /**
   * Set when the directory and the manifest cannot be reconciled safely, and the
   * operator needs to look. Nothing is deleted in this state.
   */
  suspect: null | {
    code: 'MANIFEST_SUSPECT' | 'WOULD_EMPTY_ARCHIVE';
    message: string;
  };
};

const isTemp = (name: string) => /\.tmp-\d+-\d+$/.test(name);
const isArchive = (name: string) => /\.ffbkp$/.test(name);

/**
 * The decision, as a pure function.
 *
 * @param entries   everything currently in the archive directory
 * @param tracked   file names the manifest references
 * @param manifestCount how many rows the manifest holds
 * @param now       injectable so the grace window can be tested without waiting
 */
export function planReconciliation(input: {
  entries: DirectoryEntry[];
  tracked: readonly string[];
  manifestCount: number;
  now: number;
}): ReconcilePlan {
  const tracked = new Set(input.tracked);
  const decisions: ReconcileDecision[] = [];
  const toDelete: string[] = [];
  let reclaimableBytes = 0;

  // --- The states in which deleting would be irresponsible. -------------------
  //
  // Checked before anything is removed, because once the first unlink succeeds the
  // decision to delete cannot be taken back.
  if (input.manifestCount === 0 && input.entries.some((entry) => isArchive(entry.name))) {
    return {
      decisions: input.entries.map((entry) => ({
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        action: 'KEEP_UNDECIDED' as const,
        reason: 'الملف (الفهرس) فارغ بينما يوجد ملف نسخة على القرص - قد يكون الفهرس هو المفقود.',
      })),
      toDelete: [],
      reclaimableBytes: 0,
      suspect: {
        code: 'MANIFEST_SUSPECT',
        message:
          'الملف(الفهرس) فارغ بينما توجد ملفات نسخ على القرص. ' +
          'هذا قد يعني فقدان الفهرس لا وجود ملفات يتيمة. لم يُحذف شيء — ' +
          'راجع النسخة الاحتياطية لـ manifest.json أولاً.',
      },
    };
  }

  for (const entry of input.entries) {
    if (tracked.has(entry.name)) {
      decisions.push({
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        action: 'KEEP_TRACKED',
        reason: 'مُشار إليه في الفهرس.',
      });
      continue;
    }

    if (isTemp(entry.name)) {
      const age = input.now - entry.mtimeMs;
      if (age < TEMP_GRACE_MS) {
        decisions.push({
          name: entry.name,
          sizeBytes: entry.sizeBytes,
          action: 'KEEP_TOO_YOUNG',
          reason: 'كتابة جارية أو حديثة (' + Math.round(age / 1000) + ' ثانية).',
        });
      } else {
        decisions.push({
          name: entry.name,
          sizeBytes: entry.sizeBytes,
          action: 'DELETE_STALE_TEMP',
          reason: `ملف مؤقت متروك منذ ${Math.round(age / 60000)} دقيقة.`,
        });
        toDelete.push(entry.name);
        reclaimableBytes += entry.sizeBytes;
      }
      continue;
    }

    if (!isArchive(entry.name)) {
      // Config snapshots and anything else the module keeps here are not ours to judge.
      decisions.push({
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        action: 'KEEP_NON_ARCHIVE',
        reason: 'ليس ملف نسخة.',
      });
      continue;
    }

// An untracked archive is an orphan — unless it is seconds old, in which case it is a
    // backup whose manifest row has not been written yet. See `ORPHAN_GRACE_MS` for the
    // race this closes: the archive is renamed into its final name before the row exists,
    // so a concurrent sweep used to delete a backup that was still being created.
    const age = input.now - entry.mtimeMs;
    if (age < ORPHAN_GRACE_MS) {
      decisions.push({
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        action: 'KEEP_TOO_YOUNG',
        reason:
          `أرشيف بلا سطر في الفهرس لكنه حديث (${Math.round(age / 1000)} ثانية) - `
          + 'قد يكون نسخة قيد الإنشاء.',
      });
      continue;
    }

    decisions.push({
      name: entry.name,
      sizeBytes: entry.sizeBytes,
      action: 'DELETE_ORPHAN',
      reason: 'ملف نسخة لا يشير إليه الفهرس منذ مدة كافية ليُعدّ يتيماً.',
    });
    toDelete.push(entry.name);
    reclaimableBytes += entry.sizeBytes;
  }

  // --- And the one case where even weak evidence is too weak. ---------------
  //
  // Deleting an orphan never reduces what is restorable — tracked files are never
  // touched — so the arithmetic that matters is about the *directory*, not the manifest:
  // if the sweep would leave no archive at all on disk, then the manifest's rows already
  // point at files that are gone, and removing the last real files would convert a
  // recoverable inconsistency into an unrecoverable one.
  //
  // Concretely: the manifest references `a.ffbkp`, `a.ffbkp` was lost, and the directory
  // holds two untracked archives. Naively deleting both leaves a row pointing at nothing
  // and an empty directory — the operator's data gone, decided by a cleanup job.
  const archivesBefore = input.entries.filter((entry) => isArchive(entry.name)).length;
  const archivesAfter = archivesBefore - toDelete.filter((name) => isArchive(name)).length;

  if (toDelete.length > 0 && archivesAfter === 0) {
    return {
      decisions: decisions.map((entry) => ({ ...entry, action: 'KEEP_UNDECIDED' as const })),
      toDelete: [],
      reclaimableBytes: 0,
      suspect: {
        code: 'WOULD_EMPTY_ARCHIVE',
        message:
          'تنظيف الملفات اليتيمة كان سيترك صفر ملفات نسخ على القرص. ' +
          'لم يُحذف شيء - الفهرس يشير إلى ملفات غير موجودة، والحذف لا يحسم هذا التعارض.',
      },
    };
  }

  return { decisions, toDelete, reclaimableBytes, suspect: null };
}