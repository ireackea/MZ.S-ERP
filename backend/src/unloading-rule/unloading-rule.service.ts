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

    return {
      ruleName,
      allowedDurationMinutes: Math.trunc(allowedDurationMinutes),
      penaltyRatePerMinute,
      isActive: dto.is_active !== false,
    };
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