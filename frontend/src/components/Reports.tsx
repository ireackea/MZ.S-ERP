// ENTERPRISE FIX: Phase 6.4 - Absolute Final Cleanup & 100% Verification - 2026-03-13
import React, { useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CalendarDays,
  Database,
  Download,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Warehouse,
} from 'lucide-react';
import { toast } from '@services/toastService';
import apiClient from '@api/client';
import { useInventoryStore } from '../store/useInventoryStore';

type ReportType = 'inventory' | 'movements';

type ItemRecord = {
  id: number;
  publicId?: string;
  code?: string;
  name: string;
};

type MovementRow = {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  type: string;
  quantity: number;
  warehouseId?: string;
  warehouseInvoice?: string;
  supplierOrReceiver?: string;
  notes?: string;
};

type InventoryRow = {
  itemId: string;
  itemName: string;
  itemCode: string;
  currentStock: number;
};

type ChartRow = {
  date?: string;
  label?: string;
  in?: number;
  out?: number;
  value?: number;
};

type GenerateResponse = {
  data: MovementRow[] | InventoryRow[];
  summary: {
    totalTransactions?: number;
    totalIn?: number;
    totalOut?: number;
    net?: number;
    itemCount?: number;
  };
  chartData: ChartRow[];
};

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const resolveExportErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const candidate = (error as { response?: { data?: { message?: string } }; message?: string });
    return candidate.response?.data?.message || candidate.message || fallback;
  }
  return fallback;
};

