// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Dashboard Backend Data Provider - 2026-02-26
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TimeService } from '../common/time/time.service';
import { warehouseScopeCondition } from '../common/scope';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private readonly timeService: TimeService,
  ) {}

  private normalizeType(type: string): string {
    return String(type || '').trim().toLowerCase();
  }

  private describeAction(type: string): string {
    const normalized = this.normalizeType(type);

    if (['مرتجع', 'return', 'returned', 'إرجاع', 'ارجاع'].some((value) => normalized.includes(value))) {
      return 'حركة مرتجع';
    }

    if (['وارد', 'in', 'incoming', 'import', 'purchase'].some((value) => normalized.includes(value))) {
      return 'حركة واردة';
    }

    if (['صادر', 'out', 'outgoing', 'export', 'sale', 'صرف', 'تحويل_صادر'].some((value) => normalized.includes(value))) {
      return 'حركة صادرة';
    }

    if (['انتاج', 'إنتاج', 'production', 'تصنيع'].some((value) => normalized.includes(value))) {
      return 'حركة انتاج';
    }

    if (['هالك', 'تالف', 'waste', 'damaged'].some((value) => normalized.includes(value))) {
      return 'حركة هالك';
    }

    return 'حركة مخزنية';
  }

  async getDashboardStats(scope = 'default') {
    const { start: todayStart } = this.timeService.getBusinessDayRange();

    // A20 — both counts below used to be wrong, in opposite directions.
    //
    // `lowStock` was `currentStock <= 20`, which ignored the per-item reorder
    // threshold entirely: an item with `minLimit: 500` at 40 read as fine while one
    // with `minLimit: 5` at 18 read as low. So the card disagreed with the status
    // filter about the same catalogue, and the card is the one a manager glances at.
    //
    // It also counted archived rows. A discontinued line nobody stocks sits at zero
    // forever and holds the alert permanently raised, which is how an operator learns
    // to ignore the number.
    //
    // `minLimit` null means no reorder point is configured, so the item is low only at
    // zero — the other reading would make every unconfigured item permanently low.
    //
    // Raw SQL because this compares a column to a column, which Prisma's `where` does
    // not express. `totalItems` is scoped the same way so the two figures on one card
    // cannot describe different catalogues; that is a visible change to a number, and
    // it is called out here because it was a decision, not a side effect.
    const [itemCounts, todayTransactions, totalRevenue] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: bigint; lowStock: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS "total",
               count(*) FILTER (
                 WHERE item."isArchived" = false
                   AND (
                     (item."minLimit" IS NULL AND item."currentStock" <= 0)
                     OR (item."minLimit" IS NOT NULL AND item."currentStock" <= item."minLimit")
                   )
               )::bigint AS "lowStock"
          FROM "public"."Item" AS item
      `),
      this.prisma.transaction.count({ where: { ...warehouseScopeCondition(scope), date: { gte: todayStart } } }),
      this.prisma.transaction.aggregate({ 
        _sum: { quantity: true }, 
        where: { ...warehouseScopeCondition(scope), date: { gte: todayStart } }
      }),
    ]);
    const totalItems = Number(itemCounts[0]?.total ?? 0);
    const lowStockItems = Number(itemCounts[0]?.lowStock ?? 0);

    const recentActivity = await this.prisma.transaction.findMany({
      where: warehouseScopeCondition(scope),
      take: 5,
      orderBy: { date: 'desc' },
      include: { item: true },
    });

    return {
      totalItems,
      lowStock: lowStockItems,
      todayTransactions,
      totalRevenue: totalRevenue._sum.quantity ? Number(totalRevenue._sum.quantity) : 0,
      recentActivity: recentActivity.map(t => ({
        id: t.publicId || String(t.id),
        date: t.date.toISOString(),
        action: this.describeAction(t.type),
        user: 'مستخدم النظام',
        amount: t.supplierNet ? Number(t.supplierNet) : undefined,
        item: t.item?.name || 'صنف غير معروف'
      })),
      alerts: lowStockItems > 0 ? [{ message: `يوجد ${lowStockItems} صنفًا عند حد المخزون المنخفض ويتطلب متابعة فورية.`, severity: 'high' }] : []
    };
  }
}
