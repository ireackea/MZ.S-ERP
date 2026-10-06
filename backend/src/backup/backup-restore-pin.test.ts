import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';

/**
 * B8 — the last check before the whole database is replaced.
 *
 * The PIN was the only thing between a stolen session and `pg_restore --clean`, and
 * it was checked in two ways: a hashed comparison that used `timingSafeEqual`, and
 * a fallback against `BACKUP_RESTORE_PIN` that used `!==` — which returns on the
 * first differing byte, so the time taken says how much of the guess was right. For
 * a four-digit PIN that is four guesses rather than four thousand.
 *
 * Neither path counted a failure. Nothing stopped a caller from keeping at it, and
 * the two actions were counted in the 150-per-quarter-hour bucket chosen for writes
 * that insert rows.
 *
 * The lock is asserted through the real service, against the real schedule file,
 * because what matters is the sequence — fail, fail, fail, locked — and not any one
 * call in isolation.
 */

const scheduleFile = (workspace: string) => path.join(workspace, 'backups', 'schedule.json');

describe('the restore PIN', () => {
  let workspace: string;
  let previousCwd: string;
  let previousPin: string | undefined;
  let service: BackupService;

  const verify = (pin: string, actor: Record<string, unknown> = { userId: 'u1', username: 'admin' }) =>
    (
      service as never as {
        verifyRestorePinOrThrow: (s: unknown, p: string, a?: unknown) => void;
      }
    ).verifyRestorePinOrThrow({ retentionDays: 30 } as never, pin, actor);

  beforeEach(async () => {
    previousCwd = process.cwd();
    previousPin = process.env.BACKUP_RESTORE_PIN;
    workspace = mkdtempSync(path.join(tmpdir(), 'backup-pin-'));
    mkdirSync(path.join(workspace, 'backups'), { recursive: true });
    process.chdir(workspace);
    service = new BackupService({} as never, {} as never);
    // The constructor bootstraps the workspace without awaiting it. Awaiting the same
    // idempotent call here makes the fixture deterministic instead of racing a timer.
    await (service as never as { ensureWorkspace: () => Promise<void> }).ensureWorkspace();
  });

  afterEach(async () => {
    service.onModuleDestroy();
    process.chdir(previousCwd);
    rmSync(workspace, { recursive: true, force: true });
    if (previousPin === undefined) delete process.env.BACKUP_RESTORE_PIN;
    else process.env.BACKUP_RESTORE_PIN = previousPin;
  });

  describe('when the PIN comes from the environment', () => {
    beforeEach(async () => {
      process.env.BACKUP_RESTORE_PIN = '4821';
      writeFileSync(scheduleFile(workspace), JSON.stringify({ retentionDays: 30 }), 'utf8');
    });

    it('accepts the right PIN', () => {
      expect(() => verify('4821')).not.toThrow();
    });

    it('rejects a wrong PIN of the same length', () => {
      expect(() => verify('4822')).toThrow(/Invalid restore PIN/);
    });

    it('rejects a wrong PIN of a different length, in constant time', () => {
      // The old comparison was `fallback !== pin`, which returns as soon as the
      // strings differ — so a one-character guess and a four-character guess took
      // measurably different times, and the length of the secret leaked before its
      // content did. Both sides are hashed to a fixed width now, so the comparison
      // depends on neither the length nor the position of the first difference.
      expect(() => verify('4')).toThrow(/Invalid restore PIN/);
      expect(() => verify('48211')).toThrow(/Invalid restore PIN/);
      expect(() => verify('00000000')).toThrow(/Invalid restore PIN/);
    });

    it('compares in constant time, so the code does not fall back to a length check', () => {
      const source = readFileSync(
        path.join(__dirname, 'backup.service.ts'),
        'utf8',
      );
      const method = source.slice(source.indexOf('private secretsMatch'));
      // A `left.length !== right.length` guard in front of `timingSafeEqual` is the
      // usual fix and reintroduces exactly the leak it was meant to close: the
      // length of the secret is the first thing an attacker learns.
      expect(method.slice(0, 600)).not.toMatch(/length\s*!==/);
      expect(method).toMatch(/createHash\('sha256'\)/);
      expect(method).toMatch(/timingSafeEqual/);
    });
  });

  describe('the escalating lock', () => {
    beforeEach(async () => {
      process.env.BACKUP_RESTORE_PIN = '4821';
      writeFileSync(scheduleFile(workspace), JSON.stringify({ retentionDays: 30 }), 'utf8');
    });

    it('lets a mistake or two through, because an operator will mistype', () => {
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      expect(() => verify('4821')).not.toThrow();
    });

    it('locks after three failures in a row, and says nothing about the PIN', () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      }

      // The fourth attempt is refused before the PIN is even examined — which is the
      // property that matters. A locked caller must not be able to use the response
      // to keep learning.
      let thrown: any = null;
      try {
        verify('0000');
      } catch (error) {
        thrown = error;
      }
      expect(thrown?.getStatus?.()).toBe(429);
      expect(String(thrown?.response?.message || '')).not.toMatch(/Invalid restore PIN/);
      expect(String(thrown?.response?.message || '')).toMatch(/قفل/);
    });

    it('refuses the correct PIN while locked, because the lock is the answer', () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      }
      // A lock that a correct guess could talk its way through is not a lock. The
      // operator waits; that is the cost of three wrong tries.
      expect(() => verify('4821')).toThrow(/قفل/);
    });

    it('counts each caller separately, so one account cannot lock another out', () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(() => verify('0000', { userId: 'attacker' })).toThrow(/Invalid restore PIN/);
      }
      expect(() => verify('0000', { userId: 'attacker' })).toThrow(/قفل/);
      expect(() => verify('4821', { userId: 'someone-else' })).not.toThrow();
    });

    it('clears the count on success, so the next mistake starts from zero', () => {
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      expect(() => verify('4821')).not.toThrow();
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      expect(() => verify('0000')).toThrow(/Invalid restore PIN/);
      // Two failures after a success, and the correct PIN still works. Had the count
      // not been reset, these two would be the third and fourth and the account
      // would be locked — a careful operator who mistypes every few days would
      // eventually lock themselves out permanently.
      expect(() => verify('4821')).not.toThrow();
    });

    it('doubles the penalty for each further failure, up to a ceiling', () => {
      const state = (service as never as { pinFailures: Map<string, { count: number; lockedUntil: number }> })
        .pinFailures;

      // Each attempt has to wait out the lock before the PIN is examined again —
      // that wait is the whole mechanism, so the escalation is measured across it.
      // Counting attempts made *while* locked would grow the penalty for a confused
      // operator who cannot get it right, which is the opposite of the intent.
      const lockAfter = (failures: number) => {
        state.clear();
        for (let attempt = 0; attempt < failures; attempt += 1) {
          const held = state.get('u1');
          if (held) held.lockedUntil = Date.now() - 1;
          try {
            verify('0000');
          } catch {
            /* counted, or refused while locked */
          }
        }
        return (state.get('u1')?.lockedUntil ?? 0) - Date.now();
      };

      const third = lockAfter(3);
      const fourth = lockAfter(4);
      const fifth = lockAfter(5);

      expect(third, 'the third failure starts the wait').toBeGreaterThan(0);
      // Exponential, so a guesser runs out of patience long before they run out of
      // attempts. A flat fifteen minutes is fifteen minutes per guess, forever.
      expect(fourth).toBeGreaterThan(third);
      expect(fifth).toBeGreaterThan(fourth);
      // And capped, so the lock cannot become permanent by arithmetic alone.
      expect(lockAfter(40)).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    });

    it('releases the lock when it expires, rather than requiring an operator to clear it', () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          verify('0000');
        } catch {
          /* counted */
        }
      }
      const state = (service as never as { pinFailures: Map<string, { lockedUntil: number }> }).pinFailures;
      state.set('u1', { count: 4, lockedUntil: Date.now() - 1 });

      expect(() => verify('4821')).not.toThrow();
    });
  });
});
