// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { BackupService } from '../backup/backup.service';
import { DatabaseInfrastructureService } from '../database/database-infrastructure.service';
import { PrismaService } from '../prisma.service';
import { ClientLogDto } from './dto/client-log.dto';
import { ResetChallengeDto, SystemResetDto, SystemResetScope } from './dto/system-reset.dto';

type HealthStatus = {
  status: 'healthy' | 'degraded';
  uptime: number;
  timestamp: string;
  dbConnected: boolean;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
};

type ResetAttemptState = {
  invalidAttempts: number;
  blockedUntil: number;
  updatedAt: number;
};

type ResetChallenge = {
  id: string;
  code: string;
  actorKey: string;
  expiresAt: number;
  consumed: boolean;
};

type RequestMeta = {
  ip: string;
  userAgent: string;
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private static readonly RESET_MAX_INVALID_ATTEMPTS = 3;
  private static readonly RESET_BLOCK_WINDOW_MS = 10 * 60 * 1000;
  private static readonly RESET_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
  private static readonly RESET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
  private readonly resetAttemptTracker = new Map<string, ResetAttemptState>();
  private readonly resetChallenges = new Map<string, ResetChallenge>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseInfrastructure: DatabaseInfrastructureService,
    private readonly auditService: AuditService,
    private readonly backupService: BackupService,
  ) {}

  async getHealth(): Promise<HealthStatus> {
    const dbConnected = await this.databaseInfrastructure.probeConnection();

    const mem = process.memoryUsage();
    return {
      status: dbConnected ? 'healthy' : 'degraded',
      uptime: Number(process.uptime().toFixed(2)),
      timestamp: new Date().toISOString(),
      dbConnected,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
    };
  }

  writeClientLog(dto: ClientLogDto, meta: { ip?: string; userAgent?: string; path?: string }) {
    const event = {
      event: 'client_log',
      level: dto.level ?? 'info',
      message: dto.message,
      source: dto.source ?? 'frontend',
      metadata: dto.metadata ?? {},
      ip: meta.ip ?? 'unknown',
      userAgent: meta.userAgent ?? 'unknown',
      path: meta.path ?? 'unknown',
      timestamp: new Date().toISOString(),
    };

    // Keep logs structured JSON for downstream parsing.
    this.logger.log(JSON.stringify(event));
    return {
      accepted: true,
      timestamp: event.timestamp,
    };
  }

  // SECURITY FIX: 2026-03-28 - Removed hardcoded reset code
  private getSystemResetToken(): string {
    const token = String(process.env.SYSTEM_RESET_TOKEN || '').trim();
    if (!token || token.length < 16) {
      this.logger.error('SYSTEM_RESET_TOKEN not configured or too short (min 16 chars)');
      throw new Error('إعداد إعادة الضبط غير مكتمل. يرجى ضبط SYSTEM_RESET_TOKEN بطول 16 حرفًا على الأقل.');
    }
    return token;
  }

  private getResetActorKey(user: any): string {
    const id = String(user?.id || '').trim();
    if (id) return `id:${id}`;

    const username = String(user?.username || '').trim().toLowerCase();
    if (username) return `username:${username}`;

    return 'anonymous';
  }

  private getResetActorLabel(user: any): string {
    const username = String(user?.username || 'unknown').trim() || 'unknown';
    const id = String(user?.id || 'unknown').trim() || 'unknown';
    return `${username} (ID: ${id})`;
  }

  private pruneResetAttemptTracker(now: number) {
    for (const [actorKey, state] of this.resetAttemptTracker.entries()) {
      const stale = state.updatedAt + MonitoringService.RESET_ATTEMPT_RETENTION_MS < now;
      const expiredBlock = state.blockedUntil > 0 && state.blockedUntil <= now;
      const idle = state.invalidAttempts <= 0 && state.blockedUntil <= 0;
      if (stale || (expiredBlock && idle)) {
        this.resetAttemptTracker.delete(actorKey);
      }
    }
  }

  private assertResetAttemptAllowed(actorKey: string, actorLabel: string, now: number) {
    const state = this.resetAttemptTracker.get(actorKey);
    if (!state || state.blockedUntil <= now) return;

    const retryAt = new Date(state.blockedUntil).toISOString();
    this.logger.warn(`Blocked reset attempt for ${actorLabel}; cooldown until ${retryAt}`);
    throw new UnauthorizedException({
      code: 'SYSTEM_RESET_COOLDOWN',
      message: 'تم إيقاف محاولات إعادة الضبط مؤقتًا بسبب تكرار الإدخال الخاطئ.',
      retryAt,
    });
  }

  private registerInvalidResetAttempt(actorKey: string, now: number): ResetAttemptState {
    const current = this.resetAttemptTracker.get(actorKey) ?? {
      invalidAttempts: 0,
      blockedUntil: 0,
      updatedAt: now,
    };

    current.invalidAttempts += 1;
    current.updatedAt = now;

    if (current.invalidAttempts >= MonitoringService.RESET_MAX_INVALID_ATTEMPTS) {
      current.blockedUntil = now + MonitoringService.RESET_BLOCK_WINDOW_MS;
      current.invalidAttempts = 0;
    }

    this.resetAttemptTracker.set(actorKey, current);
    return current;
  }

  private clearResetAttemptState(actorKey: string) {
    this.resetAttemptTracker.delete(actorKey);
  }

  // ---- Challenge management (second factor) ----
  private pruneResetChallenges(now: number) {
    for (const [id, challenge] of this.resetChallenges.entries()) {
      if (challenge.expiresAt <= now || challenge.consumed) {
        this.resetChallenges.delete(id);
      }
    }
  }

  private generateChallengeCode(): string {
    // 8-character uppercase alphanumeric (avoids ambiguous chars like 0/O, 1/I).
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i += 1) {
      out += alphabet[buf[i] % alphabet.length];
    }
    return out;
  }

  async issueResetChallenge(_dto: ResetChallengeDto, user: any, meta: RequestMeta) {
    const now = Date.now();
    this.pruneResetChallenges(now);

    const actorKey = this.getResetActorKey(user);
    const actorLabel = this.getResetActorLabel(user);
    const actorRole = String(user?.role || '').trim();

    if (actorRole !== 'SuperAdmin') {
      this.logger.warn(`Challenge denied for non-SuperAdmin ${actorLabel} (role=${actorRole || 'unknown'})`);
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_CHALLENGE_DENIED',
        details: { reason: 'role_not_superadmin', role: actorRole || 'unknown' },
        status: 'FAILED',
      });
      throw new UnauthorizedException({
        code: 'SYSTEM_RESET_SUPERADMIN_REQUIRED',
        message: 'غير مصرح بتنفيذ إعادة الضبط. هذا الإجراء متاح فقط لدور SuperAdmin.',
      });
    }

    this.assertResetAttemptAllowed(actorKey, actorLabel, now);

    const challenge: ResetChallenge = {
      id: randomUUID(),
      code: this.generateChallengeCode(),
      actorKey,
      expiresAt: now + MonitoringService.RESET_CHALLENGE_TTL_MS,
      consumed: false,
    };
    this.resetChallenges.set(challenge.id, challenge);

    this.logger.warn(`SYSTEM RESET CHALLENGE issued for ${actorLabel} (challengeId=${challenge.id})`);
    await this.recordResetAudit({
      user,
      meta,
      action: 'SYSTEM_RESET_CHALLENGE_ISSUED',
      details: { challengeId: challenge.id, expiresAt: new Date(challenge.expiresAt).toISOString() },
      status: 'SUCCESS',
    });

    return {
      challengeId: challenge.id,
      challengeCode: challenge.code,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      ttlSeconds: Math.floor(MonitoringService.RESET_CHALLENGE_TTL_MS / 1000),
    };
  }

  private consumeChallenge(
    challengeId: string,
    challengeCode: string,
    actorKey: string,
    now: number,
  ): { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'MISMATCH' | 'ACTOR_MISMATCH' } {
    const entry = this.resetChallenges.get(challengeId);
    if (!entry) return { ok: false, reason: 'NOT_FOUND' };
    if (entry.consumed || entry.expiresAt <= now) {
      this.resetChallenges.delete(challengeId);
      return { ok: false, reason: 'EXPIRED' };
    }
    if (entry.actorKey !== actorKey) return { ok: false, reason: 'ACTOR_MISMATCH' };
    if (entry.code !== String(challengeCode || '').trim().toUpperCase()) {
      return { ok: false, reason: 'MISMATCH' };
    }
    entry.consumed = true;
    this.resetChallenges.delete(challengeId);
    return { ok: true };
  }

  // ---- Audit helper ----
  private async recordResetAudit(params: {
    user: any;
    meta: RequestMeta;
    action: string;
    details: Record<string, unknown>;
    status: 'SUCCESS' | 'FAILED';
  }): Promise<void> {
    try {
      const userId = String(params.user?.id || params.user?.sub || '').trim();
      const username = String(params.user?.username || 'unknown').trim();
      const enriched = {
        ...params.details,
        ipAddress: params.meta.ip,
        userAgent: params.meta.userAgent,
        timestamp: new Date().toISOString(),
      };
      await this.auditService.logItemAction(
        userId,
        params.action,
        'SystemReset',
        userId || 'system',
        enriched,
        username,
        params.status,
      );
    } catch (err: any) {
      this.logger.error(`Failed to record reset audit (${params.action}): ${err?.message || err}`);
    }
  }

  // ---- Scope-based deletion ----
  private async executeScopedReset(scope: SystemResetScope): Promise<{ tablesAffected: string[] }> {
    const tables: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (scope === 'audit') {
        await tx.auditLog.deleteMany({});
        tables.push('AuditLog');
        return;
      }

      // Inventory-only and broader scopes: clear operational data first to satisfy FK order.
      await tx.transaction.deleteMany({});
      tables.push('Transaction');
      await tx.openingBalance.deleteMany({});
      tables.push('OpeningBalance');
      // Formulation depends on Item; clear children then parents.
      // FormulationItem & UnloadingRule may not exist on every deployment; guard via try/catch.
      try { await (tx as any).formulationItem?.deleteMany?.({}); tables.push('FormulationItem'); } catch { /* optional model */ }
      try { await (tx as any).formulation?.deleteMany?.({}); tables.push('Formulation'); } catch { /* optional model */ }
      try { await (tx as any).unloadingRule?.deleteMany?.({}); tables.push('UnloadingRule'); } catch { /* optional model */ }
      await tx.item.deleteMany({});
      tables.push('Item');

      if (scope === 'inventory') return;

      // 'data' & 'full' scopes also wipe audit logs and active sessions.
      await tx.auditLog.deleteMany({});
      tables.push('AuditLog');
      try { await (tx as any).activeSession?.deleteMany?.({}); tables.push('ActiveSession'); } catch { /* optional */ }

      if (scope === 'data') return;

      // 'full': wipe identity tables BUT preserve a single SuperAdmin to avoid lockout.
      const superAdmins = await tx.user.findMany({
        where: { role: { is: { name: 'SuperAdmin' } } },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      const keepUserId = superAdmins[0]?.id;

      try { await (tx as any).rolePermission?.deleteMany?.({}); tables.push('RolePermission'); } catch { /* optional */ }
      try {
        await (tx as any).userRole?.deleteMany?.({
          where: keepUserId ? { NOT: { userId: keepUserId } } : {},
        });
        tables.push('UserRole');
      } catch { /* optional */ }
      try { await (tx as any).invitation?.deleteMany?.({}); tables.push('Invitation'); } catch { /* optional */ }

      await tx.user.deleteMany({
        where: keepUserId ? { NOT: { id: keepUserId } } : {},
      });
      tables.push('User (except seed SuperAdmin)');
    });

    return { tablesAffected: tables };
  }

  async performSystemReset(dto: SystemResetDto, user: any, meta: RequestMeta) {
    const now = Date.now();
    this.pruneResetAttemptTracker(now);
    this.pruneResetChallenges(now);

    const actorKey = this.getResetActorKey(user);
    const actorLabel = this.getResetActorLabel(user);
    const actorRole = String(user?.role || '').trim();

    this.logger.warn(`SYSTEM RESET REQUESTED by ${actorLabel} | scope=${dto.scope} | ip=${meta.ip}`);

    // 1) Role gate.
    if (actorRole !== 'SuperAdmin') {
      this.logger.warn(`Rejected reset attempt by non-SuperAdmin user ${actorLabel} (role: ${actorRole || 'unknown'})`);
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_DENIED',
        details: { reason: 'role_not_superadmin', role: actorRole || 'unknown', scope: dto.scope },
        status: 'FAILED',
      });
      throw new UnauthorizedException({
        code: 'SYSTEM_RESET_SUPERADMIN_REQUIRED',
        message: 'غير مصرح بتنفيذ إعادة الضبط. هذا الإجراء متاح فقط لدور SuperAdmin.',
      });
    }

    // 2) Cooldown gate.
    this.assertResetAttemptAllowed(actorKey, actorLabel, now);

    // 3) Reason gate (defense-in-depth; class-validator already enforces).
    const reason = String(dto.reason || '').trim();
    if (reason.length < 10) {
      throw new BadRequestException({
        code: 'SYSTEM_RESET_REASON_REQUIRED',
        message: 'يجب إدخال سبب واضح لإعادة الضبط (10 أحرف على الأقل).',
      });
    }

    // 4) Long-lived token.
    const expectedToken = this.getSystemResetToken();
    if (dto.confirmationCode !== expectedToken) {
      const state = this.registerInvalidResetAttempt(actorKey, now);
      this.logger.warn(`Invalid reset confirmation by ${actorLabel}; blockedUntil=${state.blockedUntil}`);
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_INVALID_TOKEN',
        details: { scope: dto.scope, blockedUntil: state.blockedUntil > 0 ? new Date(state.blockedUntil).toISOString() : null },
        status: 'FAILED',
      });

      if (state.blockedUntil > 0) {
        throw new UnauthorizedException({
          code: 'SYSTEM_RESET_COOLDOWN',
          message: 'تم إيقاف محاولات إعادة الضبط مؤقتًا بسبب تكرار الإدخال الخاطئ.',
          retryAt: new Date(state.blockedUntil).toISOString(),
        });
      }

      throw new UnauthorizedException({
        code: 'SYSTEM_RESET_INVALID_CODE',
        message: 'رمز التأكيد غير صحيح. يرجى التواصل مع مدير النظام.',
      });
    }

    // 5) One-time challenge code.
    const challengeResult = this.consumeChallenge(
      String(dto.challengeId || '').trim(),
      String(dto.challengeCode || '').trim(),
      actorKey,
      now,
    );
    if (!challengeResult.ok) {
      const failureReason = (challengeResult as { ok: false; reason: string }).reason;
      const state = this.registerInvalidResetAttempt(actorKey, now);
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_INVALID_CHALLENGE',
        details: { scope: dto.scope, reason: failureReason },
        status: 'FAILED',
      });
      if (state.blockedUntil > 0) {
        throw new UnauthorizedException({
          code: 'SYSTEM_RESET_COOLDOWN',
          message: 'تم إيقاف محاولات إعادة الضبط مؤقتًا بسبب تكرار الإدخال الخاطئ.',
          retryAt: new Date(state.blockedUntil).toISOString(),
        });
      }
      throw new UnauthorizedException({
        code: 'SYSTEM_RESET_INVALID_CHALLENGE',
        message: 'رمز التحقق المؤقت غير صالح أو انتهت صلاحيته. يرجى طلب رمز جديد.',
      });
    }

    this.clearResetAttemptState(actorKey);

    // 6) Optional pre-reset backup (best-effort; never blocks reset).
    let backupId: string | null = null;
    if (dto.createBackup !== false) {
      try {
        const created = await this.backupService.createBackup({
          type: 'full',
          actor: {
            userId: String(user?.id || user?.sub || 'system'),
            username: String(user?.username || 'system'),
          },
        });
        backupId = (created as any)?.id || null;
        this.logger.log(`Pre-reset backup created (id=${backupId})`);
      } catch (err: any) {
        this.logger.error(`Pre-reset backup failed (non-fatal): ${err?.message || err}`);
      }
    }

    // 7) Execute scoped, atomic reset.
    try {
      this.logger.log(`Starting scoped reset (scope=${dto.scope})...`);
      const { tablesAffected } = await this.executeScopedReset(dto.scope);
      this.logger.log(`Reset completed. Tables affected: ${tablesAffected.join(', ')}`);

      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_SUCCESS',
        details: { scope: dto.scope, reason, tablesAffected, backupId, createBackup: dto.createBackup !== false },
        status: 'SUCCESS',
      });

      return {
        success: true,
        scope: dto.scope,
        tablesAffected,
        backupId,
        message: this.buildSuccessMessage(dto.scope),
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`CRITICAL: System reset failed (scope=${dto.scope}): ${error?.message || error}`, error?.stack);
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_FAILURE',
        details: { scope: dto.scope, reason, error: String(error?.message || error) },
        status: 'FAILED',
      });
      throw error;
    }
  }

  private buildSuccessMessage(scope: SystemResetScope): string {
    switch (scope) {
      case 'audit':
        return 'تم مسح سجلات التدقيق بنجاح.';
      case 'inventory':
        return 'تم تصفير بيانات المخزون (الأصناف والحركات والأرصدة) بنجاح.';
      case 'data':
        return 'تم تصفير جميع البيانات مع الاحتفاظ بالمستخدمين والصلاحيات وإعدادات الشركة.';
      case 'full':
      default:
        return 'تم إعادة ضبط النظام بالكامل. تم الإبقاء على أول SuperAdmin فقط لتجنب فقدان الوصول.';
    }
  }
}

