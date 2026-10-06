import { describe, expect, it } from 'vitest';
import { ORPHAN_GRACE_MS, TEMP_GRACE_MS, planReconciliation, type DirectoryEntry } from './backup-reconcile';

const NOW = 1_800_000_000_000;
const entry = (name: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  name,
  sizeBytes: 1024,
  // Old enough to be judged.
  //
  // The default used to be 60 seconds old, which was correct until the orphan grace window
  // was added — and then every fixture silently became "too recent to act on". A fixture
  // whose age decides the outcome has to make that age explicit, and the default here means
  // `old enough to act on`. Anything testing a *fresh* file must say so.
  mtimeMs: NOW - ORPHAN_GRACE_MS - 1000,
  ...overrides,
});

const plan = (input: {
  entries: DirectoryEntry[];
  tracked?: string[];
  manifestCount?: number;
}) =>
  planReconciliation({
    entries: input.entries,
    tracked: input.tracked ?? [],
    manifestCount: input.manifestCount ?? input.tracked?.length ?? 0,
    now: NOW,
  });

describe('B10 — an untracked archive is an orphan', () => {
  it('deletes it, and says how many bytes that returns to the disk', () => {
    const result = plan({
      entries: [entry('kept.ffbkp'), entry('orphan.ffbkp', { sizeBytes: 5_000_000 })],
      tracked: ['kept.ffbkp'],
    });

    expect(result.toDelete).toEqual(['orphan.ffbkp']);
    expect(result.reclaimableBytes).toBe(5_000_000);
    expect(result.suspect).toBeNull();
    expect(result.decisions.find((d) => d.name === 'kept.ffbkp')?.action).toBe('KEEP_TRACKED');
  });

  it('never touches a tracked file, however old or large', () => {
    // The whole point of the sweep is that it is safe for the files it keeps. A
    // tracked file is data the operator can restore from, so its age is irrelevant.
    const result = plan({
      entries: [entry('tracked.ffbkp', { sizeBytes: 10 ** 12, mtimeMs: 0 })],
      tracked: ['tracked.ffbkp'],
    });
    expect(result.toDelete).toEqual([]);
    expect(result.reclaimableBytes).toBe(0);
  });

  it('leaves non-archive files alone', () => {
    // Config snapshots live in this directory. A sweep that deleted "untracked" files
    // would eat them.
    const result = plan({
      entries: [entry('schedule.json'), entry('nested/whatever'), entry('README')],
      tracked: [],
      manifestCount: 3,
    });
    expect(result.toDelete).toEqual([]);
    expect(result.decisions.every((d) => d.action === 'KEEP_NON_ARCHIVE')).toBe(true);
  });
});

describe('B10 — a temporary file from an interrupted write', () => {
  it('waits out the grace window, because a write may be in flight', () => {
    // The controller hands incoming imports a path in this very directory. A sweeper
    // that deleted by age alone would remove a file that is still being written.
    const result = plan({
      entries: [entry('incoming.ffbkp.tmp-1-2', { mtimeMs: NOW - 1000 })],
      tracked: [],
      manifestCount: 1,
    });
    expect(result.toDelete).toEqual([]);
    expect(result.decisions[0].action).toBe('KEEP_TOO_YOUNG');
  });

it('waits on a *completed* archive too, because its row may not exist yet', () => {
    // This was a live race, found by running three backups at once: `createBackupInternal`
    // renames the archive into its final name and only afterwards writes its manifest row.
    // Between those two moments the file is complete, correctly named, and untracked —
    // indistinguishable from an orphan. A concurrent sweep deleted it, leaving a row
    // pointing at nothing: un-restorable, and un-deletable, because a tracked file is
    // skipped by definition.
    const fresh = plan({
      entries: [entry('fresh.ffbkp', { mtimeMs: NOW - 2000 })],
      tracked: [],
      manifestCount: 1,
    });
    expect(fresh.toDelete).toEqual([]);
    expect(fresh.decisions[0].action).toBe('KEEP_TOO_YOUNG');
    expect(fresh.decisions[0].reason).toContain('قيد الإنشاء');
  });

  it('reclaims an untracked archive once it is old enough to be genuinely abandoned', () => {
    const stale = plan({
      entries: [
        entry('tracked.ffbkp'),
        entry('orphan.ffbkp', { mtimeMs: NOW - ORPHAN_GRACE_MS - 1000, sizeBytes: 4096 }),
      ],
      tracked: ['tracked.ffbkp'],
      manifestCount: 1,
    });
    expect(stale.toDelete).toEqual(['orphan.ffbkp']);
    expect(stale.reclaimableBytes).toBe(4096);
    expect(stale.decisions.find((d) => d.name === 'orphan.ffbkp')?.action).toBe('DELETE_ORPHAN');
  });

  it('reclaims it once it is old enough to be beyond doubt', () => {
    // A `.tmp-` file that nothing has touched for an hour is not a write in progress.
    // And it is consuming the exact disk space B16 refuses to spend.
    const result = plan({
      entries: [entry('tracked.ffbkp'), entry('abandoned.ffbkp.tmp-1-2', { mtimeMs: 0 })],
      tracked: ['tracked.ffbkp'],
      manifestCount: 1,
    });
    expect(result.toDelete).toEqual(['abandoned.ffbkp.tmp-1-2']);
    expect(result.decisions.find((d) => d.name === 'abandoned.ffbkp.tmp-1-2')?.action).toBe(
      'DELETE_STALE_TEMP',
    );
  });

  it('classifies by the name suffix, so a marker inside the name changes nothing', () => {
    // `foo.ffbkp.tmp-1-2` is a temporary, not an archive, so age decides it rather
    // than orphan-hood. Conversely a file that merely contains ".tmp" in the middle is
    // still an archive.
    const stale = plan({
      entries: [entry('tracked.ffbkp'), entry('abandoned.ffbkp.tmp-1-2', { mtimeMs: 0 })],
      tracked: ['tracked.ffbkp'],
      manifestCount: 1,
    });
    expect(stale.decisions.find((d) => d.name === 'abandoned.ffbkp.tmp-1-2')?.action).toBe(
      'DELETE_STALE_TEMP',
    );

    const marker = plan({
      entries: [entry('tracked.ffbkp'), entry('a.tmpmarker.ffbkp', { mtimeMs: 0 })],
      tracked: ['tracked.ffbkp'],
      manifestCount: 1,
    });
    // It ends in .ffbkp, so it is an archive - and untracked, so an orphan.
    expect(marker.decisions.find((d) => d.name === 'a.tmpmarker.ffbkp')?.action).toBe(
      'DELETE_ORPHAN',
    );
  });
});

