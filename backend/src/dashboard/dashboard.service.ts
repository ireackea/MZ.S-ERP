// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Dashboard Backend Data Provider - 2026-02-26
import { Injectable } from '@nestjs/common';
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

    const [totalItems, lowStockItems, todayTransactions, totalRevenue] = await Promise.all([
      this.prisma.item.count(),
      this.prisma.item.count({ where: { currentStock: { lte: 20 } } }),
      this.prisma.transaction.count({ where: { ...warehouseScopeCondition(scope), date: { gte: todayStart } } }),
      this.prisma.transaction.aggregate({ 
        _sum: { quantity: true }, 
        where: { ...warehouseScopeCondition(scope), date: { gte: todayStart } }
      }),
    ]);

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
