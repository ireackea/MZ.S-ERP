// ENTERPRISE FIX: Phase 6 Final Polish + Full E2E Tests + Deployment Guide - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 6.6 - Global 100% Cleanup & Absolute Verification - 2026-03-13
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { redactMetadata } from './audit-redaction';

/**
 * FC-AUD-001 — a Prisma client, or the transaction-scoped client handed to a
 * mutation. Passing the transaction client is what makes the audit row commit
 * or roll back together with the business change it describes.
 */
export type AuditWriter = PrismaService | Prisma.TransactionClient;

/** FC-AUD-001 — every privileged or state-changing command records this. */
export type BusinessAction =
  | 'TRANSACTION_CREATE'
  | 'TRANSACTION_UPDATE'
  | 'TRANSACTION_DELETE'
  | 'TRANSACTION_ADJUST'
  | 'TRANSACTION_MIGRATE'
  | 'STOCKTAKING_CREATE'
  | 'STOCKTAKING_UPDATE'
  | 'STOCKTAKING_CLOSE'
  | 'STOCKTAKING_REOPEN'
  | 'ORDER_CREATE'
  | 'ORDER_UPDATE'
  | 'ORDER_DELETE'
  | 'PARTNER_CREATE'
  | 'PARTNER_UPDATE'
  | 'PARTNER_DELETE'
  | 'ITEM_CREATE'
  | 'ITEM_UPDATE'
  | 'ITEM_DELETE'
  | 'ITEM_ARCHIVE'
  | 'ITEM_RESTORE'
  | 'FORMULATION_CREATE'
  | 'FORMULATION_UPDATE'
  | 'FORMULATION_DELETE'
  | 'ROLE_CREATE'
  | 'ROLE_PERMISSIONS_UPDATE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'REFERENCE_DATA_UPDATE'
  | 'UNLOADING_RULE_UPDATE'
  | 'SYSTEM_SETTINGS_UPDATE'
  | 'SYSTEM_RESET'
  | 'BACKUP_CREATE'
  | 'BACKUP_RESTORE'
  | 'BACKUP_DELETE'
  | 'INITIAL_ADMIN_CREATED'
  | 'CLIENT_ACTIVITY';

export type AuditAction =
  | BusinessAction
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'SESSION_CREATED'
  | 'SESSION_EXTENDED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'USER_LOCK'
  | 'USER_UNLOCK'
  | 'INVITATION_SENT'
  | 'INVITATION_ACCEPTED'
  | 'BULK_ASSIGN_ROLE'
  | 'BULK_DELETE_USERS'
  | 'ROLE_TEMPLATE_REPAIRED'
  | 'ROLE_DELETED'
  | 'OPENING_BALANCE_SET'
  | 'OPENING_BALANCE_BULK_SET'
  | 'PASSWORD_POLICY_VIOLATION'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_CHANGE_REJECTED'
  | 'PASSWORD_RESET_BY_ADMIN'
  | 'PERMISSION_CHECK';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  actorId: string;
  actorUsername: string;
  actorRole: string;
  targetUserId?: string;
  targetResource?: string;
  status: 'success' | 'failed';
  /** FC-AUD-001 — true when the row was moved out of the default window by retention. */
  archived?: boolean;
  /** FC-AUD-001 — what the record is about, so callers can correlate without parsing `message`. */
  entityType?: string;
  entityId?: string;
  message: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

/** FC-AUD-001 — the search/filter contract shared by list, export and archive. */
export type AuditQuery = {
  actorId?: string;
  action?: AuditAction;
  status?: 'success' | 'failed';
  limit?: number;
  offset?: number;
  /** Free-text search over message, actor and entity id. */
  search?: string;
  entityType?: string;
  entityId?: string;
  /**
   * FC-AUD-001 — the subject of the entry, as distinct from `actorId`. The
   * user-management audit tab asks "what happened to this account", which is
   * the target, not the person who pressed the button. `entityId` holds the
   * actor for legacy `log()` calls, so it cannot answer that question.
   */
  targetUserId?: string;
  from?: string;
  to?: string;
};

