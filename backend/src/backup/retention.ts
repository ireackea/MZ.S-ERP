/**
 * B9 — deciding which archives survive, as a pure function.
 *
 * It is pure on purpose. The rule that chooses what to delete is the part worth
 * reading and worth testing, and it is the part that had no tests at all: the only
 * coverage in the repository was a round trip asserting that `retentionDays: 14`
 * came back out of the API. Nothing anywhere checked what retention *did*.
 *
 * Kept out of `BackupService` so it can be exercised without a filesystem, a
 * database or a running Nest container, and so the policy has one name that the
 * service, the tests and the audit guards all point at. A rule re-implemented
 * inline in the service is a rule that can drift from the one that is tested.
 *
 * The three rules, in the order they apply:
 *
 * 1. **Age.** An archive older than `retentionDays` goes.
 * 2. **Count.** Whatever the age rule left is capped at `maxCount`, newest first.
 * 3. **Type.** A `safety_snapshot` is the undo for a restore, and no age or count
 *    rule may remove one — capped separately, because protecting them without a cap
 *    is unbounded growth on a path nobody watches.
 *
 * And a floor underneath all three: `minCount` archives always survive. A retention
 * pass must never be the thing that empties the store, because an empty manifest
 * makes `findBackupById` return null for every id, which makes the factory reset
 * refuse with `SYSTEM_RESET_BACKUP_MISSING`.
 */

export type RetentionCandidate = {
  id: string;
  fileName: string;
  type: string;
  createdAt: string;
};

export type RetentionLimits = {
  retentionDays: number;
  maxCount: number;
  minCount: number;
  maxSafetySnapshots: number;
};

export type RetentionReason = 'expired' | 'over-count' | 'over-snapshot-cap';

export type RetentionPlan<T> = {
  /** Survivors, in the caller's original order so the manifest is not reshuffled. */
  keep: T[];
  /** Rows to drop from the manifest. Their files are the caller's to unlink. */
  remove: T[];
  /** Why each removed row was removed. */
  reasons: Record<string, RetentionReason>;
  /**
   * Rows the floor protected. They are in `keep`.
   *
   * Reported rather than silently applied: an operator who asked to keep 2 and was
   * left with 9 has been told something false otherwise, and a retention pass that
   * quietly declines is indistinguishable from one that did not run.
   */
  refused: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Types no age or count rule may remove.
 *
 * `applyRestore` checks that its token names a safety snapshot and nothing more — it
 * never asks whether that archive is still on disk. The undo for a restore the
 * operator is looking at right now therefore has to survive retention, or a
 * confirmed restore becomes irreversible while still reporting success.
 */
export const PROTECTED_BACKUP_TYPES: ReadonlySet<string> = new Set(['safety_snapshot']);

export const RETENTION_DEFAULTS: RetentionLimits = {
  retentionDays: 30,
  // 60 daily archives is about two months at a 30-day policy, which keeps the count
  // rule from quietly becoming the binding one and making `retentionDays` look like
  // it still governs anything.
  maxCount: 60,
  // One archive and nothing else means the only surviving copy is also the only
  // copy. Two keeps a fallback if the index is ever truncated.
  minCount: 2,
  // Each restore preview writes a whole database dump, so "never delete a snapshot"
  // without a ceiling is unbounded growth nobody is watching.
  maxSafetySnapshots: 3,
};

export const RETENTION_BOUNDS = {
  retentionDays: { min: 1, max: 3650 },
  maxCount: { min: 1, max: 1000 },
  minCount: { min: 1, max: 1000 },
  maxSafetySnapshots: { min: 1, max: 100 },
} as const;

export function normalizeRetentionLimits(input?: Partial<RetentionLimits> | null): RetentionLimits {
  const raw = { ...RETENTION_DEFAULTS, ...(input || {}) };
  const bounded = (key: keyof typeof RETENTION_BOUNDS, value: unknown): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return RETENTION_DEFAULTS[key];
    const bound = RETENTION_BOUNDS[key];
    return Math.max(bound.min, Math.min(bound.max, Math.round(parsed)));
  };

  const limits: RetentionLimits = {
    retentionDays: bounded('retentionDays', raw.retentionDays),
    maxCount: bounded('maxCount', raw.maxCount),
    minCount: bounded('minCount', raw.minCount),
    maxSafetySnapshots: bounded('maxSafetySnapshots', raw.maxSafetySnapshots),
  };
  // A floor above the ceiling protects everything and silently stops retention.
  limits.minCount = Math.min(limits.minCount, limits.maxCount);
  return limits;
}

