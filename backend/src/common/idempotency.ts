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
      if (error?.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }

  throw new ConflictException('Operation could not acquire a consistent database state');
}