export interface ActiveSessionEntry {
  id: string;
  userId: string;
  tokenHash?: string;
  expiresAt: string;
  deviceInfo?: string;
  isRevoked: boolean;
  username?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: string;
  lastActivityAt?: string;
}

@Injectable()
export class AuditService {
  private static prismaService: PrismaService | null = null;

  constructor(
    private prisma?: PrismaService,
    private readonly realtimeService?: RealtimeService,
  ) {}

  static configurePrisma(prisma: PrismaService) {
    AuditService.prismaService = prisma;
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
  }

  private getPrisma(): PrismaService {
    const prisma = this.prisma || AuditService.prismaService;
    if (!prisma) {
      throw new Error('AuditService Prisma is not configured. JSON fallback is forbidden.');
    }
    return prisma;
  }

  private normalizeUserReference(userId?: string | null): string | null {
    const normalized = String(userId || '').trim();
    if (!normalized) return null;

    const syntheticActors = new Set(['anonymous', 'system', 'unknown']);
    if (syntheticActors.has(normalized.toLowerCase())) {
      return null;
    }

    return normalized;
  }

  private extractIpAddress(metadata?: Record<string, unknown>): string | null {
    const candidate = metadata?.ipAddress;
    if (typeof candidate !== 'string') return null;
    const normalized = candidate.trim();
    return normalized || null;
  }

  private toMetadataJson(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): string | null {
    // FC-AUD-001 — redact before persisting; metadata is broadly readable.
    const safeMetadata = redactMetadata(entry.metadata) || {};
    const nextMetadata = {
      ...safeMetadata,
      actorUsername: entry.actorUsername,
      actorRole: entry.actorRole,
      targetUserId: entry.targetUserId,
      targetResource: entry.targetResource,
      status: entry.status,
    };
    return JSON.stringify(nextMetadata);
  }

