import { describe, expect, it } from 'vitest';
import {
  normalizeRetentionLimits,
  planRetention,
  PROTECTED_BACKUP_TYPES,
  RETENTION_BOUNDS,
  RETENTION_DEFAULTS,
  type RetentionLimits,
} from './retention';

/**
 * B9 — retention deletes files.
 *
 * This is the only test in the repository that checks what retention *does*. The
 * existing coverage was a round trip asserting that `retentionDays: 14` came back
 * out of the API, which would pass just as happily against an implementation that
 * deleted nothing at all.
 *
 * The previous implementation deleted by age alone, and three of the cases below
 * fail against it — marked, because a test that cannot fail is not a test.
 *
 * The rules exist for reasons that are not about tidiness:
 *
 * - **A count cap**, because age alone cannot bound a store that is written more
 *   often than the retention window: hourly backups with a 30-day policy keep 720.
 * - **A protected type**, because `applyRestore` checks that its token names a
 *   safety snapshot and never checks that the archive still exists — so a snapshot
 *   removed on the same 30-day clock makes a confirmed restore irreversible while
 *   still reporting success.
 * - **A floor**, because an empty manifest makes `findBackupById` return null for
 *   every id, which makes the factory reset refuse with `SYSTEM_RESET_BACKUP_MISSING`.
 *   A retention pass must never be what empties the store.
 */

type Row = { id: string; fileName: string; type: string; createdAt: string };

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const row = (id: string, days: number, type = 'full'): Row => ({
  id,
  fileName: `${id}.ffbkp`,
  type,
  createdAt: daysAgo(days),
});

const ids = (rows: Row[]) => rows.map((entry) => entry.id);