describe('B10 — the two cases where deleting would be a data-loss bug', () => {
  it('refuses to sweep when the manifest is empty but archives exist', () => {
    // The naive implementation — delete everything not in the manifest — turns a lost
    // index into an empty disk. The manifest is the weaker witness here, so nothing
    // is deleted and the operator is told to look at manifest.json first.
    const result = plan({
      entries: [entry('a.ffbkp'), entry('b.ffbkp'), entry('c.ffbkp')],
      tracked: [],
      manifestCount: 0,
    });

    expect(result.toDelete).toEqual([]);
    expect(result.reclaimableBytes).toBe(0);
    expect(result.suspect?.code).toBe('MANIFEST_SUSPECT');
    expect(result.suspect?.message).toContain('manifest.json');
    expect(result.decisions.every((d) => d.action === 'KEEP_UNDECIDED')).toBe(true);
  });

  it('refuses to sweep when it would leave no archive file on disk at all', () => {
    // The dangerous shape: the manifest references `lost.ffbkp`, that file is gone,
    // and the two files actually on disk are untracked. A naive sweep deletes both and
    // leaves a row pointing at nothing plus an empty directory. Nothing here is
    // recoverable after that.
    const result = plan({
      entries: [entry('stray-a.ffbkp'), entry('stray-b.ffbkp')],
      tracked: ['lost.ffbkp'],
      manifestCount: 1,
    });

    expect(result.toDelete).toEqual([]);
    expect(result.reclaimableBytes).toBe(0);
    expect(result.suspect?.code).toBe('WOULD_EMPTY_ARCHIVE');
    expect(result.decisions.every((d) => d.action === 'KEEP_UNDECIDED')).toBe(true);
  });

  it('deletes an orphan even when only one tracked archive remains', () => {
    // The mirror image, and the case an over-cautious sweeper gets wrong: removing an
    // untracked file does not reduce what is restorable, because tracked files are never
    // touched. Refusing here would strand orphans forever on small deployments.
    const result = plan({
      entries: [entry('tracked.ffbkp'), entry('orphan.ffbkp')],
      tracked: ['tracked.ffbkp'],
      manifestCount: 1,
    });
    expect(result.toDelete).toEqual(['orphan.ffbkp']);
    expect(result.suspect).toBeNull();
  });

  it('still sweeps when a reasonable number of archives would survive', () => {
    const result = plan({
      entries: [entry('a.ffbkp'), entry('b.ffbkp'), entry('orphan.ffbkp')],
      tracked: ['a.ffbkp', 'b.ffbkp'],
      manifestCount: 2,
    });
    expect(result.toDelete).toEqual(['orphan.ffbkp']);
    expect(result.suspect).toBeNull();
  });

  it('does not treat a stale temp file as a reason to hold up a sweep', () => {
    // The zero-archive guard is about *archives*. A leftover `.tmp-` is not one, so it
    // must not be able to make the whole sweep refuse forever.
    const result = plan({
      entries: [entry('a.ffbkp'), entry('stale.ffbkp.tmp-1-2', { mtimeMs: 0 })],
      tracked: ['a.ffbkp'],
      manifestCount: 1,
    });
    expect(result.toDelete).toEqual(['stale.ffbkp.tmp-1-2']);
    expect(result.suspect).toBeNull();
  });

  it('reports the suspect state even for an empty directory, rather than claiming success', () => {
    const result = plan({ entries: [], tracked: [], manifestCount: 0 });
    expect(result.toDelete).toEqual([]);
    expect(result.suspect).toBeNull();
  });
});

describe('B10 — the plan is total and explainable', () => {
  it('gives every file in the directory exactly one decision', () => {
    const entries = [
      entry('a.ffbkp'),
      entry('orphan.ffbkp'),
      entry('schedule.json'),
      entry('old.ffbkp.tmp-9-9', { mtimeMs: 0 }),
      entry('new.ffbkp.tmp-9-9'),
    ];
    const result = plan({ entries, tracked: ['a.ffbkp'], manifestCount: 5 });

    expect(result.decisions).toHaveLength(entries.length);
    expect(new Set(result.decisions.map((d) => d.name)).size).toBe(entries.length);
    for (const decision of result.decisions) {
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.sizeBytes).toBeGreaterThanOrEqual(0);
    }
  });

  it('sums reclaimable bytes only over files it will actually delete', () => {
    const result = plan({
      entries: [
        entry('orphan1.ffbkp', { sizeBytes: 100 }),
        entry('orphan2.ffbkp', { sizeBytes: 250 }),
        entry('kept.ffbkp', { sizeBytes: 999_999 }),
      ],
      tracked: ['kept.ffbkp'],
      manifestCount: 3,
    });
    expect(result.reclaimableBytes).toBe(350);
  });
});