  private parseMetadataJson(raw: string | null): Record<string, unknown> | undefined {
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private mapAuditLog(record: {
    id: string;
    timestamp: Date;
    action: string;
    userId: string | null;
    details: string;
    ipAddress: string | null;
    actorUsername: string;
    actorRole: string;
    targetUserId: string | null;
    targetResource: string | null;
    status: string;
    metadata: string | null;
    entityType?: string;
    entityId?: string;
  }): AuditLogEntry {
    const metadata = this.parseMetadataJson(record.metadata);
    return {
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      action: record.action as AuditAction,
      actorId: record.userId || 'anonymous',
      actorUsername: record.actorUsername,
      actorRole: record.actorRole,
      targetUserId: record.targetUserId || undefined,
      targetResource: record.targetResource || undefined,
      status: (record.status === 'FAILED' ? 'failed' : 'success') as 'success' | 'failed',
      archived: record.status === 'ARCHIVED',
      entityType: record.entityType,
      entityId: record.entityId,
      message: record.details,
      ipAddress: record.ipAddress || undefined,
      metadata,
    };
  }

  private mapSession(record: {
    id: string;
    userId: string;
    tokenHash: string | null;
    deviceInfo: string | null;
    username: string;
    role: string;
    ipAddress: string;
    userAgent: string;
    createdAt: Date;
    lastActivityAt: Date;
    expiresAt: Date;
    isRevoked: boolean;
  }): ActiveSessionEntry {
    return {
      id: record.id,
      userId: record.userId,
      tokenHash: record.tokenHash || undefined,
      expiresAt: record.expiresAt.toISOString(),
      deviceInfo: record.deviceInfo || undefined,
      isRevoked: record.isRevoked,
      username: record.username,
      role: record.role,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      createdAt: record.createdAt.toISOString(),
      lastActivityAt: record.lastActivityAt.toISOString(),
    };
  }

  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<AuditLogEntry> {
    const nextEntry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const prisma = this.getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: nextEntry.id,
          timestamp: new Date(nextEntry.timestamp),
          action: nextEntry.action,
          // FC-AUD-001 — these were hardcoded, which broke the trail in two ways
          // at once: `targetUserId` was never written, so the whole column was
          // permanently NULL and `GET /users/:id/audit` always returned nothing;
          // and `entityType` was 'User' for every row regardless of what the
          // entry was about. Both are now taken from the caller, falling back to
          // the previous values so no existing caller changes behaviour.
          entityType: nextEntry.entityType || 'User',
          entityId: nextEntry.entityId || nextEntry.actorId || 'system',
          targetUserId: nextEntry.targetUserId ?? null,
          targetResource: nextEntry.targetResource ?? null,
          details: nextEntry.message,
          ipAddress: this.extractIpAddress(nextEntry.metadata),
          metadata: this.toMetadataJson(nextEntry),
          actorUsername: nextEntry.actorUsername,
          actorRole: nextEntry.actorRole,
          status: nextEntry.status === 'success' ? 'SUCCESS' : 'FAILED',
        },
      });
    });

    return nextEntry;
  }

  async listLogs(params?: AuditQuery): Promise<AuditLogEntry[]> {
    return (await this.queryLogs({ ...params, limit: params?.limit ?? 500 })).rows;
  }

  /**
   * FC-AUD-001 — paginated audit search. Returns rows plus a total so the UI can
   * page without re-querying, and clamps `limit` to keep the endpoint bounded.
   */
  /**
   * Gate 3.2 - the distinct actions and entity types that exist, so the audit
   * screen can offer them as filters.
   *
   * Both columns are indexed. `entityId` is deliberately not offered: it is
   * effectively unique per row, and a dropdown of forty thousand identifiers is
   * not a filter, it is a wall.
   */
  async queryFacets(): Promise<{ actions: string[]; entityTypes: string[] }> {
    const [actions, entityTypes] = await Promise.all([
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
        take: 200,
      }),
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
        take: 200,
      }),
    ]);

    return {
      actions: actions.map((row) => row.action).filter(Boolean),
      entityTypes: entityTypes.map((row) => row.entityType).filter(Boolean),
    };
  }

  async queryLogs(params?: AuditQuery): Promise<{ rows: AuditLogEntry[]; total: number; limit: number; offset: number }> {
    const prisma = this.getPrisma();
    const limit = Math.max(1, Math.min(1000, Number(params?.limit ?? 500)));
    const offset = Math.max(0, Number(params?.offset ?? 0));
    const search = String(params?.search ?? '').trim();

    const where: Prisma.AuditLogWhereInput = {
      // FC-AUD-001 — archived history is excluded from the default view; it is
      // reachable only through the explicit /audit/archived route.
      status: params?.status
        ? (params.status === 'success' ? 'SUCCESS' : 'FAILED')
        : { not: 'ARCHIVED' },
      ...(params?.actorId ? { userId: params.actorId } : {}),
      ...(params?.action ? { action: params.action } : {}),
      ...(params?.entityType ? { entityType: params.entityType } : {}),
      ...(params?.entityId ? { entityId: params.entityId } : {}),
      ...(params?.targetUserId ? { targetUserId: params.targetUserId } : {}),
      ...(params?.from || params?.to
        ? {
            timestamp: {
              ...(params?.from ? { gte: new Date(params.from) } : {}),
              ...(params?.to ? { lte: new Date(params.to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { details: { contains: search, mode: 'insensitive' as const } },
              { actorUsername: { contains: search, mode: 'insensitive' as const } },
              { entityId: { contains: search, mode: 'insensitive' as const } },
              { entityType: { contains: search, mode: 'insensitive' as const } },
              { targetResource: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: limit, skip: offset }),
      prisma.auditLog.count({ where }),
    ]);

    return { rows: records.map((record) => this.mapAuditLog(record)), total, limit, offset };
  }

  /**
   * FC-AUD-001 — export contract. Returns a deterministic, redacted CSV so an
   * auditor can take a copy without also taking any credentials with it.
   */
  async exportLogs(params?: AuditQuery): Promise<{
    filename: string;
    contentType: string;
    rowCount: number;
    csv: string;
  }> {
    const result = await this.queryLogs({ ...params, limit: params?.limit ?? 5000, offset: params?.offset ?? 0 });

    const header = [
      'id', 'timestamp', 'action', 'status', 'actorUsername', 'actorRole',
      'actorId', 'entityType', 'entityId', 'targetResource', 'targetUserId', 'ipAddress', 'message',
    ];

    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = result.rows.map((row) =>
      [
        row.id, row.timestamp, row.action, row.status, row.actorUsername, row.actorRole,
        row.actorId, row.entityType ?? '', row.entityId ?? '',
        row.targetResource, row.targetUserId, row.ipAddress, row.message,
      ].map(escape).join(','),
    );

    return {
      filename: `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv; charset=utf-8',
      rowCount: result.rows.length,
      csv: [header.join(','), ...lines].join('\n'),
    };
  }

  /**
   * FC-AUD-001 — retention by ARCHIVE, never delete.
   *
   * Entries older than the retention window are marked `ARCHIVED` and dropped
   * from the default search window, but the rows stay in the table so an
   * investigator can still retrieve them. Deleting audit history would let a
   * privileged actor erase their own tracks.
   */
  async archiveExpired(olderThanDays = 90, now = new Date()): Promise<{ archived: number; cutoff: string }> {
    const prisma = this.getPrisma();
    const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await prisma.auditLog.updateMany({
      where: { timestamp: { lt: cutoff }, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    });

    return { archived: result.count, cutoff: cutoff.toISOString() };
  }

  /** FC-AUD-001 — archived entries stay retrievable, but only on request. */
  async listArchived(limit = 500, offset = 0): Promise<{ rows: AuditLogEntry[]; total: number }> {
    const prisma = this.getPrisma();
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit || 500)));
    const boundedOffset = Math.max(0, Number(offset || 0));

    const [records, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { status: 'ARCHIVED' },
        orderBy: { timestamp: 'desc' },
        take: boundedLimit,
        skip: boundedOffset,
      }),
      prisma.auditLog.count({ where: { status: 'ARCHIVED' } }),
    ]);

    return { rows: records.map((record) => this.mapAuditLog(record)), total };
  }

  /**
   * FC-AUD-001 — durable audit write.
   *
   * Pass the *same* transaction client that performed the business mutation.
   * The audit row then commits or rolls back with it, which is what guarantees
   * a committed financial change always has a matching audit record. Omitting
   * `client` keeps the old fire-and-forget behaviour and is only acceptable
   * for read-side or best-effort diagnostics.
   */
  async logItemAction(
    userId: string,
    action: string, // CREATE / UPDATE / ARCHIVE / DELETE / RESTORE
    entityType: string, // Item / Transaction / User / etc.
    entityId: string,
    details: any,
    actorUsername?: string,
    status: 'SUCCESS' | 'FAILED' = 'SUCCESS',
    options?: { client?: AuditWriter; requestId?: string; actorRole?: string; before?: unknown; after?: unknown },
  ): Promise<void> {
    // UUID_REGEX: نتحقق من صحة userId قبل حفظه كـ FK لتجنب خطأ constraint
    // القيم مثل 'system' و'anonymous' تُتجاهل — فقط UUIDs الحقيقية تُحفظ
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validUserId = userId && UUID_REGEX.test(userId) ? userId : undefined;

    // FC-AUD-001 — never persist credentials, even inside a free-form bag.
    const safeDetails = redactMetadata(
      details && typeof details === 'object' && !Array.isArray(details)
        ? details
        : { value: details },
    ) || null;

    const metadata: Record<string, unknown> = {
      ...(safeDetails || {}),
      ...(options?.before !== undefined ? { before: redactMetadata(options.before as Record<string, unknown>) } : {}),
      ...(options?.after !== undefined ? { after: redactMetadata(options.after as Record<string, unknown>) } : {}),
      ...(options?.requestId ? { requestId: String(options.requestId) } : {}),
    };

    const writer: AuditWriter = options?.client || this.getPrisma();

    await writer.auditLog.create({
      data: {
        id: randomUUID(),
        action,
        entityType,
        entityId,
        details: safeDetails ? JSON.stringify(safeDetails) : null,
        actorUsername: actorUsername || 'system',
        actorRole: options?.actorRole || 'system',
        status,
        timestamp: new Date(),
        metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
        ...(validUserId ? { userId: validUserId } : {}),
      },
    });

    // Phase 6: Real-time sync for audit logs
    if (this.realtimeService) {
      this.realtimeService.emitSync(
        ['audit', 'dashboard'],
        'audit-log-created',
        { meta: { action, entityType, entityId, status } },
      );
    }
  }

  async createSession(params: {
    sessionId?: string;
    userId: string;
    tokenHash: string;
    deviceInfo: string;
    username: string;
    role: string;
    ipAddress: string;
    userAgent: string;
    expiresAt: Date;
  }): Promise<ActiveSessionEntry> {
    const prisma = this.getPrisma();
    const now = new Date();

    const session: ActiveSessionEntry = {
      id: params.sessionId || randomUUID(),
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt.toISOString(),
      deviceInfo: params.deviceInfo,
      isRevoked: false,
      username: params.username,
      role: params.role,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      createdAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
    };

    await prisma.$transaction(async (tx) => {
      await tx.activeSession.create({
        data: {
          id: session.id,
          userId: session.userId,
          tokenHash: params.tokenHash,
          deviceInfo: params.deviceInfo,
          username: session.username,
          role: session.role,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: now,
          lastActivityAt: now,
          expiresAt: params.expiresAt,
          isRevoked: false,
        },
      });
    });

    return session;
  }

  async touchSession(sessionId: string): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.activeSession.updateMany({
        where: { id: sessionId, isRevoked: false },
        data: { lastActivityAt: new Date() },
      });
    });
  }

  async rotateSessionToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.activeSession.updateMany({
        where: { id: sessionId, isRevoked: false },
        data: {
          tokenHash,
          expiresAt,
          lastActivityAt: new Date(),
        },
      });
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.activeSession.updateMany({
        where: { id: sessionId },
        data: { isRevoked: true },
      });
    });
  }

  // لماذا: نستخدم guard لمنع تشغيل عمليات التنظيف المتزامنة التي كانت تستنفد
  // connection pool عند وصول طلبات متعددة في آنٍ واحد.
  private _isPurging = false;

  async purgeExpiredSessions(): Promise<void> {
    // لماذا: نتجنب تشغيل تنظيف متزامن — deleteMany أتومي بطبيعته ولا يحتاج $transaction
    if (this._isPurging) return;
    this._isPurging = true;
    try {
      const prisma = this.getPrisma();
      await prisma.activeSession.deleteMany({
        where: {
          OR: [
            { isRevoked: true },
            { expiresAt: { lte: new Date() } },
          ],
        },
      });
    } finally {
      this._isPurging = false;
    }
  }

  async findActiveSession(params: {
    sessionId?: string;
    userId?: string;
    tokenHash?: string;
  }): Promise<ActiveSessionEntry | null> {
    // لماذا: أُزيل استدعاء purgeExpiredSessions() من هنا لأنه كان يُطلَق مع كل طلب API
    // مُصادَق عليه، مما أدى إلى إنشاء Prisma transactions متزامنة تستنفد connection pool.
    // التنظيف الدوري كل 5 دقائق في main.ts كافٍ — والاستعلام أدناه يُرشِّح الجلسات
    // المنتهية تلقائياً بـ expiresAt > now.
    const prisma = this.getPrisma();
    const session = await prisma.activeSession.findFirst({
      where: {
        isRevoked: false,
        expiresAt: { gt: new Date() },
        ...(params.sessionId ? { id: params.sessionId } : {}),
        ...(params.userId ? { userId: params.userId } : {}),
        ...(params.tokenHash ? { tokenHash: params.tokenHash } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    return session ? this.mapSession(session) : null;
  }

  async listActiveSessions(userId?: string): Promise<ActiveSessionEntry[]> {
    // لماذا: أُزيل استدعاء purgeExpiredSessions() — نفس سبب findActiveSession أعلاه.
    // الاستعلام يُرشِّح الجلسات المنتهية بـ expiresAt > now.
    const prisma = this.getPrisma();
    const sessions = await prisma.activeSession.findMany({
      where: {
        isRevoked: false,
        expiresAt: { gt: new Date() },
        ...(userId ? { userId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
    });
    return sessions.map((session) => this.mapSession(session));
  }
}
