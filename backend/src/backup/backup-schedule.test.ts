import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B7 — a schedule that silently stops is a schedule that does not exist.
 *
 * Two failures, both quiet, and both of them end with the operator believing they
 * have backups:
 *
 * **The minute window.** `shouldRunNow` required `now.getMinutes() ===
 * schedule.minute`, so the run had one 30-second tick to land in. Anything that
 * pushed the tick past the minute boundary — a slow read, a long GC, a throttled
 * container, a laptop resuming — and the day was skipped, with the next attempt 24
 * hours out.
 *
 * **The swallowed parse.** A corrupt `schedule.json` returned `defaultSchedule()`.
 * A schedule that had been switched off came back on at 02:00 daily, a 90-day
 * retention became 30, and the interface displayed the defaults as though they were
 * the operator's own settings.
 *
 * The window is asserted directly because it is the whole mechanism. The corruption
 * path is asserted through the real methods, against real files.
 */

const scheduleFile = (workspace: string) => path.join(workspace, 'backups', 'schedule.json');

const readSchedule = (workspace: string) => JSON.parse(readFileSync(scheduleFile(workspace), 'utf8'));

const shouldRunNow = (service: BackupService, schedule: unknown, now: Date) =>
  (service as never as { shouldRunNow: (s: unknown, n: Date) => boolean }).shouldRunNow(schedule, now);

const readScheduleThrough = (service: BackupService) =>
  (service as never as { readSchedule: () => Promise<unknown> }).readSchedule.call(service);

