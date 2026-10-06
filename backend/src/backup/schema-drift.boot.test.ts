import { describe, expect, it } from 'vitest';
import { evaluateSchemaDrift, type DriftArchive } from './schema-drift';

/**
 * B14 — finding out the backups cannot be restored, at boot, rather than at restore time.
 *
 * ## The sequence this removes
 *
 * Ship a migration. The scheduler keeps running for a week. Then somebody needs a
 * restore, discovers the archive predates the migration, and finds there is no time to
 * take another one. The check existed the whole time — it was simply attached to the
 * only moment at which the answer is too late to be useful.
 *
 * ## The thing this must not become
 *
 * A boot check that refuses to start. If the archives cannot be restored against this
 * image, this image is precisely what is needed to produce ones that can be; blocking
 * here would leave a down server and the same stale backups. Reporting only.
 */

const EXPECTED = ['001_init', '002_items', '003_units'];

/** The default archive is *current*: only a test that means to drift says so. */
const archive = (over: Partial<DriftArchive> = {}): DriftArchive => ({
  id: 'a1',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'full',
  migrations: [...EXPECTED],
  ...over,
});

const expected = EXPECTED;

describe('B14 — the newest archive is the one that matters', () => {
  it('reports no drift when the newest archive covers every migration', () => {
    const report = evaluateSchemaDrift({ archives: [archive()], expected });
    expect(report.newestBlocked).toBe(false);
    expect(report.severity).toBe('ok');
    expect(report.judged).toBe(1);
    expect(report.drifting).toBe(0);
  });

  it('raises an error when the newest archive is behind the image', () => {
    const report = evaluateSchemaDrift({ archives: [archive()], expected });
    expect(report.newestBlocked).toBe(false);

    const behind = evaluateSchemaDrift({
      archives: [archive({ migrations: ['001_init'] })],
      expected,
    });
    expect(behind.newestBlocked).toBe(true);
    expect(behind.severity).toBe('error');
    expect(behind.newest?.missing).toEqual(['002_items', '003_units']);
  });

  it('picks the newest by timestamp, not by position in the list', () => {
    // The manifest is not ordered by time in a way a caller may rely on, and reading the
    // wrong one produces the wrong severity: an old archive being restorable says
    // nothing about the new one.
    const report = evaluateSchemaDrift({
      archives: [
        archive({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z', migrations: ['001_init'] }),
        archive({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' }),
      ],
      expected,
    });
    expect(report.newest?.id).toBe('new');
    expect(report.newestBlocked).toBe(false);
    // The old one is still counted as drifting, and that is surfaced as a warning — it
    // is true and worth knowing, it just does not imply the reachable archive is at risk.
    expect(report.drifting).toBe(1);
    expect(report.severity).toBe('warning');
    expect(report.newestBlocked).toBe(false);
  });

  it('escalates when the newest is behind, however many older ones are fine', () => {
    const report = evaluateSchemaDrift({
      archives: [
        archive({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z', migrations: ['001_init'] }),
        archive({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
      expected,
    });
    expect(report.newest?.id).toBe('new');
    expect(report.newestBlocked).toBe(true);
    expect(report.severity).toBe('error');
  });
});

describe('B14 — an archive with no migration list is unknown, not safe', () => {
  it('is counted separately and never reported as a pass', () => {
    // Every archive written before the field existed looks like this. Treating absence
    // as absence of drift is how a report earns a clean bill of health it has not got.
    const report = evaluateSchemaDrift({ archives: [archive({ migrations: null })], expected });
    expect(report.unknown).toBe(1);
    expect(report.judged).toBe(0);
    expect(report.severity).toBe('warning');
    expect(report.message).toContain('غير مؤكدة');
  });

  it('does not claim the newest archive is fine when the newest is undecidable', () => {
    // `newestBlocked` speaks only about what was judged. With nothing judged, it must
    // not answer "false" in a way a caller could read as "restorable".
    const report = evaluateSchemaDrift({ archives: [archive({ migrations: null })], expected });
    expect(report.newest).toBeNull();
    expect(report.severity).toBe('warning');
  });

  it('still judges the ones it can when others are unknown', () => {
    const report = evaluateSchemaDrift({
      archives: [
        archive({ migrations: null }),
        archive({ id: 'known', createdAt: '2026-02-01T00:00:00.000Z', migrations: ['001_init'] }),
      ],
      expected,
    });
    expect(report.unknown).toBe(1);
    expect(report.judged).toBe(1);
    expect(report.newest?.id).toBe('known');
    // The newest *judged* one is behind, so the error is still raised.
    expect(report.severity).toBe('error');
  });
});

describe('B14 — it reports, it does not refuse', () => {
  it('returns a verdict rather than throwing, whatever the drift', () => {
    for (const migrations of [null, [], ['001_init']]) {
      const report = evaluateSchemaDrift({ archives: [archive({ migrations })], expected });
      expect(report).toBeTruthy();
      expect(['ok', 'warning', 'error']).toContain(report.severity);
      expect(report.message.length).toBeGreaterThan(0);
    }
  });

  it('does not treat an image with no migrations as evidence of anything', () => {
    // A stripped image cannot read its own migrations directory. That is not permission
    // to declare every archive healthy, and it is not grounds to refuse — it is a reason
    // to say the comparison could not be made.
    const report = evaluateSchemaDrift({ archives: [archive()], expected: [] });
    expect(report.severity).not.toBe('error');
    expect(report.newestBlocked).toBe(false);
  });

  it('survives having no archives at all', () => {
    const report = evaluateSchemaDrift({ archives: [], expected });
    expect(report.judged).toBe(0);
    expect(report.newest).toBeNull();
    expect(report.newestBlocked).toBe(false);
    expect(report.message.length).toBeGreaterThan(0);
  });

  it('names the migrations that are missing, so the report is actionable', () => {
    const report = evaluateSchemaDrift({
      archives: [archive({ migrations: ['001_init'] })],
      expected,
    });
    expect(report.newest?.missing).toEqual(['002_items', '003_units']);
    expect(report.message).toContain('003_units');
  });
});