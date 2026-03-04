// ENTERPRISE FIX: Dashboard Backend Data Provider - 2026-02-26
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalItems, lowStockItems, todayTransactions, totalRevenue] = await Promise.all([
      this.prisma.item.count(),
      this.prisma.item.count({ where: { currentStock: { lte: 20 } } }),
      this.prisma.transaction.count({ where: { date: { gte: todayStart } } }),
      this.prisma.transaction.aggregate({ 
        _sum: { quantity: true }, 
        where: { date: { gte: todayStart } } 
      }),
    ]);

    const recentActivity = await this.prisma.transaction.findMany({
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
        action: t.type === 'IN' ? '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���"�7�"�7�"�7�"�#�⬑"�7�"�' : '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�',
        user: '7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�',
        amount: t.supplierNet ? Number(t.supplierNet) : undefined,
        item: t.item?.name || '7�"�7�"�7�"�#���7:7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�'
      })),
      alerts: lowStockItems > 0 ? [{ message: `7�"�7�"�7�"�#�⬑"�7�%7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#����� ${lowStockItems} 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"� 7�"�7�"�7�"�7�"�7�"�7�"�7�"�#�⬑"�#���9 7�"�7�"�7�"�#�⬑"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���"�7�"�7�"�7�"�#�⬑"�7�"�`, severity: 'high' }] : []
    };
  }
}
