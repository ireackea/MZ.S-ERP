import { describe, expect, it } from 'vitest';
import {
  BASE64_COST,
  ENCODED_COST,
  ESTIMATE_MARGIN,
  MIN_FREE_AFTER,
  estimateArchiveBytes,
  judgeHeadroom,
} from './disk-headroom';

const mib = 1024 * 1024;
const gib = 1024 * mib;

describe('B16 — the encoded size of an archive is not the size of the dump', () => {
  it('accounts for base64 twice, and a check that ignores this still fails at ENOSPC', () => {
    // The dump goes into `dbBase64` as base64 (1.33x), then the JSON holding it goes
    // into `payloadBase64` as base64 again (1.33x). Total ≈ 1.78x.
    const databaseBytes = 1 * gib;
    const required = estimateArchiveBytes({ databaseBytes });

    // 1 GiB dump -> ~1.78 GiB encoded, plus 15% margin.
    expect(required).toBe(Math.ceil(databaseBytes * ENCODED_COST * ESTIMATE_MARGIN));
    expect(required).toBeGreaterThan(databaseBytes * 1.7);

    // The trap: a check that compared free space to the dump size alone would approve
    // this write, because 1 GiB free > 1 GiB dump...
    const naiveFree = 1.2 * gib;
    expect(naiveFree > databaseBytes).toBe(true);

    // ...and then the write would have needed more than that. So it fails.
    const verdict = judgeHeadroom({ freeBytes: naiveFree, requiredBytes: required });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('BACKUP_DISK_FULL');
  });

  it('treats two base64 layers as one cost, not two independent ones', () => {
    expect(BASE64_COST).toBeCloseTo(4 / 3, 10);
    expect(ENCODED_COST).toBeCloseTo(16 / 9, 10);
  });
});

describe('B16 — the measurement beats the formula', () => {
  it('trusts the previous archive when it is larger than the computed estimate', () => {
    // Last night's full backup was 2 GiB. A restored-empty database makes the
    // arithmetic say "tiny". The measurement is the better witness.
    const required = estimateArchiveBytes({
      databaseBytes: 1 * mib,
      previousArchiveBytes: 2 * gib,
    });
    expect(required).toBe(Math.ceil(2 * gib * ESTIMATE_MARGIN));
  });

  it('will not let a suspiciously small previous archive shrink the requirement', () => {
    // The other direction: a previousArchiveBytes of 0 must not become the basis.
    const required = estimateArchiveBytes({
      databaseBytes: 100 * mib,
      previousArchiveBytes: 0,
    });
    expect(required).toBeGreaterThan(100 * mib);
  });

  it('never returns a negative or NaN requirement', () => {
    expect(estimateArchiveBytes({})).toBe(0);
    expect(estimateArchiveBytes({ databaseBytes: -500 })).toBe(0);
    expect(estimateArchiveBytes({ databaseBytes: Number.NaN })).toBe(0);
    expect(Number.isFinite(estimateArchiveBytes({}))).toBe(true);
  });
});

describe('B16 — refusing before writing, not after', () => {
  it('refuses a disk that cannot hold the file', () => {
    const verdict = judgeHeadroom({
      freeBytes: 100 * mib,
      requiredBytes: 900 * mib,
      totalBytes: 10 * gib,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('BACKUP_DISK_FULL');
    expect(verdict.projectedFreeBytes).toBeLessThan(0);
  });

  it('refuses a write that fits but leaves the database no room to run', () => {
    // The important one, and it needs exact arithmetic to set up: a 10 GiB volume
    // gives a floor of 3% = ~307 MiB. With 700 MiB free and a 500 MiB archive the
    // write *succeeds* and leaves 200 MiB — which fits, and leaves less than the
    // floor. So it must be refused, and it must be refused with projectedFree still
    // positive, because that is the case a naive `free > required` check waves
    // through.
    const verdict = judgeHeadroom({
      freeBytes: 700 * mib,
      requiredBytes: 500 * mib,
      totalBytes: 10 * gib,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('BACKUP_DISK_LOW');
    expect(verdict.projectedFreeBytes).toBe(200 * mib);
    expect(verdict.projectedFreeBytes).toBeGreaterThan(0);
    // It explains why, in the terms that make it a systems problem rather than an
    // operator's tidiness problem.
    expect(verdict.message).toContain('قاعدة البيانات');
    expect(verdict.message).toMatch(/\d/);
  });

  it('scales the floor with the volume', () => {
    // Small volume: the absolute 256 MiB floor wins, and it is genuinely reachable.
    const small = judgeHeadroom({
      freeBytes: 700 * mib,
      requiredBytes: 500 * mib,
      totalBytes: 2 * gib,
    });
    expect(small.floorBytes).toBe(MIN_FREE_AFTER);

    // Large volume: 3% of 100 GiB is ~3 GiB, which overrides the absolute floor. A
    // fixed 256 MiB would be meaningless on a disk this size.
    const large = judgeHeadroom({
      freeBytes: 4 * gib,
      requiredBytes: 500 * mib,
      totalBytes: 100 * gib,
    });
    expect(large.floorBytes).toBe(Math.ceil(100 * gib * 0.03));
    expect(large.floorBytes).toBeGreaterThan(MIN_FREE_AFTER);
    // 4 GiB free - 500 MiB = ~3.5 GiB projected, against a ~3 GiB floor: allowed,
    // with less to spare than the same numbers on a 10 GiB volume.
    expect(large.ok).toBe(true);
  });

  it('allows a write that fits and leaves room', () => {
    const verdict = judgeHeadroom({
      freeBytes: 4 * gib,
      requiredBytes: 500 * mib,
      totalBytes: 10 * gib,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.code).toBe('OK');
    expect(verdict.projectedFreeBytes).toBe(4 * gib - 500 * mib);
  });

  it('does not refuse when free space cannot be read — that is not grounds', () => {
    // Refusing here would disable backups entirely on a platform that cannot answer
    // statfs, which is the worst possible outcome for this check.
    for (const unknown of [null, undefined, 0, Number.NaN]) {
      const verdict = judgeHeadroom({ freeBytes: unknown as any, requiredBytes: 500 * mib });
      expect(verdict.code).toBe('SPACE_UNKNOWN');
      expect(verdict.ok).toBe(true);
    }
  });

  it('carries the numbers in every refusal, so the message is actionable', () => {
    const verdict = judgeHeadroom({
      freeBytes: 12 * mib,
      requiredBytes: 400 * mib,
      totalBytes: 1 * gib,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/MiB/);
    // And it says nothing was written, because that is the reassurance the operator
    // needs in order not to go and look for a half-file.
    expect(verdict.message).toContain('لم يُكتب أي ملف');
  });
});