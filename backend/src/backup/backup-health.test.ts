import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { evaluateBackupHealth, toleranceHours, type BackupHealthFacts } from './backup-health';

/**
 * B5 — "can I lose everything right now and get it back?"
 *
 * The section reported what it knew and nothing it could not: a list, a byte total, a
 * next-run time. It never answered that question, so "the backups are running" was a
 * belief. A schedule that had stopped running for a month looked identical to one that
 * had never failed, on every screen.
 *
 * These cases are the ones that were invisible. Each one is a state the old surface
 * rendered identically to a healthy one.
 */

const NOW = Date.parse('2026-09-30T12:00:00.000Z');

const facts = (over: Partial<BackupHealthFacts> = {}): BackupHealthFacts => ({
  archives: [
    {
      id: 'a1',
      type: 'full',
      createdAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
      sizeBytes: 40 * 1024 * 1024,
      integrity: 'verified',
      complete: true,
    },
    {
      id: 'a2',
      type: 'full',
      createdAt: new Date(NOW - 26 * 60 * 60 * 1000).toISOString(),
      sizeBytes: 39 * 1024 * 1024,
      integrity: 'verified',
      complete: true,
    },
    {
      id: 'a3',
      type: 'full',
      createdAt: new Date(NOW - 50 * 60 * 60 * 1000).toISOString(),
      sizeBytes: 38 * 1024 * 1020,
      integrity: 'verified',
      complete: true,
    },
  ],
  schedule: { enabled: true, frequency: 'daily', hour: 2, minute: 0, lastRunAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() },
  storageLocations: 3,
  offSiteCopies: 1,
  now: NOW,
  ...over,
});

describe('backup health', () => {
  it('says everything is fine when it is', () => {
    const health = evaluateBackupHealth(facts());
    expect(health.verdict).toBe('ok');
    expect(health.problems).toEqual([]);
    expect(health.lastBackup).toMatchObject({ id: 'a1', ageHours: 2, restorable: true });
    expect(health.restorableCount).toBe(3);
    expect(health.threeTwoOne.satisfied).toBe(true);
  });

  it('calls a stopped schedule what it is, instead of showing a green list', () => {
    // The case that mattered most. The newest archive is six weeks old; every screen
    // previously showed a list of archives and a `lastRunAt` nobody read.
    const health = evaluateBackupHealth(
      facts({
        archives: [
          {
            id: 'old',
            type: 'full',
            createdAt: new Date(NOW - 42 * 24 * 60 * 60 * 1000).toISOString(),
            sizeBytes: 1024,
            integrity: 'verified',
            complete: true,
          },
        ],
      }),
    );

    expect(health.verdict).toBe('unhealthy');
    expect(health.problems.map((problem) => problem.code)).toContain('BACKUP_STALE');
    // The message has to name the age, because "the schedule stopped" is a conclusion
    // the operator will not take from a bare warning.
    expect(health.problems.find((problem) => problem.code === 'BACKUP_STALE')?.message).toMatch(/ساعة/);
  });

  it('separates a corrupt archive from a stale one', () => {
    // Fresh but unreadable is a worse state than old but intact, and the two need
    // different responses: one is a disk, the other is a schedule.
    const health = evaluateBackupHealth(
      facts({
        archives: [
          { id: 'bad', type: 'full', createdAt: new Date(NOW - 60_000).toISOString(), sizeBytes: 10, integrity: 'failed' },
        ],
      }),
    );

    expect(health.verdict).toBe('unhealthy');
    expect(health.problems.map((problem) => problem.code)).toContain('BACKUP_CORRUPT');
    expect(health.problems.map((problem) => problem.code)).not.toContain('BACKUP_STALE');
  });

  it('does not call a verified-but-incomplete archive restorable', () => {
    // Gate 1.6's whole point: intact and unusable is a state the list used to show as
    // a green badge.
    const health = evaluateBackupHealth(
      facts({
        archives: [
          { id: 'partial', type: 'full', createdAt: new Date(NOW - 60_000).toISOString(), sizeBytes: 10, integrity: 'verified', complete: false },
        ],
      }),
    );

    expect(health.verdict).toBe('unhealthy');
    expect(health.problems.map((problem) => problem.code)).toContain('BACKUP_NOT_RESTORABLE');
    expect(health.restorableCount).toBe(0);
    expect(health.archiveCount).toBe(1);
  });

  it('reports no backups as an error, not as an empty list', () => {
    const health = evaluateBackupHealth(facts({ archives: [] }));
    expect(health.verdict).toBe('none');
    expect(health.problems[0].code).toBe('BACKUP_NONE');
    expect(health.summary).not.toBe('');
  });

  it('reports a disabled schedule as a warning, not an error — it is a choice', () => {
    const health = evaluateBackupHealth(
      facts({ schedule: { enabled: false, frequency: 'daily', hour: 2, minute: 0, lastRunAt: null } }),
    );
    expect(health.problems.map((problem) => problem.code)).toContain('BACKUP_SCHEDULE_DISABLED');
    expect(health.problems.find((problem) => problem.code === 'BACKUP_SCHEDULE_DISABLED')?.severity).toBe('warning');
  });

  it('counts 3-2-1 honestly, and says that one folder is one copy', () => {
    // Every archive here sits in one directory on one machine. Reporting the file
    // count as three copies in three places is the false comfort this number exists
    // to remove.
    const health = evaluateBackupHealth(facts({ storageLocations: 1, offSiteCopies: 0 }));

    expect(health.threeTwoOne.satisfied).toBe(false);
    expect(health.threeTwoOne.storageLocations).toBe(1);
    expect(health.threeTwoOne.offSite).toBe(0);
    expect(health.problems.map((problem) => problem.code)).toContain('BACKUP_321');
    expect(health.threeTwoOne.note).toMatch(/مجلد واحد|هذا الجهاز/);
  });

  it('judges age against the schedule it actually has', () => {
    // A weekly schedule that last ran eight days ago is late; a daily one is not. One
    // fixed threshold either misses a stopped weekly schedule or cries wolf every
    // morning.
    const eightDaysAgo = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
    const weekly = { id: 'w', type: 'full', createdAt: eightDaysAgo, sizeBytes: 1, integrity: 'verified', complete: true };

    expect(toleranceHours('weekly')).toBeGreaterThan(8 * 24);
    expect(
      evaluateBackupHealth(facts({ archives: [weekly], schedule: { enabled: true, frequency: 'weekly', hour: 2, minute: 0 } }))
        .problems.map((problem) => problem.code),
    ).not.toContain('BACKUP_STALE');

    expect(
      evaluateBackupHealth(facts({ archives: [weekly], schedule: { enabled: true, frequency: 'daily', hour: 2, minute: 0 } }))
        .problems.map((problem) => problem.code),
    ).toContain('BACKUP_STALE');
  });

  it('never reports a clean verdict while listing an error', () => {
    // The invariant that makes the summary trustworthy: a verdict is a function of the
    // problems, not a second opinion beside them.
    const cases: BackupHealthFacts[] = [
      facts(),
      facts({ archives: [] }),
      facts({ storageLocations: 1, offSiteCopies: 0 }),
      facts({ schedule: { enabled: false, frequency: 'daily', hour: 2, minute: 0 } }),
      facts({ archives: [{ id: 'x', type: 'full', createdAt: new Date(NOW - 1e9).toISOString(), sizeBytes: 1, integrity: 'failed' }] }),
    ];

    for (const input of cases) {
      const health = evaluateBackupHealth(input);
      const hasError = health.problems.some((problem) => problem.severity === 'error');
      if (hasError) {
        expect(['unhealthy', 'none']).toContain(health.verdict);
        expect(health.summary).not.toBe('');
      } else if (health.problems.length) {
        expect(health.verdict).toBe('stale');
      } else {
        expect(health.verdict).toBe('ok');
      }
    }
  });
});

