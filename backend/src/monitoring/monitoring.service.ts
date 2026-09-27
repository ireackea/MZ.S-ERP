// ENTERPRISE FIX: Phase 7 - Advanced System Reset Module with Multi-Layer Security - 2026-04-29
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
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

type ResetStage = 'inventory' | 'operational' | 'audit' | 'identity';

type ResetTarget = {
  table: string;
  stage: ResetStage;
  model: string;
};

type ResetTableReport = {
  table: string;
  rowsDeleted: number;
};

type ResetReport = {
  scope: SystemResetScope;
  tablesAffected: ResetTableReport[];
  /** Models the reset looked for and the schema no longer has. Reported, not
   *  counted as affected — the previous version listed these as cleared. */
  absentModels: string[];
  keptSuperAdminId: string | null;
};

/**
 * The order of the reset's deletes, in one place, because the order is the
 * contract. It mirrors the foreign keys in the schema and nothing else.
 *
 * `Item` is RESTRICTed by six tables. Clearing two of them and then deleting
 * Item meant any stocktake entry or recorded deficit rolled the entire
 * transaction back, which surfaced to the operator as a bare 500 after the UI
 * had taken their password, a one-time challenge and a written reason.
 *
 * A test replays this list against the live schema inside a rolled-back
 * transaction, so a table added to the schema without being placed here fails
 * a test rather than an operator's reset.
 *
 * `model` is resolved at run time, not through the typed client: several of
 * these models were removed from the schema, and the previous version reached
 * for them with `?.deleteMany?.()` inside a try/catch, then reported them as
 * cleared. A model that is gone is now reported as absent.
 */
