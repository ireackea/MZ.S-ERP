import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { executeIdempotently } from './idempotency';

/**
 * A serialization failure is *defined* to be retried, so retrying it is the whole
 * contract. The importer has raw statements, and a raw statement reports the
 * condition through a different door than the ORM does — which is exactly how the
 * retry ended up not firing for the one caller that most needed it.
 *
 * These tests build a Prisma stand-in that fails in each of the ways the condition
 * can arrive, because the bug was never in the retry *loop*: it was in the set of
 * codes the loop recognised.
 */

type FakeOptions = {
  failWith: (error: unknown) => void;
  /** Errors to throw before succeeding, one per attempt. */
  failures: unknown[];
};

const makePrisma = (options: FakeOptions) => {
  const seen: string[] = [];
  const stored = new Map<string, unknown>();
  let attempt = 0;

  const prisma = {
    idempotencyRecord: {
      create: async ({ data }: any) => {
        const key = `${data.actorId}|${data.operation}|${data.key}`;
        if (seen.includes(key)) {
          // A second request with the same key trips the unique index, which is how a
          // genuine duplicate arrives as a P2002.
          const error: any = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        seen.push(key);
        return { id: `rec-${seen.length}`, ...data };
      },
      findUnique: async ({ where }: any) => {
        const key = `${where.actorId_operation_key.actorId}|${where.actorId_operation_key.operation}|${where.actorId_operation_key.key}`;
        return stored.get(key) ?? null;
      },
      update: async ({ where, data }: any) => {
        // The response is stored under the triple, which is what `findUnique` reaches
        // by — that is how a retry replays the first outcome rather than redoing it.
        const index = seen.findIndex((entry) => entry.endsWith(`|${where.id}`));
        if (index >= 0) stored.set(seen[index], { response: data.response });
        return { id: where.id, ...data };
      },
    },
    /**
     * The transaction boundary. A failure has to be thrown from *here*, before the
     * callback runs, because that is what an aborted transaction looks like: the work
     * never happened. Throwing from a helper the callback merely called would let the
     * work complete and then fail, which is a different bug entirely — and the test
     * would pass while proving nothing.
     */
    $transaction: async (fn: any) => {
      const next = options.failures[attempt];
      attempt += 1;
      if (next) {
        // A fresh key per attempt, so the retry is not mistaken for a duplicate
        // request and short-circuited by the P2002 path above.
        seen.length = 0;
        stored.clear();
        throw next;
      }
      return fn({ idempotencyRecord: prisma.idempotencyRecord });
    },
  };

  return { prisma: prisma as never, attempts: () => attempt };
};

const serializationError = () => {
  // What a raw statement actually throws: P2010, with SQLSTATE in the message.
  const error: any = new Error(
    'Raw query failed. Code: `40001`. Message: `could not serialize access due to read/write dependencies among transactions`',
  );
  error.code = 'P2010';
  return error;
};

const optimisticConcurrencyError = () => {
  const error: any = new Error('Transaction failed due to a write conflict');
  error.code = 'P2034';
  return error;
};

describe('executeIdempotently — serialization failures are retried', () => {
  it('retries a raw-statement 40001 and then succeeds', async () => {
    // This is the exact error the concurrent-import test produced. Before, it escaped
    // the retry entirely: nothing was corrupted — the transaction rolled back — but the
    // caller got a 500 for a condition whose only correct answer is "again".
    const { prisma, attempts } = makePrisma({
      failWith: () => {},
      failures: [serializationError()],
    });

    const result = await executeIdempotently(prisma, 'u1', 'items.import', 'key-aaa-111', { a: 1 }, async () => ({ ok: true }));

    expect(result.value).toEqual({ ok: true });
    expect(result.replayed).toBe(false);
    expect(attempts(), 'a serialization failure must be retried, not surfaced').toBe(2);
  }, 20_000);

  it('retries a second time before giving up', async () => {
    const { prisma, attempts } = makePrisma({
      failWith: () => {},
      failures: [serializationError(), serializationError()],
    });

    const result = await executeIdempotently(prisma, 'u1', 'items.import', 'key-aaa-222', { a: 1 }, async () => ({ ok: 1 }));
    expect(result.value).toEqual({ ok: 1 });
    expect(attempts()).toBe(3);
  }, 20_000);

  it('still retries the ORM-level P2034 it always handled', async () => {
    // Both doors, so neither regresses into "the other one covers it".
    const { prisma, attempts } = makePrisma({
      failWith: () => {},
      failures: [optimisticConcurrencyError()],
    });
    const result = await executeIdempotently(prisma, 'u1', 'items.import', 'key-aaa-333', { a: 1 }, async () => ({ ok: 2 }));
    expect(result.value).toEqual({ ok: 2 });
    expect(attempts()).toBe(2);
  }, 20_000);

  it('gives up after three attempts with a conflict, not a 500', async () => {
    const { prisma, attempts } = makePrisma({
      failWith: () => {},
      failures: [serializationError(), serializationError(), serializationError()],
    });

    await expect(
      executeIdempotently(prisma, 'u1', 'items.import', 'key-aaa-444', { a: 1 }, async () => ({ ok: 3 })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(attempts(), 'three attempts, then stop').toBe(3);
  }, 20_000);

  it('does not retry a P2010 that is not a serialization failure', async () => {
    // P2010 is Prisma's "raw query failed", full stop. Retrying every raw failure would
    // turn a genuine SQL bug into three slow identical failures, and hide it.
    const { prisma, attempts } = makePrisma({
      failWith: () => {},
      failures: [Object.assign(new Error('syntax error at or near "FRO"'), { code: 'P2010' })],
    });

    await expect(
      executeIdempotently(prisma, 'u1', 'items.import', 'key-aaa-555', { a: 1 }, async () => ({ ok: 4 })),
    ).rejects.toThrow(/FRO/);
    expect(attempts(), 'a non-serialization raw failure must not be retried').toBe(1);
  }, 20_000);
});
