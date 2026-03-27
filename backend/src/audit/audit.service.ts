// ENTERPRISE FIX: Phase 6 Final Polish + Full E2E Tests + Deployment Guide - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 6.6 - Global 100% Cleanup & Absolute Verification - 2026-03-13
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'SESSION_CREATED'
  | 'SESSION_EXTENDED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'USER_LOCK'
  | 'USER_UNLOCK'
  | 'ROLE_PERMISSIONS_UPDATE'
  | 'INVITATION_SENT'
  | 'INVITATION_ACCEPTED'
  | 'BULK_ASSIGN_ROLE'
  | 'BULK_DELETE_USERS'
  | 'PASSWORD_POLICY_VIOLATION'
  | 'PASSWORD_CHANGED'
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
  message: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

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
    const nextMetadata = {
      ...(entry.metadata || {}),
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
  }): AuditLogEntry {
    return {
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      action: record.action as AuditAction,
      actorId: record.userId || 'anonymous',
      actorUsername: record.actorUsername,
      actorRole: record.actorRole,
      targetUserId: record.targetUserId || undefined,
      targetResource: record.targetResource || undefined,
      status: record.status as 'success' | 'failed',
      message: record.details,
      ipAddress: record.ipAddress || undefined,
      metadata: this.parseMetadataJson(record.metadata),
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
          entityType: 'User', // Default for legacy log calls
          entityId: nextEntry.actorId || 'system',
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

  async listLogs(params?: {
    actorId?: string;
    action?: AuditAction;
    status?: 'success' | 'failed';
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const prisma = this.getPrisma();
    const limit = Math.max(1, Math.min(5000, Number(params?.limit || 500)));

    const records = await prisma.auditLog.findMany({
      where: {
        ...(params?.actorId ? { userId: params.actorId } : {}),
        ...(params?.action ? { action: params.action } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return records.map((record) => this.mapAuditLog(record));
  }

  async logItemAction(
    userId: string,
    action: string, // CREATE / UPDATE / ARCHIVE / DELETE / RESTORE
    entityType: string, // Item / Transaction / User / etc.
    entityId: string,
    details: any,
    actorUsername?: string,
    status: 'SUCCESS' | 'FAILED' = 'SUCCESS',
  ): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        action,
        entityType,
        entityId,
        details: details ? JSON.stringify(details) : null,
        actorUsername: actorUsername || 'system',
        actorRole: 'system',
        status,
        timestamp: new Date(),
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

  async purgeExpiredSessions(): Promise<void> {
    const prisma = this.getPrisma();
    await prisma.$transaction(async (tx) => {
      await tx.activeSession.deleteMany({
        where: {
          OR: [
            { isRevoked: true },
            { expiresAt: { lte: new Date() } },
          ],
        },
      });
    });
  }

  async findActiveSession(params: {
    sessionId?: string;
    userId?: string;
    tokenHash?: string;
  }): Promise<ActiveSessionEntry | null> {
    await this.purgeExpiredSessions();
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
    await this.purgeExpiredSessions();
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