export const RESET_TARGETS: ResetTarget[] = [
      // The stocktake tree cascades session -> entries -> counts, but each is
      // listed explicitly so its row count reaches the report.
      { table: 'StocktakingCount', stage: 'inventory', model: 'stocktakingCount' },
      { table: 'StocktakingEntry', stage: 'inventory', model: 'stocktakingEntry' },
      { table: 'StocktakingSession', stage: 'inventory', model: 'stocktakingSession' },
      // The deficit ledger: the authority on negative stock, and RESTRICT on
      // Item. Omitting it is exactly what made every reset fail.
      { table: 'StockDeficit', stage: 'inventory', model: 'stockDeficit' },
      { table: 'FormulationItem', stage: 'inventory', model: 'formulationItem' },
      { table: 'Formulation', stage: 'inventory', model: 'formulation' },
      { table: 'Transaction', stage: 'inventory', model: 'transaction' },
      { table: 'OpeningBalance', stage: 'inventory', model: 'openingBalance' },
      { table: 'UnloadingRule', stage: 'inventory', model: 'unloadingRule' },
      { table: 'Item', stage: 'inventory', model: 'item' },

      // Sales documents. Not inventory, but `order_items` is RESTRICT on Item,
      // so a scope that clears items and leaves order lines behind does not
      // produce a clean database — it produces orders pointing at nothing. They
      // are cleared together, and the scope's message says so.
      { table: 'OrderItem', stage: 'operational', model: 'orderItem' },
      { table: 'Order', stage: 'operational', model: 'order' },

      { table: 'AuditLog', stage: 'audit', model: 'auditLog' },
      { table: 'ActiveSession', stage: 'audit', model: 'activeSession' },

      { table: 'Invitation', stage: 'identity', model: 'invitation' },
];

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
  // FC-SEC-003: the long-lived SYSTEM_RESET_TOKEN shared secret is gone. A reset
  // now requires the acting SuperAdmin to re-enter their own password, which the
  // backend verifies against the stored bcrypt hash. No secret is ever typed
  // into, or held by, the browser.
  private async assertResetReauthenticated(user: any, confirmationCode: string): Promise<boolean> {
    const userId = String(user?.id || '').trim();
    if (!userId) return false;

    const record = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!record?.passwordHash) return false;

    const candidate = String(confirmationCode || '');
    if (!candidate) return false;

    return bcrypt.compare(candidate, record.passwordHash);
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

  /**
   * A table the reset may clear, and the scope stage it belongs to.
   *
   * `model` is resolved at run time rather than through the typed client on
   * purpose. Several of these models were removed from the schema, and the
   * previous version reached for them with `?.deleteMany?.()` inside a
   * try/catch: the optional call was a no-op, the catch swallowed the outcome,
   * and the name was pushed to the report anyway. So the reset reported
   * clearing RolePermission and UserRole having touched neither. A target whose
   * model no longer exists is now reported as absent, not as affected.
   *
   * The order is the schema's order, and it is load-bearing.
   *
   * `Item` is RESTRICTed by six tables: StockDeficit, formulation_items,
   * formulations, order_items, stocktaking_entries (all RESTRICT) and
   * Transaction, OpeningBalance (CASCADE). The previous order cleared two of
   * those six and then deleted Item, so with any stocktake entry or recorded
   * deficit present the whole transaction rolled back and the operator got a
   * bare 500 — after the UI had already collected their password, a one-time
   * challenge and a written reason, and told them the data was about to be
   * destroyed permanently. Everything RESTRICTed on Item is now cleared first.
   */
  private getResetTargets(): ResetTarget[] {
    return RESET_TARGETS;
  }

  private resolveResetStages(scope: SystemResetScope): Set<ResetStage> {
    if (scope === 'audit') return new Set<ResetStage>(['audit']);
    if (scope === 'inventory') return new Set<ResetStage>(['inventory']);
    if (scope === 'data') return new Set<ResetStage>(['inventory', 'operational', 'audit']);
    return new Set<ResetStage>(['inventory', 'operational', 'audit', 'identity']);
  }

  private async executeScopedReset(scope: SystemResetScope): Promise<ResetReport> {
    const stages = this.resolveResetStages(scope);
    const tablesAffected: ResetTableReport[] = [];
    const absentModels: string[] = [];
    let keptSuperAdminId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      // `full` keeps the oldest SuperAdmin so the system is not left with nobody
      // able to administer it. Which account that is gets reported, because it is
      // the first thing an operator asks afterwards.
      if (scope === 'full') {
        const superAdmins = await tx.user.findMany({
          where: { role: { is: { name: 'SuperAdmin' } } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true },
        });
        keptSuperAdminId = superAdmins[0]?.id ?? null;
      }

      // `inventory` does not clear sales documents, so it must refuse rather
      // than leave order lines pointing at deleted items. Refusing with a named
      // reason is the honest outcome; silently orphaning orders is not.
      if (scope === 'inventory') {
        const orderLineCount = await (tx as any).orderItem?.count?.();
        if (typeof orderLineCount === 'number' && orderLineCount > 0) {
          throw new ConflictException({
            code: 'SYSTEM_RESET_BLOCKED_BY_SALES',
            message:
              'لا يمكن تصفير المخزون لوجود فواتير بيع تشير إلى أصناف. '
              + 'استخدم نطاق "بيانات" الذي يمسح مستندات المبيعات أيضاً، أو احذف الفواتير أولاً.',
            detail: { orderItems: orderLineCount },
          });
        }
      }

      for (const target of this.getResetTargets()) {
        if (!stages.has(target.stage)) continue;

        const delegate = (tx as any)[target.model];
        if (!delegate || typeof delegate.deleteMany !== 'function') {
          absentModels.push(target.table);
          continue;
        }

        const { count } = await delegate.deleteMany({});
        tablesAffected.push({ table: target.table, rowsDeleted: Number(count ?? 0) });
      }

      // Users last. Many tables point at them, active_sessions and
      // idempotency_records cascade from them, and the one row that must not go
      // is the account that would otherwise administer the system.
      if (scope === 'full') {
        const { count } = await tx.user.deleteMany({
          where: keptSuperAdminId ? { NOT: { id: keptSuperAdminId } } : {},
        });
        tablesAffected.push({ table: 'User (except one SuperAdmin)', rowsDeleted: Number(count ?? 0) });
      }
    });

    return { scope, tablesAffected, absentModels, keptSuperAdminId };
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

    // 4) Re-authentication: the acting SuperAdmin must re-enter their password.
    const reauthenticated = await this.assertResetReauthenticated(user, dto.confirmationCode);
    if (!reauthenticated) {
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
        message: 'كلمة المرور غير صحيحة. يرجى إعادة إدخال كلمة مرور حسابك.',
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
      const report = await this.executeScopedReset(dto.scope);
      const summary = report.tablesAffected.map((entry) => `${entry.table}(${entry.rowsDeleted})`);
      this.logger.log(`Reset completed. Tables affected: ${summary.join(', ')}`);

      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_SUCCESS',
        details: {
          scope: dto.scope,
          reason,
          tablesAffected: report.tablesAffected,
          absentModels: report.absentModels,
          keptSuperAdminId: report.keptSuperAdminId,
          backupId,
          createBackup: dto.createBackup !== false,
        },
        status: 'SUCCESS',
      });

      return {
        success: true,
        scope: dto.scope,
        // Rows, not names. A name list is how a reset claims to have cleared a
        // table it never touched.
        tablesAffected: report.tablesAffected,
        absentModels: report.absentModels,
        keptSuperAdminId: report.keptSuperAdminId,
        backupId,
        message: this.buildSuccessMessage(dto.scope, report),
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      const translated = this.translateResetFailure(error);
      this.logger.error(
        `CRITICAL: System reset failed (scope=${dto.scope}): ${translated.message}`,
        error?.stack,
      );
      await this.recordResetAudit({
        user,
        meta,
        action: 'SYSTEM_RESET_FAILURE',
        details: { scope: dto.scope, reason, error: translated.message, cause: translated.cause },
        status: 'FAILED',
      });
      throw translated.error;
    }
  }

  /**
   * A destructive operation that fails with a bare 500 teaches the operator
   * nothing and hides the one thing worth knowing: which table is still
   * referenced, and therefore which scope to use instead.
   *
   * That is not hypothetical here. `Item` is RESTRICTed by six tables, and the
   * reset cleared two of them, so a single stocktake entry or recorded deficit
   * rolled the whole transaction back and surfaced as
   * "Foreign key constraint violated on the constraint: StocktakingEntry_itemId_fkey"
   * inside a 500 body — an implementation detail dressed as a server fault.
   */
  private translateResetFailure(error: any): { error: any; message: string; cause: string } {
    if (error instanceof ConflictException) {
      const response = error.getResponse() as any;
      return {
        error,
        message: String(response?.message ?? error.message),
        cause: String(response?.code ?? 'CONFLICT'),
      };
    }

    const code = String(error?.code ?? '');
    const raw = String(error?.message ?? error);
    const isForeignKey = code === 'P2003' || /foreign key constraint/i.test(raw);

    if (isForeignKey) {
      const constraint = raw.match(/constraint:\s*`?([A-Za-z0-9_]+)`?/i)?.[1] ?? null;
      const childTable = constraint ? constraint.split('_')[0] : null;
      const message = childTable
        ? `تعذّر إتمام إعادة الضبط: الجداول "${childTable}" ما زالت تشير إلى سجلات لا يمكن حذفها. `
          + 'استخدم نطاق "بيانات" أو "كامل"، أو احذف السجلات المرتبطة أولاً.'
        : 'تعذّر إتمام إعادة الضبط: توجد سجلات مرتبطة تمنع الحذف.';

      return {
        error: new ConflictException({
          code: 'SYSTEM_RESET_BLOCKED_BY_REFERENCES',
          message,
          detail: { constraint },
        }),
        message: `${message} (${constraint ?? 'FK'})`,
        cause: constraint ?? 'P2003',
      };
    }

    return { error, message: raw, cause: code || 'UNKNOWN' };
  }

  /**
   * The message states what happened, including the part an operator is most
   * likely to be surprised by. The old text for `data` promised it would keep
   * users, roles and company settings while the scope silently deleted sales
   * documents it had never mentioned.
   */
  private buildSuccessMessage(scope: SystemResetScope, report?: ResetReport): string {
    const parts: string[] = [];

    switch (scope) {
      case 'audit':
        return 'تم مسح سجلات التدقيق والجلسات النشطة.';
      case 'inventory':
        parts.push('تم تصفير بيانات المخزون (الجرد، العجز، الحركات، الأرصدة، الصيغ، الأصناف).');
        break;
      case 'data':
        parts.push('تم تصفير جميع البيانات التشغيلية (المخزون + مستندات المبيعات).');
        parts.push('تم الاحتفاظ بالمستخدمين والأدوار وإعدادات الشركة.');
        break;
      case 'full':
      default:
        parts.push('تم إعادة ضبط النظام بالكامل.');
        parts.push(
          report?.keptSuperAdminId
            ? 'تم الإبقاء على حساب SuperAdmin واحد لتجنب فقدان الوصول.'
            : 'تحذير: لم يُعثر على حساب SuperAdmin للاحتفاظ به.',
        );
        break;
    }

    if (report?.absentModels?.length) {
      parts.push(`نماذج غير موجودة في قاعدة البيانات وتم تجاوزها: ${report.absentModels.join('، ')}.`);
    }

    return parts.join(' ');
  }
}

