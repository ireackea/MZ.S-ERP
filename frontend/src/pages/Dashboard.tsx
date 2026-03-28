// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, DollarSign, Package, Printer, RefreshCw, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@services/toastService';
import { useSession } from '@hooks/useSession';
import { useInventoryStore } from '../store/useInventoryStore';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const items = useInventoryStore((state) => state.items);
  const transactions = useInventoryStore((state) => state.transactions);
  const users = useInventoryStore((state) => state.users);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const exportPdfReport = useInventoryStore((state) => state.exportPdfReport);
  const loading = useInventoryStore((state) => state.loading || state.syncing);
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lastLoadedAt) {
      void refresh();
    }
  }, [lastLoadedAt]);

  const refresh = async () => {
    try {
      setError(null);
      await loadAll();
    } catch (err: any) {
      console.warn('[DashboardPage] Store sync failed:', err);
      setError(err?.message || 'تعذر مزامنة البيانات من الخادم.');
    }
  };

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayTransactions = transactions.filter((transaction) => String(transaction.date || '').slice(0, 10) === today);
    const lowStockItems = items.filter((item) => Number(item.currentStock || 0) <= Number(item.minLimit || 0));
    const recentActivity = [...transactions]
      .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0))
      .slice(0, 5)
      .map((transaction) => ({
        id: String(transaction.id),
        date: transaction.date,
        action: transaction.type,
        user: users.find((user) => user.id === transaction.createdByUserId)?.name || transaction.supplierOrReceiver || 'مستخدم النظام',
        amount: Number(transaction.quantity || 0),
        item: items.find((item) => String(item.id) === String(transaction.itemId))?.name || String(transaction.itemId),
      }));

    return {
      totalItems: items.length,
      lowStock: lowStockItems.length,
      todayTransactions: todayTransactions.length,
      totalRevenue: items.reduce((sum, item) => sum + Number(item.currentStock || 0) * Number(item.orderLimit || item.maxLimit || 0), 0),
      recentActivity,
      alerts: lowStockItems.slice(0, 4).map((item) => ({
        id: String(item.id),
        message: `تحذير: \"${item.name}\" وصل إلى الحد الأدنى أو دونه (${Number(item.currentStock || 0)} ${item.unit} متبقي)`,
      })),
    };
  }, [items, transactions, users]);

  const handlePrintDashboardPdf = async () => {
    try {
      await exportPdfReport({
        endpoint: '/reports/print',
        payload: {
          title: 'Dashboard Snapshot',
          subtitle: 'Executive metrics and recent activity',
          generatedBy: String(session?.user?.name || session?.user?.username || 'Dashboard User'),
          filename: `dashboard-${new Date().toISOString().slice(0, 10)}`,
          columns: [
            { key: 'date', label: 'Date', align: 'left' as const },
            { key: 'action', label: 'Action', align: 'left' as const },
            { key: 'user', label: 'User', align: 'left' as const },
            { key: 'item', label: 'Item', align: 'left' as const },
            { key: 'amount', label: 'Amount', align: 'right' as const },
          ],
          summary: [
            { label: 'Total Items', value: String(stats.totalItems) },
            { label: 'Low Stock', value: String(stats.lowStock) },
            { label: 'Today Transactions', value: String(stats.todayTransactions) },
            { label: 'Total Revenue', value: String(stats.totalRevenue) },
          ],
          rows: stats.recentActivity.map((entry) => ({
            date: entry.date,
            action: entry.action,
            user: entry.user,
            item: entry.item || '-',
            amount: entry.amount ?? 0,
          })),
        },
        fileName: `dashboard-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success('تم إنشاء وتحميل تقرير PDF بنجاح');
    } catch (error: any) {
      toast.error(error?.message || 'حدث خطأ غير متوقع أثناء طباعة لوحة التحكم.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">لوحة التحكم</h1>
          <p className="mt-2 text-sm text-slate-500">عرض تشغيلي مباشر مبني بالكامل على بيانات Zustand الحالية.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrintDashboardPdf} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"><Printer size={16} />طباعة PDF</button>
          <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />تحديث</button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'إجمالي الأصناف', value: stats.totalItems, icon: Package },
          { label: 'أصناف عند الحد الأدنى', value: stats.lowStock, icon: AlertTriangle },
          { label: 'حركات اليوم', value: stats.todayTransactions, icon: TrendingUp },
          { label: 'القيمة التقديرية للمخزون', value: stats.totalRevenue, icon: DollarSign },
        ].map((card) => (
          <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-500">{card.label}</div>
              <card.icon size={20} className="text-slate-400" />
            </div>
            <div className="mt-5 text-4xl font-black text-slate-900">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-xl font-black text-slate-900">آخر النشاطات</div>
          <div className="space-y-3">
            {stats.recentActivity.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">لا توجد نشاطات حديثة بعد.</div>
            ) : stats.recentActivity.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-slate-900">{entry.action}</div>
                  <div className="text-xs text-slate-500">{entry.date}</div>
                </div>
                <div className="mt-2 text-sm text-slate-600">{entry.user} • {entry.item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 text-xl font-black text-slate-900">تنبيهات المخزون</div>
          <div className="space-y-3">
            {stats.alerts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">لا توجد تنبيهات حرجة حاليًا.</div>
            ) : stats.alerts.map((alert) => (
              <div key={alert.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{alert.message}</div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { label: 'الأصناف', path: '/items' },
              { label: 'الحركات', path: '/operations' },
              { label: 'التقارير', path: '/reports' },
              { label: 'الإعدادات', path: '/settings' },
            ].map((action) => (
              <button key={action.path} onClick={() => navigate(action.path)} className="rounded-2xl border border-slate-200 px-4 py-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50">{action.label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;