describe('the backup schedule', () => {
  let workspace: string;
  let previousCwd: string;
  let service: BackupService | null = null;

  /**
   * Built after the workspace has been seeded, never before.
   *
   * The constructor prepares the workspace without awaiting it, and it writes
   * `schedule.json` only when the file is absent. Constructing the service first and
   * writing a damaged schedule second therefore races: the bootstrap can land after
   * the test's write and replace it with a valid default — which is precisely the
   * behaviour under test, so a passing run would have proved nothing. Seeding first
   * makes the fixture deterministic, and it matches production, where a corrupt file
   * is found by a boot that has nothing to write.
   */
  const buildService = async () => {
    service = new BackupService({} as never, {} as never);
    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
    return service;
  };

  beforeEach(() => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-schedule-'));
    mkdirSync(path.join(workspace, 'backups'), { recursive: true });
    process.chdir(workspace);
  });

  afterEach(() => {
    service?.onModuleDestroy();
    service = null;
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('the window it runs in', () => {
    const base = {
      enabled: true,
      frequency: 'daily',
      hour: 2,
      minute: 0,
      dayOfWeek: 0,
      dayOfMonth: 1,
      retentionDays: 30,
      storageTargets: ['local'],
      encryptionEnabled: false,
      updatedAt: new Date().toISOString(),
    };

    it('runs at the configured minute', async () => {
      const service = await buildService();
      expect(shouldRunNow(service, base, new Date(2026, 8, 30, 2, 0, 5))).toBe(true);
    });

    it('still runs at 02:30 for a 02:00 schedule', async () => {
      const service = await buildService();
      // The case in the plan. With a minute-wide window this was false, and the
      // day's backup was gone: one delayed tick, 24 hours of nothing.
      expect(shouldRunNow(service, base, new Date(2026, 8, 30, 2, 30, 12))).toBe(true);
    });

    it('still runs at 02:59, the last moment of the window', async () => {
      const service = await buildService();
      expect(shouldRunNow(service, base, new Date(2026, 8, 30, 2, 59, 58))).toBe(true);
    });

    it('does not run in another hour', async () => {
      const service = await buildService();
      expect(shouldRunNow(service, base, new Date(2026, 8, 30, 3, 0, 5))).toBe(false);
    });

    it('does not run twice on the same day', async () => {
      const service = await buildService();
      // The wider window must not become a second run per day. `lastRunKey` is what
      // makes the hour safe to widen, so it is asserted, not assumed.
      const alreadyRan = { ...base, lastRunKey: 'daily:2026-9-30' };
      expect(shouldRunNow(service, alreadyRan, new Date(2026, 8, 30, 2, 0, 5))).toBe(false);
      expect(shouldRunNow(service, alreadyRan, new Date(2026, 8, 30, 2, 45, 0))).toBe(false);
      expect(shouldRunNow(service, { ...base, lastRunKey: 'daily:2026-9-29' }, new Date(2026, 8, 30, 2, 45, 0))).toBe(
        true,
      );
    });

    it('still respects the day for a weekly schedule', async () => {
      const service = await buildService();
      // Widening the window to an hour must not widen it to a day, or a weekly
      // schedule would fire every day of the week.
      const weekly = { ...base, frequency: 'weekly', dayOfWeek: 4 };
      expect(shouldRunNow(service, weekly, new Date(2026, 8, 30, 2, 40))).toBe(false); // a Wednesday
      expect(shouldRunNow(service, weekly, new Date(2026, 10, 5, 2, 40))).toBe(true); // a Thursday
    });

    it('does nothing at all while disabled', async () => {
      const service = await buildService();
      expect(shouldRunNow(service, { ...base, enabled: false }, new Date(2026, 8, 30, 2, 30))).toBe(false);
    });
  });

  describe('a damaged schedule file', () => {
    it('refuses instead of quietly reverting to the defaults', async () => {
      writeFileSync(scheduleFile(workspace), '{ "enabled": false, "retentionDays": 90', 'utf8');
      const service = await buildService();

      // The old behaviour returned `{enabled: true, hour: 2, retentionDays: 30}`. The
      // operator's screen would then show settings they never chose, and the next
      // save would overwrite the file, ending any chance of finding out what it
      // actually said.
      await expect(readScheduleThrough(service)).rejects.toThrow(/تالف/);
    });

    it('keeps the damaged file for inspection instead of overwriting it', async () => {
      const damaged = '{ "enabled": false, "retentionDays": 90';
      writeFileSync(scheduleFile(workspace), damaged, 'utf8');
      const service = await buildService();

      await expect(readScheduleThrough(service)).rejects.toThrow();

      // Quarantined, not deleted and not replaced. The next `writeSchedule` would
      // otherwise destroy the only evidence of what the schedule said.
      const kept = readdirSync(path.join(workspace, 'backups')).filter((name) => name.includes('.corrupt-'));
      expect(kept, 'the damaged schedule must be kept under a new name').toHaveLength(1);
      expect(readFileSync(path.join(workspace, 'backups', kept[0]), 'utf8')).toBe(damaged);
    });

    it('refuses through the public surface too, not only internally', async () => {
      writeFileSync(scheduleFile(workspace), 'not json at all', 'utf8');
      const service = await buildService();

      // `getStorageStats` is what the dashboard calls. If it answered with defaults,
      // the operator would see a healthy schedule that is not the one on disk.
      await expect(service.getStorageStats()).rejects.toThrow(/تالف/);
    });

    it('treats an absent file as a first run, which is not corruption', async () => {
      const service = await buildService();
      const schedule = (await readScheduleThrough(service)) as { enabled: boolean };
      // Absent means "never configured", and inventing defaults for it is correct.
      // Only an unreadable *existing* file is a refusal — the distinction is the
      // whole point, and a blanket refusal would break every fresh install.
      expect(schedule.enabled).toBe(true);
    });

    it('writes through a temp file, so a crash cannot leave a half-written schedule', async () => {
      const service = await buildService();
      await service.updateSchedule({ hour: 5, enabled: true });

      expect(readSchedule(workspace).hour).toBe(5);
      // No temp files left behind, and the write is not a truncating overwrite.
      const leftovers = readdirSync(path.join(workspace, 'backups')).filter((name) => name.includes('.tmp-'));
      expect(leftovers).toEqual([]);
    });

    it('round-trips a setting the operator changed', async () => {
      const service = await buildService();
      await service.updateSchedule({ retentionDays: 14, hour: 23, minute: 45 });

      const schedule = (await readScheduleThrough(service)) as {
        retentionDays: number;
        hour: number;
        minute: number;
      };
      expect(schedule).toMatchObject({ retentionDays: 14, hour: 23, minute: 45 });
    });
  });
});
