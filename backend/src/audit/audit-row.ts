import type { Prisma } from '@prisma/client';
import { redactMetadata } from './audit-redaction';

/**
 * The one place an audit row is built.
 *
 * ## Why this exists
 *
 * The row was assembled inline, and the names in that assembly do not match the
 * schema. The Prisma field for the actor is `userId` (mapped to the column
 * `actorId`), the human-readable line is `details` (mapped to the column
 * `message`), and `metadata` is a `String?` that must be serialised. A hand-written
 * create that used `actorId`, `message` and an object got past the type checker
 * because the data object was cast with `as any` — which silenced exactly the
 * check that would have caught it. It failed at runtime, in the middle of a system
 * reset, as:
 *
 *     Invalid `prisma.auditLog.create()` invocation:
 *     Unknown argument `actorId`. Did you mean `actor`?
 *
 * Only the first bad name is reported, so that one line hid two more.
 *
 * ## The second thing this fixes
 *
 * The inline assembly never wrote `userId` at all. Every row the application has
 * ever written therefore has a NULL actor column: `actorUsername` and `actorRole`
 * are stored as text, so attribution is readable, but the relationship is not — so
 * `GET /audit/logs?actorId=…` matched nothing and the `actorId` index indexed
 * nothing. `FC-AUD-001` made `targetUserId` real and left `userId` hollow.
 *
 * ## The rule
 *
 * One builder, fully typed, with no cast. A wrong field name is a compile error,
 * which is the only place it should ever be found. It takes no Prisma client, so
 * the same builder serves `AuditService.log()` and any caller that is already
 * inside a transaction and must not open a second one.
 */

/** The shape a caller supplies, before it becomes a row. */
export type AuditRowInput = {
  id?: string;
  timestamp?: string | Date;
  action: string;
  actorId: string;
  actorUsername: string;
  actorRole: string;
  targetUserId?: string | null;
  targetResource?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** The human-readable line. The column is `message`; the field is `details`. */
  message?: string | null;
  status: 'success' | 'failed';
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
};

/**
 * The actor id is a foreign key, so it has to look like one.
 *
 * `logItemAction` has always checked this before writing, because it writes
 * `userId`. The generic `log()` path did not write the column at all, so its
 * callers were free to pass 'system' or an arbitrary string without consequence.
 * Now that it does, the same check has to apply here: without it, the fix would
 * trade a silent NULL for a foreign-key violation on the first caller that was
 * relying on the old tolerance.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const normalizeActorId = (value: string | null | undefined): string | null => {
  const candidate = String(value ?? '').trim();
  return UUID_REGEX.test(candidate) ? candidate : null;
};

/** The column value: the audit metadata is a string, not an object. */
export const serializeAuditMetadata = (
  value: Record<string, unknown> | null | undefined,
): string | null => {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    // A value that cannot be serialised must not cost the row itself; the
    // message and the rest of the entry still describe what happened.
    return JSON.stringify({ metadataSerializationFailed: true });
  }
};

/**
 * Redaction happens here rather than in the callers.
 *
 * `AuditService.log` used to run `redactMetadata` over the entry before writing
 * it. Moving the write into one builder could easily have dropped that, and the
 * result would not have failed any test — passwords and tokens would simply be
 * written to the audit trail in clear, and an audit trail is the one table more
 * people can read than they should. With the redaction inside the builder there
 * is no path to the column that skips it.
 */
const safeMetadata = (
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null => (value ? redactMetadata(value) || null : null);

/**
 * Builds the row. No `as any`, and no default that papers over a missing name:
 * the compiler is the point.
 */
export const buildAuditRow = (input: AuditRowInput): Prisma.AuditLogUncheckedCreateInput => ({
  ...(input.id ? { id: input.id } : {}),
  ...(input.timestamp ? { timestamp: new Date(input.timestamp) } : {}),
  action: input.action,
  // `userId` is the field; `actorId` is the column. Passing the wrong one is a
  // runtime error, not a silent null.
  userId: normalizeActorId(input.actorId),
  actorUsername: input.actorUsername,
  actorRole: input.actorRole,
  // `details` is the field; `message` is the column.
  details: input.message ?? null,
  entityType: input.entityType || 'User',
  entityId: input.entityId || input.actorId || 'system',
  targetUserId: input.targetUserId ?? null,
  targetResource: input.targetResource ?? null,
  status: input.status === 'success' ? 'SUCCESS' : 'FAILED',
  ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
  metadata: serializeAuditMetadata(safeMetadata(input.metadata)),
});
