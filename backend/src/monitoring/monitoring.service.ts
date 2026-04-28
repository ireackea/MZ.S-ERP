// ENTERPRISE FIX: Phase 0 – Critical Security & Encoding Lockdown - 2026-03-13
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseInfrastructureService } from '../database/database-infrastructure.service';
import { PrismaService } from '../prisma.service';
import { ClientLogDto } from './dto/client-log.dto';
import { SystemResetDto } from './dto/system-reset.dto';

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

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private static readonly RESET_MAX_INVALID_ATTEMPTS = 3;
  private static readonly RESET_BLOCK_WINDOW_MS = 10 * 60 * 1000;
  private static readonly RESET_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
  private readonly resetAttemptTracker = new Map<string, ResetAttemptState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly databaseInfrastructure: DatabaseInfrastructureService,
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

  async performSystemReset(dto: SystemResetDto, user: any) {
    const now = Date.now();
    this.pruneResetAttemptTracker(now);

    const actorKey = this.getResetActorKey(user);
    const actorLabel = this.getResetActorLabel(user);
    const actorRole = String(user?.role || '').trim();

    this.logger.warn(`SYSTEM RESET REQUESTED by user ${actorLabel}`);

    // Role check first to avoid confirmation token probing by non-SuperAdmin actors.
    if (actorRole !== 'SuperAdmin') {
      this.logger.warn(`Rejected reset attempt by non-SuperAdmin user ${actorLabel} (role: ${actorRole || 'unknown'})`);
      throw new UnauthorizedException({
        code: 'SYSTEM_RESET_SUPERADMIN_REQUIRED',
        message: 'غير مصرح بتنفيذ إعادة الضبط. هذا الإجراء متاح فقط لدور SuperAdmin.',
      });
    }

    this.assertResetAttemptAllowed(actorKey, actorLabel, now);

    // SECURITY FIX: Strict validation using SYSTEM_RESET_TOKEN from environment
    const expectedToken = this.getSystemResetToken();
    if (dto.confirmationCode !== expectedToken) {
      const state = this.registerInvalidResetAttempt(actorKey, now);
      const blockedUntil = state.blockedUntil > 0 ? new Date(state.blockedUntil).toISOString() : 'none';
      this.logger.warn(`Invalid reset attempt by user ${actorLabel}; blockedUntil=${blockedUntil}`);

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

    this.clearResetAttemptState(actorKey);

    try {
      this.logger.log('Starting full system reset (Truncating operational tables)...');
      
      // Execute reset in a transaction for atomicity
      await this.prisma.$transaction([
        this.prisma.transaction.deleteMany({}),
        this.prisma.openingBalance.deleteMany({}),
        this.prisma.item.deleteMany({}),
        // Preserve Users and Roles to prevent complete lockout
      ]);

      this.logger.log('System reset completed successfully.');

      return {
        success: true,
        message: 'تم تصفير جميع بيانات النظام والمخزون بنجاح. النظام جاهز للتهيئة الجديدة.',
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      this.logger.error('CRITICAL: System reset failed:', error.stack);
      throw error;
    }
  }
}