const Reports: React.FC = () => {
  const exportRowsToExcel = useInventoryStore((state) => state.exportRowsToExcel);
  const exportPdfReport = useInventoryStore((state) => state.exportPdfReport);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [reportType, setReportType] = useState<ReportType>('movements');
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedWarehouseIds, setSelectedWarehouseIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const [result, setResult] = useState<GenerateResponse>({
    data: [],
    summary: { totalTransactions: 0, totalIn: 0, totalOut: 0, net: 0, itemCount: 0 },
    chartData: [],
  });

  useEffect(() => {
    let mounted = true;

    const loadItems = async () => {
      try {
        const response = await apiClient.get('/items');
        const payload = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.data)
            ? response.data.data
            : [];
        if (!mounted) return;
        setItems(payload);
      } catch (error: any) {
        toast.error(error?.response?.data?.message || '7�7�7�7� 7�7�8&8y8 87�7�8&7� 7�87�7�8 7�8~');
      } finally {
        if (mounted) setBootLoading(false);
      }
    };

    void loadItems();
    return () => {
      mounted = false;
    };
  }, []);

  const fetchReport = async (showSuccessToast = false) => {
    setLoading(true);
    try {
      const payload = {
        type: reportType,
        dateFrom: dateFrom ? dateFrom.toISOString().split('T')[0] : undefined,
        dateTo: dateTo ? dateTo.toISOString().split('T')[0] : undefined,
        itemIds: selectedItemIds.length ? selectedItemIds : undefined,
        warehouseIds: selectedWarehouseIds.length ? selectedWarehouseIds : undefined,
      };

      const response = await apiClient.post('/reports/generate', payload);
      setResult(response.data || { data: [], summary: {}, chartData: [] });
      if (showSuccessToast) {
        toast.success('7�8& 7�7�8&8y8 7�87�87�8y7� 7�8 7�7�7�');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '7�7�7�7� 7�8 7�7�7 7�87�87�8y7�');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bootLoading) return;
    const timer = window.setTimeout(() => {
      void fetchReport();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [bootLoading, reportType, dateFrom, dateTo, selectedItemIds, selectedWarehouseIds]);

  const warehouseOptions = useMemo(() => {
    if (reportType !== 'movements') return [];
    const rows = result.data as MovementRow[];
    return Array.from(new Set(rows.map((row) => row.warehouseId).filter(Boolean) as string[])).sort();
  }, [reportType, result.data]);

  const toggleItem = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  };

  const toggleWarehouse = (warehouseId: string) => {
    setSelectedWarehouseIds((prev) =>
      prev.includes(warehouseId) ? prev.filter((id) => id !== warehouseId) : [...prev, warehouseId],
    );
  };

  const handleReset = () => {
    setDateFrom(null);
    setDateTo(null);
    setSelectedItemIds([]);
    setSelectedWarehouseIds([]);
    setReportType('movements');
  };

  const exportExcel = async () => {
    setIsExportingExcel(true);
    try {
      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        toast.error('87� 7�8�7�7� 7�8y7�8 7�7� 887�7�7�8y7�');
        return;
      }

      const normalizedRows = reportType === 'inventory'
        ? (rows as InventoryRow[]).map((row) => ({
            '8�8�7� 7�87�8 8~': row.itemCode || '-',
            '7�87�8 8~': row.itemName,
            '7�7�8y7� 7�88&7�7�8 ': row.currentStock,
          }))
        : (rows as MovementRow[]).map((row) => ({
            '7�87�7�7�8y7�': row.date,
            '8�8�7� 7�87�8 8~': row.itemCode || '-',
            '7�87�8 8~': row.itemName,
            '8 8�7� 7�87�7�8�7�': row.type,
            '7�88�8&8y7�': row.quantity,
            '7�88&7�7�8 ': row.warehouseId || '-',
            '7�88& 7�88~7�7�8�7�7�': row.warehouseInvoice || '-',
            '7�87�7�8~': row.supplierOrReceiver || '-',
          }));

      await exportRowsToExcel({
        fileName: `reports-${reportType}-${new Date().toISOString().split('T')[0]}.xlsx`,
        sheetName: 'Reports',
        rows: normalizedRows,
      });
      toast.success('7�8& 7�7�7�8y7� 7�87�87�8y7� 7�8 7�7�7�');
    } catch (error) {
      toast.error(resolveExportErrorMessage(error, 'تعذر تصدير ملف Excel. حاول مرة أخرى.'));
    } finally {
      setIsExportingExcel(false);
    }
  };

  const exportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const rows = Array.isArray(result.data) ? result.data : [];
      if (!rows.length) {
        toast.error('87� 7�8�7�7� 7�8y7�8 7�7� 887�7�7�8y7�');
        return;
      }

      const generatedBy = 'MZ.S-ERP Reports';

      const columns = reportType === 'inventory'
        ? [
            { key: 'itemCode', label: 'Item Code', align: 'left' as const },
            { key: 'itemName', label: 'Item', align: 'left' as const },
            { key: 'currentStock', label: 'Current Stock', align: 'right' as const },
          ]
        : [
            { key: 'date', label: 'Date', align: 'left' as const },
            { key: 'itemCode', label: 'Item Code', align: 'left' as const },
            { key: 'itemName', label: 'Item', align: 'left' as const },
            { key: 'type', label: 'Type', align: 'left' as const },
            { key: 'quantity', label: 'Quantity', align: 'right' as const },
            { key: 'warehouseId', label: 'Warehouse', align: 'left' as const },
            { key: 'warehouseInvoice', label: 'Invoice', align: 'left' as const },
          ];

      const payload = {
        title: reportType === 'inventory' ? 'Inventory Report' : 'Movements Report',
        subtitle: `Generated at ${new Date().toISOString()}`,
        generatedBy,
        filename: `reports-${reportType}-${new Date().toISOString().slice(0, 10)}`,
        columns,
        summary: [
          { label: 'Total Transactions', value: String(summary.totalTransactions || 0) },
          { label: 'Total In', value: String(summary.totalIn || 0) },
          { label: 'Total Out', value: String(summary.totalOut || 0) },
          { label: 'Net', value: String(summary.net || 0) },
        ],
        rows,
      };

      await exportPdfReport({
        endpoint: '/reports/print',
        payload,
        fileName: `${payload.filename}.pdf`,
      });
      toast.success('7�8& 7�8 7�7�7 8&88~ PDF 7�8 7�7�7�');
    } catch (error) {
      toast.error(resolveExportErrorMessage(error, 'تعذر تصدير ملف PDF. حاول مرة أخرى.'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const summary = result.summary || {};
  const hasData = Array.isArray(result.data) && result.data.length > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-[32px] font-bold text-slate-900">88�7�7� 7�87�87�7�8y7�</h1>
            <p className="text-[16px] text-slate-500">7�87�7�8y7� 7�8y7� 887�7�8�7� 8�7�88&7�7�8�8  8&7� 7�7�7�8y7� PDF 8�Excel.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchReport(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563eb] text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              7�7�7�8y7�
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition"
            >
              <Filter size={16} /> 7�7�7�7�7� 7�7�7�
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <aside className="xl:col-span-3 rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md shadow-sm p-4 space-y-4">
          <div>
            <label className="text-sm font-semibold text-slate-700">8 8�7� 7�87�87�8y7�</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setReportType('movements')}
                className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                  reportType === 'movements'
                    ? 'bg-[#2563eb] text-white border-[#2563eb]'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                7�87�7�8�7�7�
              </button>
              <button
                onClick={() => setReportType('inventory')}
                className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                  reportType === 'inventory'
                    ? 'bg-[#10b981] text-white border-[#10b981]'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                7�88&7�7�8�8 
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <CalendarDays size={14} /> 8&8  7�7�7�8y7�
            </label>
            <DatePicker
              selected={dateFrom}
              onChange={(date) => setDateFrom(date)}
              dateFormat="yyyy-MM-dd"
              className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
              placeholderText="YYYY-MM-DD"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <CalendarDays size={14} /> 7�880 7�7�7�8y7�
            </label>
            <DatePicker
              selected={dateTo}
              onChange={(date) => setDateTo(date)}
              dateFormat="yyyy-MM-dd"
              className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
              placeholderText="YYYY-MM-DD"
              minDate={dateFrom || undefined}
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 flex items-center gap-1">
              <Database size={14} /> 7�87�7�8 7�8~
            </label>
            <div className="mt-2 max-h-48 overflow-auto border border-slate-200 rounded-lg bg-white p-2 space-y-1">
              {items.map((item) => {
                const key = item.publicId || String(item.id);
                return (
                  <label key={key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedItemIds.includes(key)}
                      onChange={() => toggleItem(key)}
                      className="accent-[#2563eb]"
                    />
                    <span className="truncate">{item.code || '-'} - {item.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {reportType === 'movements' && (
            <div>
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                <Warehouse size={14} /> 7�88&7�7�7�8 
              </label>
              <div className="mt-2 max-h-32 overflow-auto border border-slate-200 rounded-lg bg-white p-2 space-y-1">
                {warehouseOptions.length === 0 && (
                  <div className="text-xs text-slate-400">87� 7�8�7�7� 8&7�7�7�8  7�8&8  7�88 7�7�7�7� 7�87�7�88y7�</div>
                )}
                {warehouseOptions.map((warehouseId) => (
                  <label key={warehouseId} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedWarehouseIds.includes(warehouseId)}
                      onChange={() => toggleWarehouse(warehouseId)}
                      className="accent-[#10b981]"
                    />
                    <span>{warehouseId}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="xl:col-span-9 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">7�7�8&7�88y 7�87�7�8�7�7�</p>
              <p className="text-xl font-bold text-slate-900">{summary.totalTransactions || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">7�7�8&7�88y 7�88�7�7�7�</p>
              <p className="text-xl font-bold text-[#10b981]">{numberFormatter.format(Number(summary.totalIn || 0))}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">7�7�8&7�88y 7�87�7�7�7�</p>
              <p className="text-xl font-bold text-[#ef4444]">{numberFormatter.format(Number(summary.totalOut || 0))}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">7�87�7�8~8y</p>
              <p className="text-xl font-bold text-[#2563eb]">{numberFormatter.format(Number(summary.net || 0))}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md shadow-sm p-4 h-[320px]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                <Loader2 className="animate-spin mr-2" size={18} /> 7�7�7�8y 7�7�8&8y8 7�87�7�8& 7�87�8y7�8 8y...
              </div>
            ) : result.chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400">87� 7�8�7�7� 7�8y7�8 7�7� 887�7�8& 7�87�8y7�8 8y</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {reportType === 'movements' ? (
                  <ComposedChart data={result.chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="in" name="8�7�7�7�" fill="#10b981" />
                    <Bar dataKey="out" name="7�7�7�7�" fill="#ef4444" />
                    <Line type="monotone" dataKey="in" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </ComposedChart>
                ) : (
                  <BarChart data={result.chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" interval={0} angle={-18} textAnchor="end" height={64} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" name="7�7�8y7� 7�88&7�7�8 " fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>

          <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md shadow-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg font-bold text-slate-800">8&7�7�8y8 7� 7�87�87�8y7�</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportPdf}
                  disabled={loading || isExportingPdf || !hasData}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExportingPdf ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} PDF
                </button>
                <button
                  onClick={exportExcel}
                  disabled={loading || isExportingExcel || !hasData}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2563eb] text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Excel
                </button>
              </div>
            </div>

            <div className="overflow-auto max-h-[420px] border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 text-slate-600 sticky top-0">
                  {reportType === 'inventory' ? (
                    <tr>
                      <th className="px-3 py-2">8�8�7� 7�87�8 8~</th>
                      <th className="px-3 py-2">7�87�8 8~</th>
                      <th className="px-3 py-2">7�7�8y7� 7�88&7�7�8 </th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-3 py-2">7�87�7�7�8y7�</th>
                      <th className="px-3 py-2">8�8�7� 7�87�8 8~</th>
                      <th className="px-3 py-2">7�87�8 8~</th>
                      <th className="px-3 py-2">8 8�7� 7�87�7�8�7�</th>
                      <th className="px-3 py-2">7�88�8&8y7�</th>
                      <th className="px-3 py-2">7�88&7�7�8 </th>
                      <th className="px-3 py-2">7�88~7�7�8�7�7�</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-t border-slate-100 animate-pulse">
                        <td colSpan={reportType === 'inventory' ? 3 : 7} className="px-3 py-3">
                          <div className="h-4 w-full bg-slate-100 rounded" />
                        </td>
                      </tr>
                    ))
                  ) : hasData ? (
                    reportType === 'inventory' ? (
                      (result.data as InventoryRow[]).map((row) => (
                        <tr key={row.itemId} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-mono">{row.itemCode || '-'}</td>
                          <td className="px-3 py-2">{row.itemName}</td>
                          <td className="px-3 py-2 font-semibold text-[#2563eb]">{numberFormatter.format(Number(row.currentStock || 0))}</td>
                        </tr>
                      ))
                    ) : (
                      (result.data as MovementRow[]).map((row) => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">{row.date}</td>
                          <td className="px-3 py-2 font-mono">{row.itemCode || '-'}</td>
                          <td className="px-3 py-2">{row.itemName}</td>
                          <td className="px-3 py-2">{row.type}</td>
                          <td className="px-3 py-2 font-semibold">{numberFormatter.format(Number(row.quantity || 0))}</td>
                          <td className="px-3 py-2">{row.warehouseId || '-'}</td>
                          <td className="px-3 py-2">{row.warehouseInvoice || '-'}</td>
                        </tr>
                      ))
                    )
                  ) : (
                    <tr>
                      <td colSpan={reportType === 'inventory' ? 3 : 7} className="px-3 py-10">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <Database size={64} className="text-slate-300" />
                          <h3 className="text-lg font-semibold text-slate-700">87� 7�8�7�7� 7�8y7�8 7�7�</h3>
                          <p className="text-sm text-slate-500">7�7�7�7� 8~7�7�7� 7�8&8 8y7� 7�8� 7�7�8 7�8~ 87�7�7� 7�87�87�7�8y7�</p>
                          <button
                            onClick={() => void fetchReport(true)}
                            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                          >
                            7�7�7�7�7� 7�88&7�7�8�87�
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Reports;


