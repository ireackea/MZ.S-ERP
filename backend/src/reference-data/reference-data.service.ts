import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SaveReferenceDataValueDto } from './dto/save-reference-data-value.dto';

type ReferenceDataKind = 'category' | 'unit';
type ActorContext = {
  userId?: string;
  actorUsername?: string;
};

const KIND_LABELS: Record<ReferenceDataKind, string> = {
  category: 'القسم',
  unit: 'وحدة القياس',
};

@Injectable()
export class ReferenceDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    const [referenceRows, categoryRows, unitRows] = await Promise.all([
      this.prisma.referenceDataValue.findMany({
        where: { kind: { in: ['category', 'unit'] } },
        orderBy: [{ kind: 'asc' }, { value: 'asc' }],
      }),
      this.prisma.item.findMany({
        where: { isArchived: false },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.item.findMany({
        where: { isArchived: false },
        distinct: ['unit'],
        select: { unit: true },
        orderBy: { unit: 'asc' },
      }),
    ]);

    return {
      categories: this.uniqueSorted([
        ...referenceRows.filter((row) => row.kind === 'category').map((row) => row.value),
        ...categoryRows.map((row) => row.category),
      ]),
      units: this.uniqueSorted([
        ...referenceRows.filter((row) => row.kind === 'unit').map((row) => row.value),
        ...unitRows.map((row) => row.unit),
      ]),
    };
  }

  async createValue(kind: ReferenceDataKind, dto: SaveReferenceDataValueDto, actor: ActorContext = {}) {
    const value = this.normalizeValue(dto.value);
    this.assertValue(value, kind);
    await this.ensureValueIsNew(kind, value);

    const created = await this.prisma.referenceDataValue.create({
      data: {
        kind,
        value,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
    });

    await this.auditService.logItemAction(
      actor.userId || 'system',
      'CREATE',
      'ReferenceDataValue',
      created.id,
      { kind, value },
      actor.actorUsername,
    );
    this.emitSync('reference-data.created', kind, value);

    return this.findAll();
  }

  async deleteValue(kind: ReferenceDataKind, rawValue: string, actor: ActorContext = {}) {
    const value = this.normalizeValue(rawValue);
    this.assertValue(value, kind);

    const usageCount = await this.countItemUsage(kind, value);
    if (usageCount > 0) {
      throw new BadRequestException(`لا يمكن حذف ${KIND_LABELS[kind]} "${value}" لأنه مستخدم في ${usageCount} صنف.`);
    }

    const rows = await this.prisma.referenceDataValue.findMany({
      where: { kind },
      select: { id: true, value: true },
    });
    const targetIds = rows
      .filter((row) => this.key(row.value) === this.key(value))
      .map((row) => row.id);

    if (targetIds.length === 0) {
      throw new NotFoundException(`${KIND_LABELS[kind]} غير موجود.`);
    }

    const deleted = await this.prisma.referenceDataValue.deleteMany({
      where: { id: { in: targetIds } },
    });

    if (deleted.count > 0) {
      await this.auditService.logItemAction(
        actor.userId || 'system',
        'DELETE',
        'ReferenceDataValue',
        targetIds.join(','),
        { kind, value, deleted: deleted.count },
        actor.actorUsername,
      );
      this.emitSync('reference-data.deleted', kind, value);
    }

    return this.findAll();
  }

  private async ensureValueIsNew(kind: ReferenceDataKind, value: string) {
    const key = this.key(value);
    const existingRows = await this.prisma.referenceDataValue.findMany({
      where: { kind },
      select: { value: true },
    });

    if (existingRows.some((row) => this.key(row.value) === key)) {
      throw new BadRequestException(`${KIND_LABELS[kind]} موجود بالفعل.`);
    }

    const usageCount = await this.countItemUsage(kind, value);
    if (usageCount > 0) {
      throw new BadRequestException(`${KIND_LABELS[kind]} موجود بالفعل ضمن الأصناف.`);
    }
  }

  private async countItemUsage(kind: ReferenceDataKind, value: string) {
    const key = this.key(value);
    const rows = await this.prisma.item.findMany({
      where: { isArchived: false },
      select: kind === 'category' ? { category: true } : { unit: true },
    });

    return rows.filter((row) => {
      const current = kind === 'category' ? row.category : row.unit;
      return this.key(current) === key;
    }).length;
  }

  private assertValue(value: string, kind: ReferenceDataKind) {
    if (!value) {
      throw new BadRequestException(`${KIND_LABELS[kind]} مطلوب.`);
    }

    if (value.length > 120) {
      throw new BadRequestException(`${KIND_LABELS[kind]} يجب ألا يتجاوز 120 حرفًا.`);
    }
  }

  private normalizeValue(value: unknown) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  private uniqueSorted(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    return values
      .map((value) => this.normalizeValue(value))
      .filter(Boolean)
      .filter((value) => {
        const key = this.key(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, 'ar-EG', { numeric: true, sensitivity: 'base' }));
  }

  private key(value: unknown) {
    return this.normalizeValue(value).toLowerCase();
  }

  private emitSync(event: string, kind: ReferenceDataKind, value: string) {
    this.realtimeService.emitSync(
      ['items', 'operations', 'settings'],
      event,
      { meta: { entity: 'reference-data', kind, value } },
    );
  }
}