import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { BackupService } from './backup.service';

/**
 * The restore PIN: a gate that must be opened deliberately, not a protection that exists
 * by default.
 *
 * ## The defect
 *
 * `verifyRestorePinOrThrow` refused when the caller sent no PIN, and then refused again
 * when no PIN was configured anywhere. Between those two refusals the meaning was
 * unambiguous and, for a real deployment, fatal:
 *
 * **no restore is possible unless a PIN has been configured.**
 *
 * Default deployments have no PIN. So the feature was unusable by default, and the
 * interface demanded a PIN the operator had never been given — there was nothing to type.
 * Everything that makes a restore safe (the `backup.restore` permission, the admin role,
 * `backup-destructive` rate limiting, the integrity check, the safety snapshot taken
 * before anything is destroyed, and the two-step confirmation) was present, correct, and
 * unreachable.
 *
 * ## The rule now
 *
 * No PIN configured → no PIN demanded, every other gate untouched.
 * PIN configured → PIN mandatory, and B8's lockout applies.
 *
 * Both directions are asserted. A fix that only tested the permissive side would pass
 * while quietly removing the protection.
 *
 * The schedule is passed directly rather than written to disk and read back: this is a
 * decision about a policy, and going through the filesystem would test the reader too.
 */

let service: any;
let previousEnvPin: string | undefined;

const scheduleWith = (over: Record<string, unknown> = {}) => ({
  enabled: false,
  frequency: 'daily',
  hour: 2,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
  retentionDays: 30,
  maxCount: 60,
  minCount: 2,
  maxSafetySnapshots: 3,
  storageTargets: ['local'],
  encryptionEnabled: false,
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  ...over,
});

beforeEach(() => {
  service = new BackupService({} as never, {} as never);
  previousEnvPin = process.env.BACKUP_RESTORE_PIN;
  delete process.env.BACKUP_RESTORE_PIN;
});

afterEach(() => {
  if (previousEnvPin === undefined) delete process.env.BACKUP_RESTORE_PIN;
  else process.env.BACKUP_RESTORE_PIN = previousEnvPin;
});

/** Exactly what the restore path calls. */
const attempt = (schedule: ReturnType<typeof scheduleWith>, pin: string) =>
  service.verifyRestorePinOrThrow(schedule, pin, { type: 'user', mode: 'manual' });

const isConfigured = (schedule: ReturnType<typeof scheduleWith>) =>
  service.restorePinIsConfigured(schedule);

describe('a deployment with no PIN configured can restore', () => {
  it('does not demand one', () => {
    // This used to throw `Restore PIN is required`.
    expect(() => attempt(scheduleWith(), '')).not.toThrow();
  });

  it('does not demand one when a wrong PIN happens to be typed', () => {
    // Nothing is configured, so there is nothing for the value to be wrong *against*.
    // Treating a stray value as a failed attempt would re-create the lockout on a
    // deployment that never asked for a PIN.
    expect(() => attempt(scheduleWith(), 'irrelevant')).not.toThrow();
  });

  it('reports that nothing is protecting it, rather than implying otherwise', () => {
    expect(isConfigured(scheduleWith())).toBe(false);
  });
});

describe('a configured PIN stays mandatory', () => {
  const pinned = () => scheduleWith({ restorePinHash: 'hash', restorePinSaltBase64: 'salt' });

  it('in the schedule: sending nothing is still refused', () => {
    expect(isConfigured(pinned())).toBe(true);
    // The permissive branch must not leak into the configured one.
    expect(() => attempt(pinned(), '')).toThrow(/Restore PIN is required/);
  });

  it('from the environment: sending nothing is still refused', () => {
    process.env.BACKUP_RESTORE_PIN = 'a-real-pin';
    expect(isConfigured(scheduleWith())).toBe(true);
    expect(() => attempt(scheduleWith(), '')).toThrow(/Restore PIN is required/);
  });

  it('from the environment: the right value is accepted and the wrong one is not', () => {
    process.env.BACKUP_RESTORE_PIN = 'a-real-pin';
    expect(() => attempt(scheduleWith(), 'a-real-pin')).not.toThrow();
    expect(() => attempt(scheduleWith(), 'wrong')).toThrow(/Invalid restore PIN/);
  });

  it('treats a whitespace-only environment PIN as not configured', () => {
    // Whitespace is not a PIN. Counting it as one produces the original bug in a new
    // disguise: a "configured" gate whose value is empty, which can never be satisfied.
    process.env.BACKUP_RESTORE_PIN = '   ';
    expect(isConfigured(scheduleWith())).toBe(false);
    expect(() => attempt(scheduleWith(), '')).not.toThrow();
  });

  it('ignores a half-written schedule entry rather than half-enabling the gate', () => {
    // A hash with no salt is not a usable PIN record. Treating it as configured would
    // demand a value that then could not be verified against anything.
    const halfWritten = scheduleWith({ restorePinHash: 'hash' });
    expect(isConfigured(halfWritten)).toBe(false);

    const otherHalf = scheduleWith({ restorePinSaltBase64: 'salt' });
    expect(isConfigured(otherHalf)).toBe(false);
  });
});

describe('the two questions have one source', () => {
  it('configured-check and enforcement cannot disagree', () => {
    // They were two independent `if`s, and the second could reach a branch the first had
    // already decided was impossible. One predicate used by both makes them agree by
    // construction rather than by review.
    expect(isConfigured(scheduleWith())).toBe(false);
    expect(() => attempt(scheduleWith(), '')).not.toThrow();

    const pinned = scheduleWith({ restorePinHash: 'hash', restorePinSaltBase64: 'salt' });
    expect(isConfigured(pinned)).toBe(true);
    expect(() => attempt(pinned, '')).toThrow();
  });
});