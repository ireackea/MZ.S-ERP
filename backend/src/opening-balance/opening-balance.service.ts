// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { BulkUpdateBalanceDto } from './dto/bulk-update-balance.dto';

@Injectable()
export class OpeningBalanceService {
  constructor(private prisma: PrismaService) {}

  async setBalance(dto: CreateOpeningBalanceDto) {
    const item = await this.prisma.item.findFirst({
      where: { publicId: dto.itemPublicId },
    });
    if (!item) throw new NotFoundException('Item not found for provided publicId');

    try {
      return await this.prisma.openingBalance.upsert({
        where: {
          itemId_financialYear: {
            itemId: item.id,
            financialYear: dto.financialYear,
          },
        },
        update: { quantity: dto.quantity, unitCost: dto.unitCost },
        create: {
          itemId: item.id,
          financialYear: dto.financialYear,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
        },
      });
    } catch (error: any) {
      if (String(error?.message || '').includes('Unique constraint')) {
        throw new ConflictException('Opening balance already exists for this item and year.');
      }
      throw error;
    }
  }

  async getBalancesByYear(year: number) {
    const [items, balances] = await Promise.all([
      this.prisma.item.findMany({
        select: {
          id: true,
          name: true,
          publicId: true,
          code: true,
          unit: true,
          category: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.openingBalance.findMany({
        where: { financialYear: year },
        include: {
          item: {
            select: {
              name: true,
              publicId: true,
              code: true,
              unit: true,
              category: true,
            },
          },
        },
      }),
    ]);

    const byItemId = new Map(balances.map((b) => [b.itemId, b]));

    return items.map((item) => {
      const existing = byItemId.get(item.id);
      if (existing) {
        return {
          id: existing.id,
          itemId: existing.itemId,
          itemPublicId: item.publicId ?? undefined,
          financialYear: existing.financialYear,
          quantity: Number(existing.quantity),
          unitCost: existing.unitCost == null ? null : Number(existing.unitCost),
          item: {
            name: existing.item?.name ?? item.name,
            publicId: existing.item?.publicId ?? item.publicId ?? undefined,
            code: existing.item?.code ?? item.code ?? undefined,
            unit: existing.item?.unit ?? item.unit ?? undefined,
            category: existing.item?.category ?? item.category ?? undefined,
          },
        };
      }

      // 7"7"7"7"7"7"7"7" 7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7" 7"7"7"#⬑"#9 7"7"7"#⬑"#9 7"7"7"7"7"7"7"#⬑"7"7"7"7"7" 7"7"7"7"7"7"7"7"7"7"7"#"7"7"7"#⬑"7" 7"7"7"7"7"7"7"7"7"7"7"7"7"7"7"7" 7"7"7"#⬑"7"7"7"7"7"7"7"7"7"7"7"7"#⬑"#9  7"7"7"7"7"7"7"7"7"7"7"7"
      return {
        id: -item.id,
        itemId: item.id,
        itemPublicId: item.publicId ?? undefined,
        financialYear: year,
        quantity: 0,
        unitCost: null,
        item: {
          name: item.name,
          publicId: item.publicId ?? undefined,
          code: item.code ?? undefined,
          unit: item.unit ?? undefined,
          category: item.category ?? undefined,
        },
      };
    });
  }

  async bulkUpsert(dto: BulkUpdateBalanceDto) {
    if (!dto.bulk || dto.bulk.length === 0) return { synced: 0, errors: [] };

    const publicIds = Array.from(new Set(dto.bulk.map((b) => b.itemPublicId)));
    const items = await this.prisma.item.findMany({
      where: { publicId: { in: publicIds } },
      select: { id: true, publicId: true },
    });
    const map = new Map(items.map((i) => [i.publicId, i.id]));

    const results: { ok: boolean; msg?: string }[] = [];

    for (const entry of dto.bulk) {
      const itemId = map.get(entry.itemPublicId);
      if (!itemId) {
        results.push({ ok: false, msg: `Item not found for publicId=${entry.itemPublicId}` });
        continue;
      }
      try {
        await this.prisma.openingBalance.upsert({
          where: {
            itemId_financialYear: { itemId, financialYear: entry.financialYear },
          },
          update: { quantity: entry.quantity, unitCost: entry.unitCost },
          create: {
            itemId,
            financialYear: entry.financialYear,
            quantity: entry.quantity,
            unitCost: entry.unitCost,
          },
        });
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false, msg: String(e) });
      }
    }

    return {
      synced: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      errors: results.filter((r) => !r.ok).map((r) => r.msg),
    };
  }
}
