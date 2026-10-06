import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
};

const normalizeKey = (value: string | undefined): string => {
  const key = String(value || '').trim();
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new BadRequestException('Idempotency-Key must be 8-200 safe characters');
  }
  return key;
};

export async function executeIdempotently<T>(
  prisma: PrismaService,
  actorId: string,
  operation: string,
  idempotencyKey: string | undefined,
  payload: unknown,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  /**
   * FC-AUD-001 — audit writes registered here run inside the SAME transaction
   * as the business change, so a committed mutation always carries its audit
   * row and a rolled-back one leaves none. Omit only for read-side work.
   */
  audit?: (tx: Prisma.TransactionClient, result: T) => Promise<void>,
): Promise<{ value: T; replayed: boolean }> {
  const key = normalizeKey(idempotencyKey);
  const requestHash = createHash('sha256').update(stableSerialize(payload)).digest('hex');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const value = await prisma.$transaction(async (tx) => {
        const record = await tx.idempotencyRecord.create({
          data: {
            actorId,
            operation,
            key,
            requestHash,
            response: {} as Prisma.InputJsonValue,
          },
        });
        const result = await work(tx);
        if (audit) {
          await audit(tx, result);
        }
        await tx.idempotencyRecord.update({
          where: { id: record.id },
          data: { response: result as Prisma.InputJsonValue },
        });
        return result;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      });
      return { value, replayed: false };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await prisma.idempotencyRecord.findUnique({
          where: { actorId_operation_key: { actorId, operation, key } },
        });
        if (!existing) throw error;
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key was already used with a different payload');
        }
        return { value: existing.response as unknown as T, replayed: true };
      }
      // `40001` is serialization_failure, and it arrives by two different doors.
      //
      // Prisma's own optimistic-concurrency check reports `P2034`. A `$queryRaw`
      // inside the same transaction does not — it reports `P2010` with the underlying
      // SQLSTATE in the message, because a raw statement bypasses the layer that
      // translates the condition into `P2034`.
      //
      // The importer has raw statements — the advisory lock, the folded-duplicate
      // lookup — so under two concurrent imports it hit exactly that second door: the
      // transaction aborted, nothing committed, and the caller got a 500 for a
      // condition that is *defined* to be retried. The rows did not land, so nothing
      // was corrupted, but "try again" is the correct answer to a serialization
      // failure and the operator was told to file a bug instead.
      //
      // Both codes are retried, and the SQLSTATE is read from the message rather than
      // matched on a Prisma code alone, because that is the only place it appears.
      const isSerializationFailure =
        error?.code === 'P2034'
        || (error?.code === 'P2010' && /40001|serialization/i.test(String(error?.message ?? '')));
      if (isSerializationFailure) {
        if (attempt < 2) continue;
        // Three attempts and still contended. Reported as a conflict, not as the raw
        // database error: the state is unknown-but-consistent, nothing was committed,
        // and retrying is the right next move for the caller. Letting the raw error out
        // turns a busy moment into a 500 and a bug report — the same mistake one level
        // up, one branch further out.
        throw new ConflictException('Operation could not acquire a consistent database state');
      }
      throw error;
    }
  }

  throw new ConflictException('Operation could not acquire a consistent database state');
}
