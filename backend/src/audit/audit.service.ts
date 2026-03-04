// ENTERPRISE FIX: Phase 3 - Audit Logging & Advanced Security - 2026-03-03
import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  metadata?: Record<string, unknown>;
}

export interface ActiveSessionEntry {
  id: string;
  userId: string;
  username: string;
  role: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  isRevoked: boolean;
}

@Injectable()
export class AuditService {
  private readonly auditFilePath = path.resolve(process.cwd(), 'backups', 'security-audit-log.json');
  private readonly sessionsFilePath = path.resolve(process.cwd(), 'backups', 'active-user-sessions.json');

  async log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<AuditLogEntry> {
    const current = await this.readAuditLogs();
    const nextEntry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const next = [nextEntry, ...current].slice(0, 10000);
    await this.writeAuditLogs(next);
    return nextEntry;
  }

  async listLogs(params?: {
    actorId?: string;
    action?: AuditAction;
    status?: 'success' | 'failed';
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const logs = await this.readAuditLogs();
    const limit = Math.max(1, Math.min(5000, Number(params?.limit || 500)));

    return logs
      .filter((log) => (params?.actorId ? log.actorId === params.actorId : true))
      .filter((log) => (params?.action ? log.action === params.action : true))
      .filter((log) => (params?.status ? log.status === params.status : true))
      .slice(0, limit);
  }

  async createSession(params: {
    sessionId?: string;
    userId: string;
    username: string;
    role: string;
    deviceFingerprint: string;
    ipAddress: string;
    userAgent: string;
    expiresAt: Date;
  }): Promise<ActiveSessionEntry> {
    const sessions = await this.readSessions();
    const nowIso = new Date().toISOString();

    const session: ActiveSessionEntry = {
      id: params.sessionId || randomUUID(),
      userId: params.userId,
      username: params.username,
      role: params.role,
      deviceFingerprint: params.deviceFingerprint,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      createdAt: nowIso,
      lastActivityAt: nowIso,
      expiresAt: params.expiresAt.toISOString(),
      isRevoked: false,
    };

    const next = [session, ...sessions].slice(0, 20000);
    await this.writeSessions(next);
    return session;
  }

  async touchSession(sessionId: string): Promise<void> {
    const sessions = await this.readSessions();
    const nowIso = new Date().toISOString();

    const next = sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            lastActivityAt: nowIso,
          }
        : session,
    );

    await this.writeSessions(next);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const sessions = await this.readSessions();
    const next = sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            isRevoked: true,
          }
        : session,
    );
    await this.writeSessions(next);
  }

  async purgeExpiredSessions(): Promise<void> {
    const now = Date.now();
    const sessions = await this.readSessions();
    const next = sessions.filter((session) => {
      if (session.isRevoked) return false;
      return new Date(session.expiresAt).getTime() > now;
    });
    await this.writeSessions(next);
  }

  async listActiveSessions(userId?: string): Promise<ActiveSessionEntry[]> {
    await this.purgeExpiredSessions();
    const sessions = await this.readSessions();
    return sessions.filter((session) => !session.isRevoked && (userId ? session.userId === userId : true));
  }

  private async readAuditLogs(): Promise<AuditLogEntry[]> {
    try {
      const raw = await fs.readFile(this.auditFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AuditLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeAuditLogs(logs: AuditLogEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.auditFilePath), { recursive: true });
    await fs.writeFile(this.auditFilePath, JSON.stringify(logs, null, 2), 'utf8');
  }

  private async readSessions(): Promise<ActiveSessionEntry[]> {
    try {
      const raw = await fs.readFile(this.sessionsFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as ActiveSessionEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeSessions(sessions: ActiveSessionEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(this.sessionsFilePath), { recursive: true });
    await fs.writeFile(this.sessionsFilePath, JSON.stringify(sessions, null, 2), 'utf8');
  }
}