export function planRetention<T extends RetentionCandidate>(
  entries: readonly T[],
  input?: Partial<RetentionLimits> | null,
  context: { now?: number; pinnedSnapshotIds?: ReadonlySet<string> } = {},
): RetentionPlan<T> {
  const limits = normalizeRetentionLimits(input);
  const now = context.now ?? Date.now();
  const cutoff = now - limits.retentionDays * DAY_MS;
  const pinned = context.pinnedSnapshotIds ?? new Set<string>();

  // An undated row sorts as oldest so the count cap, not the age rule, is what
  // eventually deals with it. Deleting an archive because its timestamp could not be
  // read is a data-loss decision produced by a parse failure.
  const ageOf = (entry: T): number => {
    const parsed = Date.parse(entry.createdAt || '');
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  const isProtected = (entry: T) => PROTECTED_BACKUP_TYPES.has(entry.type);
  const ordered = [...entries].sort((a, b) => ageOf(b) - ageOf(a));
  const protectedEntries = ordered.filter(isProtected);
  const ordinary = ordered.filter((entry) => !isProtected(entry));

  const removal = new Map<T, RetentionReason>();

  // Rule 3. The snapshot cap is separate from `maxCount` so protecting snapshots
  // cannot make the store grow without bound. A snapshot an unconfirmed restore still
  // depends on is pinned: it counts towards the cap and is never removed, and the
  // next-newest one gives way instead.
  let snapshotsKept = 0;
  for (const entry of protectedEntries) {
    if (snapshotsKept < limits.maxSafetySnapshots || pinned.has(entry.id)) {
      snapshotsKept += 1;
      continue;
    }
    removal.set(entry, 'over-snapshot-cap');
  }

  // Rules 1 and 2.
  //
  // The count cap is applied to what the age rule left, not to the raw list, so a
  // short `retentionDays` cannot double-prune and the survivors are always the newest
  // `maxCount` rather than "the newest N of whatever happened to survive the age
  // pass".
  const withinAge: T[] = [];
  const beyondAge: T[] = [];
  for (const entry of ordinary) {
    const at = ageOf(entry);
    if (Number.isFinite(at) && at < cutoff) beyondAge.push(entry);
    else withinAge.push(entry);
  }
  for (const entry of beyondAge) removal.set(entry, 'expired');

  const keptFromWithinAge = new Set(withinAge.slice(0, limits.maxCount));
  for (const entry of withinAge) {
    if (!keptFromWithinAge.has(entry)) removal.set(entry, 'over-count');
  }

  // The floor goes last, over everything, and it *refuses* rather than throwing.
  //
  // The allowance is `total - minCount`, not `total - alreadyMarked - minCount`:
  // the marked rows are the ones being *proposed* for deletion, so subtracting them
  // would count them twice and refuse deletions the floor actually permits — which
  // reads as retention silently doing nothing.
  const allowance = Math.max(0, ordered.length - limits.minCount);
  const oldestFirst = [...removal.keys()].sort((a, b) => ageOf(a) - ageOf(b));

  const doomed: T[] = [];
  const refused: string[] = [];
  oldestFirst.forEach((entry, index) => {
    if (index < allowance) doomed.push(entry);
    else {
      refused.push(entry.id);
      removal.delete(entry);
    }
  });

  const doomedSet = new Set<T>(doomed);
  const reasons: Record<string, RetentionReason> = {};
  for (const entry of doomed) reasons[entry.id] = removal.get(entry) ?? 'over-count';

  return {
    keep: entries.filter((entry) => !doomedSet.has(entry)),
    remove: doomed,
    reasons,
    refused,
  };
}
