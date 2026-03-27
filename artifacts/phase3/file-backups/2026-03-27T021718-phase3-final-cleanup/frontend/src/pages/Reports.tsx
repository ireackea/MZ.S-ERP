// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Filter, RefreshCw } from 'lucide-react';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../store/useInventoryStore';

type ReportType = 'inventory' | 'movements';

const formatDate = (value: string) => String(value || '').slice(0, 10);

const ReportsPage: React.FC = () => {
  const items = useInventoryStore((state) => state.items);
  const transactions = useInventoryStore((state) => state.transactions);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const exportRowsToExcel = useInventoryStore((state) => state.exportRowsToExcel);
  const exportPdfReport = useInventoryStore((state) => state.exportPdfReport);
  const reportConfig = useInventoryStore((state) => state.reportConfig);
  const loading = useInventoryStore((state) => state.loading || state.syncing);
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);

  const [reportType, setReportType] = useState<ReportType>('movements');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  useEffect(() => {
    if (!lastLoadedAt) {
      void loadAll();
    }
  }, [lastLoadedAt, loadAll]);

  const inventoryRows = useMemo(() => items.map((item) => ({
    itemId: String(item.id),
    itemCode: item.code || '-',
    itemName: item.name,
    currentStock: Number(item.currentStock || 0),
    category: item.category,
    unit: item.unit,
  })), [items]);

  const movementRows = useMemo(() => transactions.map((transaction) => {
    const item = items.find((entry) => String(entry.id) === String(transaction.itemId));
    return {
      id: String(transaction.id),
      date: String(transaction.date || ''),
      itemId: String(transaction.itemId || ''),
      itemCode: item?.code || '-',
      itemName: item?.name || String(transaction.itemId || '-'),
      type: String(transaction.type || ''),
      quantity: Number(transaction.quantity || 0),
      supplierOrReceiver: String(transaction.supplierOrReceiver || '-'),
      warehouseInvoice: String(transaction.warehouseInvoice || '-'),
    };
  }), [transactions, items]);

  const activeRows = useMemo(() => {
    const baseRows = reportType === 'inventory' ? inventoryRows : movementRows;
    return baseRows.filter((row: any) => {
      const rowDate = reportType === 'movements' ? formatDate(row.date) : '';
      const dateOk = reportType !== 'movements' || ((!dateFrom || rowDate >= dateFrom) && (!dateTo || rowDate <= dateTo));
      const itemOk = !selectedItemIds.length || selectedItemIds.includes(String(row.itemId));
      return dateOk && itemOk;
    });
  }, [reportType, inventoryRows, movementRows, dateFrom, dateTo, selectedItemIds]);

  const summary = useMemo(() => {
    if (reportType === 'inventory') {
      return {
        totalRows: activeRows.length,
        totalQuantity: activeRows.reduce((sum: number, row: any) => sum + Number(row.currentStock || 0), 0),
      };
    }
    return {
      totalRows: activeRows.length,
      totalQuantity: activeRows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0),
      totalIn: activeRows.filter((row: any) => row.type === 'وارد').reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0),
      totalOut: activeRows.filter((row: any) => row.type === 'صادر').reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0),
    };
  }, [reportType, activeRows]);

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  };

  const handleReset = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedItemIds([]);
    setReportType('movements');
  };

  const exportExcel = async () => {
    if (!activeRows.length) {
      toast.error('لا توجد بيانات لتصديرها.');
      return;
    }
    await exportRowsToExcel({
      fileName: `reports-${reportType}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: 'Reports',
      rows: activeRows as Array<Record<string, unknown>>,
    });
    toast.success('تم تصدير التقرير إلى Excel بنجاح.');
  };

  const exportPdf = async () => {
    if (!activeRows.length) {
      toast.error('لا توجد بيانات لتصديرها.');
      return;
    }
    await exportPdfReport({
      endpoint: '/reports/print',
      payload: {
        title: reportType === 'inventory' ? 'Inventory Report' : 'Movements Report',
        subtitle: `Generated at ${new Date().toISOString()}`,
        generatedBy: 'MZ.S-ERP Reports',
        filename: `reports-${reportType}-${new Date().toISOString().slice(0, 10)}`,
        columns: (reportType === 'inventory'
          ? reportConfig.filter((column) => column.isVisible).map((column) => ({ key: column.key, label: column.label, align: 'left' as const }))
          : [
              { key: 'date', label: 'Date', align: 'left' as const },
              { key: 'itemCode', label: 'Item Code', align: 'left' as const },
              { key: 'itemName', label: 'Item', align: 'left' as const },
              { key: 'type', label: 'Type', align: 'left' as const },
              { key: 'quantity', label: 'Quantity', align: 'right' as const },
            ]),
        summary: Object.entries(summary).map(([label, value]) => ({ label, value: String(value) })),
        rows: activeRows,
      },
      fileName: `reports-${reportType}-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
    toast.success('تم تصدير التقرير إلى PDF بنجاح.');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900">التقارير</h1>
            <p className="mt-2 text-sm text-slate-500">تقارير ناتجة من حالة Zustand فقط دون أي استعلامات محلية موازية أو fallback.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void loadAll()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />تحديث</button>
            <button onClick={handleReset} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"><Filter size={16} />إعادة ضبط</button>
            <button onClick={() => void exportExcel()} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"><Download size={16} />Excel</button>
            <button onClick={() => void exportPdf()} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"><FileText size={16} />PDF</button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            <span>نوع التقرير</span>
            <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)} className="w-full rounded-2xl border border-slate-300 px-4 py-3">
              <option value="movements">تقرير الحركات</option>
              <option value="inventory">تقرير المخزون</option>
            </select>
          </label>

          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            <span>من تاريخ</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" disabled={reportType === 'inventory'} />
          </label>

          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            <span>إلى تاريخ</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3" disabled={reportType === 'inventory'} />
          </label>

          <div>
            <div className="mb-2 text-sm font-semibold text-slate-700">الأصناف</div>
            <div className="max-h-72 space-y-2 overflow-auto rounded-2xl border border-slate-200 p-3">
              {items.map((item) => (
                <label key={item.id} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                  <span>{item.name}</span>
                  <input type="checkbox" checked={selectedItemIds.includes(String(item.id))} onChange={() => toggleItem(String(item.id))} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">عدد السجلات</div><div className="mt-3 text-3xl font-black text-slate-900">{summary.totalRows || 0}</div></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">إجمالي الكمية</div><div className="mt-3 text-3xl font-black text-slate-900">{Number(summary.totalQuantity || 0).toFixed(3)}</div></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">صافي الوارد/الصادر</div><div className="mt-3 text-3xl font-black text-slate-900">{Number((summary.totalIn || 0) - (summary.totalOut || 0)).toFixed(3)}</div></div>
          </div>

          <div className="overflow-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[840px] text-right text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  {reportType === 'inventory' ? (
                    <>
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">الصنف</th>
                      <th className="px-4 py-3">الفئة</th>
                      <th className="px-4 py-3">الوحدة</th>
                      <th className="px-4 py-3">الرصيد الحالي</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3">التاريخ</th>
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">الصنف</th>
                      <th className="px-4 py-3">النوع</th>
                      <th className="px-4 py-3">الكمية</th>
                      <th className="px-4 py-3">المورد/المستلم</th>
                      <th className="px-4 py-3">رقم الفاتورة</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {activeRows.length === 0 ? (
                  <tr><td colSpan={reportType === 'inventory' ? 5 : 7} className="px-4 py-8 text-center text-slate-500">لا توجد بيانات مطابقة للمرشحات الحالية.</td></tr>
                ) : activeRows.map((row: any) => (
                  <tr key={row.id || row.itemId} className="border-t border-slate-100">
                    {reportType === 'inventory' ? (
                      <>
                        <td className="px-4 py-3">{row.itemCode}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.itemName}</td>
                        <td className="px-4 py-3">{row.category}</td>
                        <td className="px-4 py-3">{row.unit}</td>
                        <td className="px-4 py-3">{Number(row.currentStock || 0).toFixed(3)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3">{row.date}</td>
                        <td className="px-4 py-3">{row.itemCode}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.itemName}</td>
                        <td className="px-4 py-3">{row.type}</td>
                        <td className="px-4 py-3">{Number(row.quantity || 0).toFixed(3)}</td>
                        <td className="px-4 py-3">{row.supplierOrReceiver}</td>
                        <td className="px-4 py-3">{row.warehouseInvoice}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;