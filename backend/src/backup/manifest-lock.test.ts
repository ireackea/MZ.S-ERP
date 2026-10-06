import { describe, expect, it, vi } from 'vitest';
import { LOCK_WAIT_MS, MANIFEST_LOCK_KEY, withManifestAdvisoryLock } from './manifest-lock';

/**
 * B17 — a lock that cannot outlive the work it guards.
 *
 * The previous implementation used `pg_advisory_lock`, which is session-scoped. Prisma
 * pools connections, so the lock and the unlock were not guaranteed to share one: when they
 * did not, the lock stayed held on the original connection and every later operation timed
 * out behind it. That is why the feature shipped disabled.
 *
 * `pg_try_advisory_xact_lock` inside an interactive transaction fixes it structurally —
 * the database releases on commit, rollback, timeout and connection loss — so the question
 * these tests answer is no longer "does it lock" but "can it leak".
 */

/** A Prisma stand-in recording the SQL it was given. */
const client = (impl?: (sql: string, values: unknown[]) => Promise<any[]>) => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const order: string[] = [];
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      calls.push({ sql, values });
      order.push(sql.includes('pg_advisory_unlock') ? 'unlock' : sql.includes('try') ? 'lock' : 'sql');
      return impl ? impl(sql, values) : [{ locked: true }];
    }),
  };
  return {
    calls,
    order,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<any>, options?: any) => {
      order.push('begin');
      const value = await fn(tx);
      order.push('commit');
      (tx as any).options = options;
      return value;
    }),
    tx,
  };
};

describe('the lock is transaction-scoped, so it cannot leak', () => {
  it('takes a transaction lock, never a session one', () => {
    const db = client();
    withManifestAdvisoryLock(db, async () => 'ok');

    // The whole reason this version exists.
    const sql = db.calls.map((call) => call.sql).join(' ');
    expect(sql).toContain('pg_try_advisory_xact_lock');
    expect(sql).not.toContain('pg_advisory_unlock');
    expect(sql).not.toMatch(/pg_advisory_lock\(/);
  });

  it('runs the body inside the transaction and lets the commit release the lock', async () => {
    const db = client();
    const { result, outcome } = await withManifestAdvisoryLock(db, async () => 'deleted');

    expect(result).toBe('deleted');
    expect(outcome.mode).toBe('database');
    expect(db.order).toEqual(['begin', 'lock', 'commit']);
    // No explicit release: the commit is the release.
    expect(db.order).not.toContain('unlock');
  });

  it('uses one fixed key, so every participant contends for the same lock', () => {
    const db = client();
    withManifestAdvisoryLock(db, async () => 'ok');
    expect(db.calls[0].values[0]).toBe(MANIFEST_LOCK_KEY);
  });

  it('bounds the transaction, so a stuck peer cannot pin it open', async () => {
    const db = client();
    await withManifestAdvisoryLock(db, async () => 'ok', { waitMs: 12_000 });
    expect(db.tx.options.timeout).toBe(12_000);
    // A transaction left open forever would hold a connection from the pool forever.
    expect(db.tx.options.maxWait).toBeLessThanOrEqual(12_000);
  });
});

describe('the lock is released whatever happens', () => {
  it('rolls back when the body throws, and the error still reaches the caller', async () => {
    // The error must not be swallowed by the fallback path — that was the double-run bug.
    const db = client();
    let calls = 0;

    await expect(
      withManifestAdvisoryLock(db, async () => {
        calls += 1;
        throw new Error('delete failed');
      }),
    ).rejects.toThrow('delete failed');

    expect(calls, 'the body must run exactly once').toBe(1);
  });
});

describe('degrading is deliberate, and named', () => {
  it('proceeds on the in-memory chain when the lock is held elsewhere', async () => {
    const db = client(async () => [{ locked: false }]);
    const { result, outcome } = await withManifestAdvisoryLock(db, async () => 'imported');

    // Refusing every backup because a peer is busy would make the module useless during
    // exactly the concurrency it exists to manage.
    expect(result).toBe('imported');
    expect(outcome.mode).toBe('in-memory-only');
    expect(outcome.degradedReason).toMatch(/نسخة أخرى|قفل/);
  });

  it('proceeds when the database refuses the query', async () => {
    const db = client(async () => {
      const error: any = new Error('permission denied');
      error.code = '42501';
      throw error;
    });
    const { result, outcome } = await withManifestAdvisoryLock(db, async () => 'ok');
    expect(result).toBe('ok');
    expect(outcome.mode).toBe('in-memory-only');
    expect(outcome.degradedReason).toContain('42501');
  });

  it('proceeds when the client cannot open a transaction at all', async () => {
    // Some test doubles and some Prisma wrappers have no `$transaction`. Refusing to
    // delete a backup there would be absurd.
    for (const absent of [{}, null, undefined]) {
      const { result, outcome } = await withManifestAdvisoryLock(absent, async () => 'ok');
      expect(result).toBe('ok');
      expect(outcome.mode).toBe('in-memory-only');
      expect(outcome.degradedReason).toBeTruthy();
    }
  });

  it('runs the body exactly once when degrading', async () => {
    // The bug this pins: one try around both the acquisition and the body meant a failed
    // operation was re-run as part of "degrading".
    const db = client(async () => [{ locked: false }]);
    let calls = 0;
    await withManifestAdvisoryLock(
      db,
      async () => {
        calls += 1;
        return 'ok';
      },
      { waitMs: 300 },
    );
    expect(calls).toBe(1);
  });
});

describe('a degraded run is never reported as a clean one', () => {
  it('because it has a real race behind it', async () => {
    const clean = await withManifestAdvisoryLock(client(), async () => 'x');
    const degraded = await withManifestAdvisoryLock(
      client(async () => [{ locked: false }]),
      async () => 'x',
      { waitMs: 300 },
    );

    expect(clean.outcome.degradedReason).toBeUndefined();
    expect(degraded.outcome.degradedReason).toBeTruthy();
    expect(LOCK_WAIT_MS).toBeGreaterThan(0);
  });
});