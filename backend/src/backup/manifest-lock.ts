/**
 * B17 — the manifest lock has to outlive the process.
 *
 * ## What the in-memory chain could not do
 *
 * `manifestChain` is a promise per `BackupService` instance, so it serialises correctly
 * inside one process and is invisible to every other one. Two arrangements defeat it,
 * and neither is exotic:
 *
 * - **Two replicas behind a load balancer.** Both run the scheduler. Both write the
 *   manifest. `readManifest ? splice ? writeManifest` in one replica erases a row the
 *   other just added, and the `.ffbkp` it described survives as an orphan — the exact
 *   failure the chain was added to fix, now arriving from a direction the chain cannot see.
 * - **A restart mid-operation.** The chain is a promise, so it dies with the process. A
 *   container replaced during a long `pg_dump` loses the in-memory ordering entirely.
 *
 * ## Why it was switched off, and why that was right
 *
 * The first version used `pg_advisory_lock`, which is **session**-scoped. Prisma hands
 * connections out from a pool, so the statement that took the lock and the one that
 * released it were not guaranteed to run on the same connection. When they did not, the
 * unlock was a no-op on the wrong session and the lock stayed held on the original
 * connection for as long as it lived.
 *
 * The symptom was worse than the problem it was meant to fix: after enough backups, every
 * delete, retention pass and import waited the full timeout behind a leaked lock and the
 * module appeared to hang. So it was left disabled with the reason recorded — an
 * unexplained hang in the backup system is worse than a documented race in a
 * single-process deployment.
 *
 * ## What replaced it
 *
 * `pg_try_advisory_xact_lock` **inside an interactive transaction**. Transaction-scoped,
 * so Postgres releases it on commit, on rollback, on timeout, and on connection loss —
 * there is no path by which a lock can outlive the work it guards, because the database
 * ties the two together. That is the property the session-scoped version lacked, and it
 * is why this one can be enabled.
 *
 * ## The cost, stated
 *
 * The transaction is open while the guarded work runs. That work is manifest read,
 * mutation, retention and file rename — not the database dump, which happens before the
 * lock is taken. So the window is short and holds no locks of its own. An idle-in-
 * transaction timeout would still be a concern on a slow filesystem; `LOCK_WAIT_MS` is
 * therefore also the ceiling on how long the transaction may live.
 */

/** Arbitrary but fixed, so every participant contends for the same lock. */
export const MANIFEST_LOCK_KEY = 8_271_644_001;

/** Ceiling on the whole transaction, so a stuck peer cannot pin it open. */
export const LOCK_WAIT_MS = 30_000;

export type LockMode = 'database' | 'in-memory-only';

export type AdvisoryLockOutcome = {
  mode: LockMode;
  /** Why the database lock was not used, when it was not. */
  degradedReason?: string;
};

/**
 * The minimum client surface this needs, so the caller is not tied to the Prisma type and
 * the tests do not need a live database.
 */
export type TransactionCapable = {
  $transaction?: <T>(
    fn: (tx: {
      $queryRawUnsafe?: (sql: string, ...values: unknown[]) => Promise<unknown[]>;
    }) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ) => Promise<T>;
};

/** Raised internally when the transaction-scoped lock could not be taken in time. */
class LockBusyError extends Error {
  constructor() {
    super('advisory lock busy');
    this.name = 'LockBusyError';
  }
}

const isTransactionCapable = (client: unknown): client is Required<TransactionCapable> =>
  Boolean(client) && typeof (client as TransactionCapable).$transaction === 'function';

/**
 * Take the transaction-scoped database lock, run `fn`, and let the commit release it.
 *
 * Never throws for lock-related reasons: a refusal to obtain the lock is a downgrade to
 * `in-memory-only`, not an error. Anything `fn` throws still propagates — the rollback
 * releases the lock on the way out.
 *
 * `fn` runs **exactly once**. That is not a detail: the first version wrapped both the
 * acquisition and the body in one `try`, so a failed delete was re-run as part of
 * "degrading", and a failed create produced two archives.
 */
export async function withManifestAdvisoryLock<T>(
  prisma: unknown,
  fn: () => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<{ result: T; outcome: AdvisoryLockOutcome }> {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;

  if (!isTransactionCapable(prisma)) {
    return {
      result: await fn(),
      outcome: {
        mode: 'in-memory-only',
        degradedReason: 'عميل قاعدة البيانات لا يدعم المعاملات التفاعلية.',
      },
    };
  }

  // Whether the guarded work itself failed. Tracked separately because the two failures
  // must be handled oppositely: a busy lock means "proceed anyway", a failed operation
  // means "report it".
  //
  // Without this, one `catch` around the whole transaction re-ran the body as the degraded
  // path — so a delete that failed was attempted twice, and a backup that failed was taken
  // twice, while the outcome said it had degraded politely. It was reintroduced here once
  // already, in the first transaction-scoped draft.
  let bodyError: unknown = null;
  let bodyFailed = false;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const rows = (await tx.$queryRawUnsafe?.(
          'SELECT pg_try_advisory_xact_lock($1) AS locked',
          MANIFEST_LOCK_KEY,
        )) as Array<{ locked: boolean }> | undefined;

        if (!rows?.[0]?.locked) {
          // Throwing rolls the transaction back, which releases the lock for whoever is
          // holding it. No retry loop, no leak, and the timeout is ours to report.
          throw new LockBusyError();
        }

        // Transaction-scoped: the commit below releases it, and so does a rollback, a
        // timeout, or the connection dropping. There is no release to forget.
        try {
          return await fn();
        } catch (error) {
          bodyFailed = true;
          bodyError = error;
          throw error;
        }
      },
      { timeout: waitMs, maxWait: Math.min(waitMs, 5_000) },
    );

    return { result, outcome: { mode: 'database' } };
  } catch (error: any) {
    // The operation's own failure is the caller's to handle. Degrading it would mean
    // running it again without the lock, which is both a second attempt and a lost error.
    if (bodyFailed) {
      throw bodyError;
    }

    if (error instanceof LockBusyError || error?.name === 'LockBusyError') {
      return {
        result: await fn(),
        outcome: {
          mode: 'in-memory-only',
          degradedReason:
            `تعذّر الحصول على قفل قاعدة البيانات خلال ${Math.round(waitMs / 1000)} ثانية. `
            + 'قد يكون هناك نسخة أخرى تعمل على نفس المجلد.',
        },
      };
    }

    // The database refused the query entirely (no permission, pool exhausted, shutting
    // down). Same reasoning: the operation continues, downgraded and reported.
    return {
      result: await fn(),
      outcome: {
        mode: 'in-memory-only',
        degradedReason: `فشل القفل: ${error?.code || error?.message || 'غير معروف'}`,
      },
    };
  }
}