describe('retention', () => {
  it('keeps what is inside the window and expires what is not', () => {
    const plan = planRetention(
      [row('new', 1), row('old', 40), row('edge', 29)],
      { retentionDays: 30, maxCount: 100, minCount: 1, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(ids(plan.keep).sort()).toEqual(['edge', 'new']);
    expect(ids(plan.remove)).toEqual(['old']);
    expect(plan.reasons.old).toBe('expired');
  });

  it('caps the count even when nothing has expired  ← fails without the count rule', () => {
    // Five archives from the last week, retention of thirty days. The old code
    // returned all five, and a store written hourly would grow without bound.
    const plan = planRetention(
      [row('a', 1), row('b', 2), row('c', 3), row('d', 4), row('e', 5)],
      { retentionDays: 30, maxCount: 3, minCount: 1, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(ids(plan.keep)).toEqual(['a', 'b', 'c']);
    expect(plan.reasons.d).toBe('over-count');
    expect(plan.reasons.e).toBe('over-count');
  });

  it('never expires a safety snapshot by age  ← fails without the type rule', () => {
    // Four hundred days old, under a thirty-day policy, with a count cap of one.
    const plan = planRetention(
      [row('undo', 400, 'safety_snapshot'), row('today', 0)],
      { retentionDays: 30, maxCount: 1, minCount: 1, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(ids(plan.keep)).toContain('undo');
    expect(plan.reasons.undo).toBeUndefined();
  });

  it('caps snapshots separately, so protecting them is not unbounded growth', () => {
    // Each restore preview writes a whole database dump. "Never delete a snapshot"
    // without a ceiling is a disk-full incident on a path nobody watches.
    const plan = planRetention(
      [row('s1', 1, 'safety_snapshot'), row('s2', 2, 'safety_snapshot'), row('s3', 3, 'safety_snapshot')],
      { retentionDays: 30, maxCount: 100, minCount: 1, maxSafetySnapshots: 2 },
      { now: NOW },
    );

    expect(ids(plan.keep)).toEqual(['s1', 's2']);
    expect(plan.reasons.s3).toBe('over-snapshot-cap');
  });

  it('keeps a snapshot an unconfirmed restore is waiting on, and gives way the next-newest', () => {
    const plan = planRetention(
      [row('s1', 1, 'safety_snapshot'), row('s2', 2, 'safety_snapshot'), row('s3', 3, 'safety_snapshot')],
      { retentionDays: 30, maxCount: 100, minCount: 1, maxSafetySnapshots: 2 },
      { now: NOW, pinnedSnapshotIds: new Set(['s2']) },
    );

    // The pinned one survives even though it is not the newest, and the oldest goes
    // in its place. The operator is looking at a confirmation screen right now; the
    // undo behind it is the one thing that must not move.
    expect(ids(plan.keep).sort()).toEqual(['s1', 's2']);
    expect(plan.reasons.s3).toBe('over-snapshot-cap');
  });

  it('refuses to go below the floor instead of emptying the store', () => {
    const plan = planRetention(
      [row('a', 100), row('b', 200)],
      { retentionDays: 30, maxCount: 100, minCount: 2, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(plan.remove, 'two archives with a floor of two means nothing goes').toEqual([]);
    expect(plan.refused.sort()).toEqual(['a', 'b']);
  });

  it('admits exactly what the floor allows, oldest first', () => {
    const plan = planRetention(
      [row('a', 10), row('b', 20), row('c', 100)],
      { retentionDays: 30, maxCount: 100, minCount: 2, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    // The oldest expired archive is the one that goes, and only that one.
    expect(ids(plan.remove)).toEqual(['c']);
    expect(plan.refused).toEqual([]);
    expect(ids(plan.keep)).toEqual(['a', 'b']);
  });

  it('counts snapshots towards the floor, so a store of snapshots alone is still bounded', () => {
    const plan = planRetention(
      [row('s1', 1, 'safety_snapshot'), row('old', 100), row('older', 200)],
      { retentionDays: 30, maxCount: 100, minCount: 3, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(plan.remove).toEqual([]);
  });

  it('treats an undated row as a count problem, not an age problem', () => {
    const undated: Row = { id: 'x', fileName: 'x.ffbkp', type: 'full', createdAt: '' };

    // Deleting an archive because its timestamp could not be parsed is a data-loss
    // decision produced by a read failure.
    const byAge = planRetention([undated, row('a', 0)], { retentionDays: 30, maxCount: 10, minCount: 1 }, { now: NOW });
    expect(ids(byAge.keep)).toContain('x');

    const byCount = planRetention([undated, row('a', 0)], { retentionDays: 30, maxCount: 1, minCount: 1 }, { now: NOW });
    expect(ids(byCount.keep)).toEqual(['a']);
    expect(byCount.reasons.x).toBe('over-count');
  });

  it('preserves the manifest order of what survives', () => {
    // The manifest is newest-first by convention, and reshuffling it would make the
    // interface jump for no reason.
    const plan = planRetention(
      [row('a', 1), row('b', 2), row('c', 3)],
      { retentionDays: 30, maxCount: 2, minCount: 1, maxSafetySnapshots: 3 },
      { now: NOW },
    );

    expect(ids(plan.keep)).toEqual(['a', 'b']);
  });

  it('clamps limits, and stops a floor above the ceiling from disabling retention', () => {
    expect(normalizeRetentionLimits({ maxCount: 0 }).maxCount).toBe(RETENTION_BOUNDS.maxCount.min);
    expect(normalizeRetentionLimits({ maxCount: -5 }).maxCount).toBe(RETENTION_BOUNDS.maxCount.min);
    expect(normalizeRetentionLimits({ maxCount: 99_999 }).maxCount).toBe(RETENTION_BOUNDS.maxCount.max);
    expect(normalizeRetentionLimits({ maxCount: Number.NaN }).maxCount).toBe(RETENTION_DEFAULTS.maxCount);
    expect(normalizeRetentionLimits({ maxCount: 'abc' as never }).maxCount).toBe(RETENTION_DEFAULTS.maxCount);
    expect(normalizeRetentionLimits(null)).toEqual(RETENTION_DEFAULTS);

    // The dangerous pair: a floor above the ceiling protects everything, so retention
    // stops deleting and the operator believes a setting is in force.
    const limits = normalizeRetentionLimits({ minCount: 9999, maxCount: 5 });
    expect(limits.minCount).toBe(5);
  });

  it('names the type it protects, so the constant has a use', () => {
    expect(PROTECTED_BACKUP_TYPES.has('safety_snapshot')).toBe(true);
    expect(PROTECTED_BACKUP_TYPES.has('full')).toBe(false);
  });
});

describe('the floor as the service applies it', () => {
  // The pure planner refuses deletions; `updateSchedule` turns that into a 409. The
  // condition it must use is "retention would delete *and* the result is below the
  // floor" — not "the store is below the floor". The second form blocks an operator
  // from changing the backup hour on a machine that happens to hold one archive,
  // with a message about copies that were never candidates for deletion.
  const decide = (total: number, limits: Partial<RetentionLimits>, now = NOW) =>
    planRetention(
      Array.from({ length: total }, (_, index) => row(`b${index}`, index)),
      { retentionDays: 30, maxCount: 100, minCount: 2, maxSafetySnapshots: 3, ...limits },
      { now },
    );

  it('marks and then refuses, so the service has something to reject the change over', () => {
    // Two archives past the retention window and a floor of two: both are candidates
    // for deletion, and deleting either would leave one. The planner therefore marks
    // them and then declines — `refused` is the signal `updateSchedule` turns into a
    // 409, which is why it is reported rather than silently applied.
    const plan = planRetention([row('a', 100), row('b', 200)], { retentionDays: 30, maxCount: 100, minCount: 2, maxSafetySnapshots: 3 }, { now: NOW });
    expect(plan.remove).toEqual([]);
    expect(plan.refused.sort()).toEqual(['a', 'b']);
  });

  it('proposes nothing when the store is below the floor and nothing has expired', () => {
    const plan = decide(1, { minCount: 2 });
    expect(plan.remove).toEqual([]);
    expect(plan.refused).toEqual([]);
  });

  it('lets a cap delete down to exactly the floor', () => {
    const plan = decide(4, { maxCount: 2, minCount: 2 });
    expect(plan.remove.length).toBe(2);
    expect(plan.keep.length).toBe(2);
    expect(plan.refused).toEqual([]);
  });
});
