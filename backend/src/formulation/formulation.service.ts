import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { SaveFormulationDto } from './dto/save-formulation.dto';

type ActorContext = {
  userId?: string;
  actorUsername?: string;
};

type NormalizedFormulationItemInput = {
  itemId: number;
  percentage: number;
  weightPerTon: number;
};

@Injectable()
export class FormulationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    const rows = await this.prisma.formulation.findMany({
      include: {
        items: {
          orderBy: [{ item: { name: 'asc' } }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapFormulation(row));
  }

  async create(dto: SaveFormulationDto, actor: ActorContext = {}) {
    const input = await this.normalizeInput(dto, undefined);

    const created = await this.prisma.formulation.create({
      data: {
        code: input.code,
        name: input.name,
        targetItemId: input.targetItemId,
        expectedCostPerTon: input.expectedCostPerTon,
        notes: input.notes,
        isActive: input.isActive,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        items: {
          create: input.items.map((item) => ({
            itemId: item.itemId,
            percentage: item.percentage,
            weightPerTon: item.weightPerTon,
          })),
        },
      },
      include: {
        items: {
          orderBy: [{ item: { name: 'asc' } }, { createdAt: 'asc' }],
        },
      },
    });

    await this.auditService.logItemAction(
      actor.userId || 'system',
      'CREATE',
      'Formulation',
      created.id,
      { code: created.code, name: created.name, targetItemId: created.targetItemId, ingredients: created.items.length },
      actor.actorUsername,
    );
    this.emitFormulationSync('formulation.created', created.id);

    return this.mapFormulation(created);
  }

  async update(id: string, dto: SaveFormulationDto, actor: ActorContext = {}) {
    const formulationId = String(id || '').trim();
    if (!formulationId) {
      throw new BadRequestException('معرف التركيبة مطلوب.');
    }

    const existing = await this.prisma.formulation.findUnique({ where: { id: formulationId } });
    if (!existing) {
      throw new NotFoundException('التركيبة غير موجودة.');
    }

    const input = await this.normalizeInput(dto, existing.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.formulationItem.deleteMany({ where: { formulationId } });

      return tx.formulation.update({
        where: { id: formulationId },
        data: {
          code: input.code,
          name: input.name,
          targetItemId: input.targetItemId,
          expectedCostPerTon: input.expectedCostPerTon,
          notes: input.notes,
          isActive: input.isActive,
          updatedBy: actor.userId,
          items: {
            create: input.items.map((item) => ({
              itemId: item.itemId,
              percentage: item.percentage,
              weightPerTon: item.weightPerTon,
            })),
          },
        },
        include: {
          items: {
            orderBy: [{ item: { name: 'asc' } }, { createdAt: 'asc' }],
          },
        },
      });
    });

    await this.auditService.logItemAction(
      actor.userId || 'system',
      'UPDATE',
      'Formulation',
      updated.id,
      { code: updated.code, name: updated.name, targetItemId: updated.targetItemId, ingredients: updated.items.length },
      actor.actorUsername,
    );
    this.emitFormulationSync('formulation.updated', updated.id);

    return this.mapFormulation(updated);
  }

  async deleteMany(ids: string[], actor: ActorContext = {}) {
    const normalizedIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!normalizedIds.length) {
      return { deleted: 0, total: 0 };
    }

    const existing = await this.prisma.formulation.findMany({
      where: { id: { in: normalizedIds } },
      select: { id: true, code: true, name: true },
    });

    const deleted = await this.prisma.formulation.deleteMany({
      where: { id: { in: normalizedIds } },
    });

    if (deleted.count > 0) {
      await this.auditService.logItemAction(
        actor.userId || 'system',
        'DELETE',
        'Formulation',
        existing.map((row) => row.id).join(','),
        { deleted: deleted.count, formulas: existing },
        actor.actorUsername,
      );
      this.emitFormulationSync('formulation.deleted');
    }

    return { deleted: deleted.count, total: normalizedIds.length };
  }

  private async normalizeInput(dto: SaveFormulationDto, currentId?: string) {
    const name = String(dto.name || '').trim();
    if (!name) {
      throw new BadRequestException('اسم التركيبة مطلوب.');
    }

    const targetItemId = this.parseItemId(dto.targetItemId || dto.targetProductId, 'المنتج المستهدف');
    await this.ensureActiveItemExists(targetItemId, 'المنتج المستهدف');

    const items = await this.normalizeItems(dto.items);
    const code = await this.resolveCode(dto.code, currentId);
    const notes = String(dto.notes || '').trim() || null;
    const expectedCostPerTon = dto.expectedCostPerTon == null || !Number.isFinite(Number(dto.expectedCostPerTon))
      ? null
      : Number(dto.expectedCostPerTon);

    return {
      code,
      name,
      targetItemId,
      expectedCostPerTon,
      notes,
      isActive: dto.isActive !== false,
      items,
    };
  }

  private async normalizeItems(items: SaveFormulationDto['items']): Promise<NormalizedFormulationItemInput[]> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('يجب إضافة مكوّن واحد على الأقل.');
    }

    const normalized = items.map((item, index) => {
      const itemId = this.parseItemId(item?.itemId, `المكوّن رقم ${index + 1}`);
      const percentage = Number(item?.percentage || 0);
      if (!Number.isFinite(percentage) || percentage <= 0) {
        throw new BadRequestException(`نسبة المكوّن رقم ${index + 1} غير صالحة.`);
      }

      return {
        itemId,
        percentage: this.roundNumber(percentage),
        weightPerTon: this.roundNumber(percentage * 10),
      };
    });

    const uniqueItemIds = new Set(normalized.map((item) => item.itemId));
    if (uniqueItemIds.size !== normalized.length) {
      throw new BadRequestException('لا يمكن تكرار نفس المكوّن داخل التركيبة الواحدة.');
    }

    const total = normalized.reduce((sum, item) => sum + item.percentage, 0);
    if (Math.abs(total - 100) > 0.001) {
      throw new BadRequestException('يجب أن يكون مجموع نسب المكوّنات 100%.');
    }

    const existingItems = await this.prisma.item.findMany({
      where: {
        id: { in: [...uniqueItemIds] },
        isArchived: false,
      },
      select: { id: true },
    });
    if (existingItems.length !== uniqueItemIds.size) {
      throw new BadRequestException('بعض المكوّنات المحددة غير موجودة أو مؤرشفة.');
    }

    return normalized;
  }

  private parseItemId(value: unknown, fieldLabel: string) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldLabel} غير صالح.`);
    }
    return parsed;
  }

  private async ensureActiveItemExists(itemId: number, fieldLabel: string) {
    const exists = await this.prisma.item.findFirst({
      where: { id: itemId, isArchived: false },
      select: { id: true },
    });
    if (!exists) {
      throw new BadRequestException(`${fieldLabel} غير موجود أو مؤرشف.`);
    }
  }

  private async resolveCode(rawCode: string | undefined, currentId?: string) {
    const normalized = String(rawCode || '').trim().toUpperCase();

    if (!normalized) {
      return currentId ? (await this.getExistingCode(currentId)) : this.generateNextCode();
    }

    await this.ensureCodeIsUnique(normalized, currentId);
    return normalized;
  }

  private async getExistingCode(id: string) {
    const existing = await this.prisma.formulation.findUnique({
      where: { id },
      select: { code: true },
    });
    if (!existing) {
      throw new NotFoundException('التركيبة غير موجودة.');
    }
    return existing.code;
  }

  private async ensureCodeIsUnique(code: string, currentId?: string) {
    const duplicate = await this.prisma.formulation.findFirst({
      where: {
        code,
        ...(currentId ? { NOT: { id: currentId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('كود التركيبة مستخدم مسبقاً.');
    }
  }

  private async generateNextCode() {
    const latest = await this.prisma.formulation.findMany({
      where: { code: { startsWith: 'FRM-' } },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    let nextNumber = 1;
    for (const row of latest) {
      const match = /^FRM-(\d+)$/i.exec(String(row.code || '').trim());
      if (!match) continue;
      const candidate = Number.parseInt(match[1], 10);
      if (Number.isFinite(candidate)) {
        nextNumber = Math.max(nextNumber, candidate + 1);
      }
    }

    for (let index = nextNumber; index < nextNumber + 500; index += 1) {
      const candidate = `FRM-${String(index).padStart(4, '0')}`;
      const exists = await this.prisma.formulation.findFirst({ where: { code: candidate }, select: { id: true } });
      if (!exists) {
        return candidate;
      }
    }

    throw new BadRequestException('تعذر توليد كود فريد للتركيبة.');
  }

  private roundNumber(value: number) {
    return Number(value.toFixed(6));
  }

  private mapFormulation(row: {
    id: string;
    code: string;
    name: string;
    targetItemId: number;
    expectedCostPerTon: unknown;
    notes: string | null;
    isActive: boolean;
    items: Array<{
      itemId: number;
      percentage: unknown;
      weightPerTon: unknown;
    }>;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      targetProductId: String(row.targetItemId),
      targetItemId: String(row.targetItemId),
      expectedCostPerTon: row.expectedCostPerTon == null ? undefined : Number(row.expectedCostPerTon),
      notes: row.notes || undefined,
      isActive: row.isActive,
      items: row.items.map((item) => ({
        itemId: String(item.itemId),
        percentage: Number(item.percentage),
        weightPerTon: Number(item.weightPerTon),
      })),
    };
  }

  private emitFormulationSync(event: string, formulationId?: string) {
    this.realtimeService.emitSync(
      ['formulation', 'dashboard'],
      event,
      { meta: formulationId ? { formulationId } : undefined },
    );
  }
}