import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { DeleteUnloadingRulesDto } from './dto/delete-unloading-rules.dto';
import { SaveUnloadingRuleDto } from './dto/save-unloading-rule.dto';

type ActorContext = {
  userId?: string;
  actorUsername?: string;
};

@Injectable()
export class UnloadingRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(options?: { includeInactive?: boolean }) {
    const rows = await this.prisma.unloadingRule.findMany({
      where: options?.includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { ruleName: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.mapRule(row));
  }

  async create(dto: SaveUnloadingRuleDto, actor: ActorContext = {}) {
    const input = await this.normalizeInput(dto);
    const created = await this.prisma.unloadingRule.create({
      data: {
        ruleName: input.ruleName,
        allowedDurationMinutes: input.allowedDurationMinutes,
        penaltyRatePerMinute: input.penaltyRatePerMinute,
        isActive: input.isActive,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
    });

    await this.auditService.logItemAction(
      actor.userId || 'system',
      'CREATE',
      'UnloadingRule',
      created.id,
      this.mapRule(created),
      actor.actorUsername,
    );
    this.emitSync('unloading-rule.created', created.id);

    return this.mapRule(created);
  }

  async update(id: string, dto: SaveUnloadingRuleDto, actor: ActorContext = {}) {
    const ruleId = String(id || '').trim();
    if (!ruleId) {
      throw new BadRequestException('معرف قاعدة التفريغ مطلوب.');
    }

    const existing = await this.prisma.unloadingRule.findUnique({ where: { id: ruleId } });
    if (!existing) {
      throw new NotFoundException('قاعدة التفريغ غير موجودة.');
    }

    const input = await this.normalizeInput(dto, existing.id);
    const updated = await this.prisma.unloadingRule.update({
      where: { id: ruleId },
      data: {
        ruleName: input.ruleName,
        allowedDurationMinutes: input.allowedDurationMinutes,
        penaltyRatePerMinute: input.penaltyRatePerMinute,
        isActive: input.isActive,
        updatedBy: actor.userId,
      },
    });

    await this.auditService.logItemAction(
      actor.userId || 'system',
      'UPDATE',
      'UnloadingRule',
      updated.id,
      this.mapRule(updated),
      actor.actorUsername,
    );
    this.emitSync('unloading-rule.updated', updated.id);

    return this.mapRule(updated);
  }

  async deleteMany(ids: DeleteUnloadingRulesDto['ids'], actor: ActorContext = {}) {
    const normalizedIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!normalizedIds.length) {
      return { deleted: 0, total: 0 };
    }

    const existing = await this.prisma.unloadingRule.findMany({
      where: { id: { in: normalizedIds } },
      select: { id: true, ruleName: true },
    });
    if (existing.length !== normalizedIds.length) {
      throw new NotFoundException('بعض قواعد التفريغ المحددة غير موجودة.');
    }

    const linkedTransactions = await this.prisma.transaction.groupBy({
      by: ['unloadingRuleId'],
      where: { unloadingRuleId: { in: normalizedIds } },
      _count: { unloadingRuleId: true },
    });
    if (linkedTransactions.length > 0) {
      const usedRule = existing.find((row) => linkedTransactions.some((link) => link.unloadingRuleId === row.id));
      throw new BadRequestException(`لا يمكن حذف قاعدة التفريغ \"${usedRule?.ruleName || ''}\" لأنها مستخدمة في حركات سابقة.`);
    }

    const deleted = await this.prisma.unloadingRule.deleteMany({
      where: { id: { in: normalizedIds } },
    });

    if (deleted.count > 0) {
      await this.auditService.logItemAction(
        actor.userId || 'system',
        'DELETE',
        'UnloadingRule',
        existing.map((row) => row.id).join(','),
        { deleted: deleted.count, rules: existing },
        actor.actorUsername,
      );
      this.emitSync('unloading-rule.deleted');
    }

    return { deleted: deleted.count, total: normalizedIds.length };
  }

  private async normalizeInput(dto: SaveUnloadingRuleDto, currentId?: string) {
    const ruleName = String(dto.rule_name || '').trim();
    if (!ruleName) {
      throw new BadRequestException('اسم قاعدة التفريغ مطلوب.');
    }

    const allowedDurationMinutes = Number(dto.allowed_duration_minutes);
    if (!Number.isFinite(allowedDurationMinutes) || allowedDurationMinutes <= 0) {
      throw new BadRequestException('مدة السماح يجب أن تكون رقمًا موجبًا.');
    }

    const penaltyRatePerMinute = Number(dto.penalty_rate_per_minute);
    if (!Number.isFinite(penaltyRatePerMinute) || penaltyRatePerMinute < 0) {
      throw new BadRequestException('معدل الغرامة يجب أن يكون صفرًا أو رقمًا موجبًا.');
    }

    await this.ensureRuleNameIsUnique(ruleName, currentId);

    // Gate 4.1 - an absent `is_active` used to mean "true".
    //
    // `is_active` is @IsOptional, which advertises a partial update, and the
    // service collapsed "not sent" into "active". A client that PUT a new penalty
    // rate therefore silently re-enabled a rule an administrator had retired, and
    // it reappeared in every operator's dropdown. Deactivation is the only
    // supported way to retire a rule that historical transactions still reference,
    // so this undid the retirement by accident.
    //
    // `undefined` now means "leave it alone", and the field is omitted from the
    // patch so Prisma does not write it.
    // Spelled out rather than reusing the model's own union: the only thing that
    // changed is that `isActive` became conditional, and the rest keeps the exact
    // shape Prisma inferred before.
    return {
      ruleName,
      allowedDurationMinutes: Math.trunc(allowedDurationMinutes),
      penaltyRatePerMinute,
      ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
    };
  }

  /**
   * Gate 4.3 — the usage count, from the database, for every rule at once.
   *
   * The settings panel derived "in use" from `state.transactions`, which the store
   * loads with no pagination (the server's default page is 500), and the
   * reference-data panel derived it from `state.items`, which is hard-capped at
   * 1000. So past those thresholds a rule or a category that was genuinely
   * referenced showed "not in use", its Delete button was enabled, the operator
   * confirmed, and the server refused — or worse, the panel printed a wrong "N
   * movements" figure that the operator used to justify deleting something.
   *
   * One grouped count, no transfer, no truncation. `deleteMany` re-checks
   * server-side regardless, so this is about the gate being honest rather than
   * about safety: the banner said the deletion is blocked for referenced values,
   * and that was not what the code enforced.
   */
  async getUsageCounts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.transaction.groupBy({
      by: ['unloadingRuleId'],
      where: { unloadingRuleId: { not: null } },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of grouped) {
      if (row.unloadingRuleId) {
        counts[String(row.unloadingRuleId)] = Number(row._count?._all ?? 0);
      }
    }
    return counts;
  }

  private async ensureRuleNameIsUnique(ruleName: string, currentId?: string) {
    const rows = await this.prisma.unloadingRule.findMany({
      where: currentId ? { id: { not: currentId } } : undefined,
      select: { id: true, ruleName: true },
    });

    const duplicate = rows.find((row) => row.ruleName.trim().toLowerCase() === ruleName.toLowerCase());
    if (duplicate) {
      throw new BadRequestException('اسم قاعدة التفريغ مستخدم بالفعل.');
    }
  }

  private mapRule(row: {
    id: string;
    ruleName: string;
    allowedDurationMinutes: number;
    penaltyRatePerMinute: { toNumber?: () => number } | number;
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    const penaltyRatePerMinute = typeof row.penaltyRatePerMinute === 'number'
      ? row.penaltyRatePerMinute
      : row.penaltyRatePerMinute?.toNumber?.() ?? Number(row.penaltyRatePerMinute || 0);

    return {
      id: row.id,
      rule_name: row.ruleName,
      allowed_duration_minutes: row.allowedDurationMinutes,
      penalty_rate_per_minute: penaltyRatePerMinute,
      is_active: row.isActive,
      createdAt: row.createdAt?.toISOString(),
      updatedAt: row.updatedAt?.toISOString(),
    };
  }

  private emitSync(event: string, entityId?: string) {
    this.realtimeService.emitSync(
      ['operations', 'transactions', 'dashboard', 'settings'],
      event,
      { meta: entityId ? { entity: 'unloading-rule', entityId } : { entity: 'unloading-rule' } },
    );
  }
}