describe('B13 — one source of truth', () => {
  // Resolved from this file rather than from `process.cwd()`: the backend suite runs
  // with `backend/` as its working directory, so a repo-root path read the whole
  // source tree as if it were missing. A path that is only correct under one runner
  // is a test that quietly stops testing.
  const repoRoot = resolve(__dirname, '../../..');
  const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

  it('the reset screen, the panel and App all read the same source', () => {
    // Three consumers answering the same question independently is how they drift,
    // and the drift is invisible: there is no failure when they disagree, only a
    // product that tells the operator two things about the same archive.
    const state = read('backend/src/backup/backup-state.service.ts');
    const controller = read('backend/src/backup/backup.controller.ts');
    const monitoring = read('backend/src/monitoring/monitoring.service.ts');
    const panel = read('frontend/src/components/BackupCenter.tsx');
    const app = read('frontend/src/App.tsx');
    const client = read('frontend/src/services/backupCenterApi.ts');

    assertIncludes(state, 'evaluateBackupHealth', 'the service must delegate the decision to the pure rules');
    assertIncludes(controller, "Get('backup/health')", 'there must be one endpoint that answers it');
    assertIncludes(client, 'fetchBackupHealth', 'the client must reach that one endpoint');

    // The reset screen: it used to read the manifest and infer health from one field.
    assertIncludes(monitoring, 'this.backupState.getHealth()', 'the reset screen must read the shared answer');
    assertNotIncludes(
      monitoring,
      'this.backupService.listBackups().catch',
      'the reset screen must not derive health from the manifest itself — that is how the two drifted',
    );

    assertIncludes(panel, 'fetchBackupHealth', 'the panel reads the same endpoint');
    assertIncludes(app, 'fetchBackupHealth', 'App reads the same endpoint');
  });

  it('a health read that fails is reported as unknown, never as healthy', () => {
    // The whole difference this endpoint makes. A panel that falls back to "fine"
    // when it cannot ask is precisely the failure being replaced.
    const state = read('backend/src/backup/backup-state.service.ts');
    assertIncludes(state, 'BACKUP_HEALTH_UNREADABLE');
    assertIncludes(state, 'fallbackHealth', 'a failed read must have an answer, and it must not be ok');

    const panel = read('frontend/src/components/BackupCenter.tsx');
    assertIncludes(panel, 'healthUnknown', 'the panel must distinguish unknown from healthy');
  });
});

function assertIncludes(source: string, needle: string, why: string) {
  expect(source.includes(needle), `${why} — expected to find "${needle}"`).toBe(true);
}

function assertNotIncludes(source: string, needle: string, why: string) {
  expect(source.includes(needle), `${why} — found "${needle}"`).toBe(false);
}
