// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SyncItemDto } from './dto/sync-items.dto';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class ItemService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async syncItems(items: SyncItemDto[]) {
    const results = [];
    for (const item of items) {
      const normalizedCode =
        item.code == null || String(item.code).trim() === ''
          ? null
          : String(item.code).trim();

      const result = await this.prisma.item.upsert({
        where: { publicId: item.publicId },
        update: {
          barcode: item.barcode,
          name: item.name,
          unit: item.unit,
          category: item.category,
          minLimit: item.minLimit,
          maxLimit: item.maxLimit,
          orderLimit: item.orderLimit,
          currentStock: item.currentStock,
          description: item.description,
          ...(item.code !== undefined
            ? {
                code: normalizedCode,
                codeGenerated: false,
              }
            : {}),
        },
        create: {
          publicId: item.publicId,
          code: normalizedCode,
          codeGenerated: normalizedCode ? false : undefined,
          barcode: item.barcode,
          name: item.name,
          unit: item.unit,
          category: item.category || undefined,
          minLimit: item.minLimit ?? 0,
          maxLimit: item.maxLimit ?? 1000,
          orderLimit: item.orderLimit,
          currentStock: item.currentStock ?? 0,
          description: item.description,
        },
      });
      results.push(result);
    }
    if (results.length > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.synced',
        { meta: { count: results.length } },
      );
    }
    return { synced: results.length, total: items.length };
  }

  async getAll() {
    const rows = await this.prisma.item.findMany({
      select: {
        id: true,
        publicId: true,
        code: true,
        barcode: true,
        name: true,
        unit: true,
        category: true,
        codeGenerated: true,
        minLimit: true,
        maxLimit: true,
        orderLimit: true,
        currentStock: true,
        description: true,
      },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => ({
      ...row,
      minLimit: row.minLimit == null ? null : Number(row.minLimit),
      maxLimit: row.maxLimit == null ? null : Number(row.maxLimit),
      orderLimit: row.orderLimit == null ? null : Number(row.orderLimit),
      currentStock: row.currentStock == null ? null : Number(row.currentStock),
    }));
  }

  async deleteByPublicIds(publicIds: string[]) {
    const cleaned = Array.from(new Set(publicIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!cleaned.length) return { deleted: 0, total: 0 };

    const deleted = await this.prisma.item.deleteMany({
      where: { publicId: { in: cleaned } },
    });

    if (deleted.count > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.deleted',
        { meta: { count: deleted.count } },
      );
    }
    return { deleted: deleted.count, total: cleaned.length };
  }

  async generateMissingCodes() {
    const missingItems = await this.prisma.item.findMany({
      where: {
        OR: [{ code: null }, { code: '' }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (missingItems.length === 0) {
      return {
        success: 0,
        total: 0,
        sample: [],
      };
    }

    const now = new Date();
    const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const prefix = `ITEM-${dateKey}-`;

    const existingCodes = await this.prisma.item.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });

    let nextSequence =
      existingCodes.reduce((max, row) => {
        const value = String(row.code || '');
        const suffix = value.slice(prefix.length);
        const parsed = Number(suffix);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0) + 1;

    const generatedCodes = await this.prisma.$transaction(async (tx) => {
      const generated: string[] = [];
      for (const item of missingItems) {
        const code = `${prefix}${String(nextSequence).padStart(3, '0')}`;
        nextSequence += 1;
        await tx.item.update({
          where: { id: item.id },
          data: {
            code,
            codeGenerated: true,
          },
        });
        generated.push(code);
      }
      return generated;
    });

    if (generatedCodes.length > 0) {
      this.realtimeService.emitSync(
        ['items', 'dashboard', 'operations', 'formulation', 'stocktaking'],
        'items.codes.generated',
        { meta: { count: generatedCodes.length } },
      );
    }

    return {
      success: generatedCodes.length,
      total: missingItems.length,
      sample: generatedCodes.slice(0, 5),
      prefix,
    };
  }
}
