// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { BulkUpdateBalanceDto } from './dto/bulk-update-balance.dto';

type ActorContext = {
  id: string;
  username: string;
  role: string;
};

@Injectable()
export class OpeningBalanceService {
  private readonly auditService: AuditService;

  constructor(private prisma: PrismaService) {
    this.auditService = new AuditService(prisma);
  }

  /**
   * FC-SEC-011 — record who set an opening balance.
   *
   * `createdBy` existed in the schema and was never written, so the single most
   * audit-sensitive number in a warehouse system — the position a financial year
   * starts from — had no author and no editor. Combined with
   * `OpeningBalance.creator` having no `onDelete`, that produced a trap: the first
   * time someone implemented this the obvious way, `DELETE /users/:id` would
   * have started returning a 500 for every user who had ever set a balance.
   */
  async setBalance(dto: CreateOpeningBalanceDto, actor?: ActorContext) {
    const item = await this.prisma.item.findFirst({
      where: { publicId: dto.itemPublicId },
    });
    if (!item) throw new NotFoundException('Item not found for provided publicId');

    const before = await this.prisma.openingBalance.findUnique({
      where: { itemId_financialYear: { itemId: item.id, financialYear: dto.financialYear } },
    });

    const row = await this.prisma.openingBalance.upsert({
      where: {
        itemId_financialYear: {
          itemId: item.id,
          financialYear: dto.financialYear,
        },
      },
      // The original author is not overwritten on edit: it answers "who
      // introduced this figure", while the audit record below answers "who
      // changed it and when".
      update: { quantity: dto.quantity, unitCost: dto.unitCost },
      create: {
        itemId: item.id,
        financialYear: dto.financialYear,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        createdBy: actor?.id ?? null,
      },
    });

    await this.auditService.log({
      action: 'OPENING_BALANCE_SET',
      actorId: actor?.id ?? 'system',
      actorUsername: actor?.username ?? 'system',
      actorRole: actor?.role ?? 'system',
      targetResource: `opening-balances/${row.id}`,
      status: 'success',
      message: `${before ? 'Updated' : 'Set'} the ${dto.financialYear} opening balance for ${item.name}`,
      metadata: {
        item: item.name,
        financialYear: dto.financialYear,
        before: before ? { quantity: String(before.quantity), unitCost: before.unitCost == null ? null : String(before.unitCost) } : null,
        after: { quantity: String(row.quantity), unitCost: row.unitCost == null ? null : String(row.unitCost) },
      },
    }).catch(() => undefined);

    return row;
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
      // Selected so the response can follow the saved catalog order, like every
      // other section. The client re-sorts today, which hid the gap; an API
      // that returns the alphabet under a saved order is a contract that lies to
      // the next caller.
      sortOrder: true,
    },
    // The saved catalog order, not the alphabet. See ItemService.findAll.
    orderBy: [{ sortOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
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
          creator: { select: { id: true, username: true, firstName: true, lastName: true } },
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
          // FC-SEC-011 — a Decimal column read back through `Number()` is the
          // one place in the section that still crosses the exact-decimal
          // boundary on the way out. The value is serialised as a string; the
          // frontend legacy path still parses it, which is tracked separately.
          quantity: String(existing.quantity),
          unitCost: existing.unitCost == null ? null : String(existing.unitCost),
          createdBy: existing.creator
            ? {
              id: existing.creator.id,
              username: existing.creator.username,
              // `User` has no `fullName` column; the display name is composed the
              // same way UsersService.toUserDto composes it.
              fullName: [existing.creator.firstName, existing.creator.lastName]
                .filter(Boolean)
                .join(' ') || existing.creator.username,
            }
            : null,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
          item: {
            name: existing.item?.name ?? item.name,
            publicId: existing.item?.publicId ?? item.publicId ?? undefined,
            code: existing.item?.code ?? item.code ?? undefined,
            unit: existing.item?.unit ?? item.unit ?? undefined,
            category: existing.item?.category ?? item.category ?? undefined,
          },
        };
      }

      // ENTERPRISE FIX: synthesize a zero-balance fallback row when no opening balance exists for the item.
      return {
        id: -item.id,
        itemId: item.id,
        itemPublicId: item.publicId ?? undefined,
        financialYear: year,
        quantity: '0',
        unitCost: null,
        createdBy: null,
        createdAt: null,
        updatedAt: null,
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

  /**
   * FC-SEC-011 — one transaction, one audit record.
   *
   * The loop issued a separate upsert per row and committed each on its own, so
   * a failure halfway through left a financial year half-written with no record
   * of how far it got. A rejected item now rejects the whole upload, which is
   * the honest outcome for a year-opening figure.
   */
  async bulkUpsert(dto: BulkUpdateBalanceDto, actor?: ActorContext) {
    if (!dto.bulk || dto.bulk.length === 0) return { synced: 0, errors: [] };

    const publicIds = Array.from(new Set(dto.bulk.map((b) => b.itemPublicId)));
    const items = await this.prisma.item.findMany({
      where: { publicId: { in: publicIds } },
      select: { id: true, publicId: true, name: true },
    });
    const map = new Map(items.map((i) => [i.publicId, i]));

    const missing = dto.bulk.filter((entry) => !map.has(entry.itemPublicId));
    if (missing.length) {
      const unknown = missing.map((entry) => entry.itemPublicId);
      throw new BadRequestException(
        `These item references do not exist, so nothing was written: ${unknown.join(', ')}`,
      );
    }

    const years = Array.from(new Set(dto.bulk.map((entry) => entry.financialYear)));

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.bulk) {
        const item = map.get(entry.itemPublicId)!;
        await tx.openingBalance.upsert({
          where: {
            itemId_financialYear: { itemId: item.id, financialYear: entry.financialYear },
          },
          update: { quantity: entry.quantity, unitCost: entry.unitCost },
          create: {
            itemId: item.id,
            financialYear: entry.financialYear,
            quantity: entry.quantity,
            unitCost: entry.unitCost,
            createdBy: actor?.id ?? null,
          },
        });
      }
    });

    await this.auditService.log({
      action: 'OPENING_BALANCE_BULK_SET',
      actorId: actor?.id ?? 'system',
      actorUsername: actor?.username ?? 'system',
      actorRole: actor?.role ?? 'system',
      targetResource: `opening-balances/bulk/${years.join(',')}`,
      status: 'success',
      message: `Bulk set ${dto.bulk.length} opening balance(s) for ${years.join(', ')}`,
      metadata: { rows: dto.bulk.length, financialYears: years },
    }).catch(() => undefined);

    return { synced: dto.bulk.length, failed: 0, errors: [] };
  }
}
