import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from '@services/toastService';
import type { ExcelImportColumnMatch, ExcelImportRow } from '@services/itemsService';
import { exportRowsToExcel } from '../../../utils/excelWorkbook';
import type { Item } from '../../../types';
import {
  analyzeItemImportRows,
  buildImportIssueExportRows,
  type ImportDecision,
  type ImportPreviewRow,
  type ImportRowStatus,
} from './itemImportIntelligence';

type ItemImportStudioProps = {
  open: boolean;
  fileName: string;
  rows: ExcelImportRow[];
  sourceHeaders: string[];
  columnMatches: ExcelImportColumnMatch[];
  existingItems: Item[];
  isImporting: boolean;
  onClose: () => void;
  onConfirm: (rows: ExcelImportRow[]) => void;
};

const PAGE_SIZE = 80;

const statusLabels: Record<ImportRowStatus | 'all' | 'creatable', string> = {
  all: 'كل الصفوف',
  creatable: 'سيتم استيرادها',
  ready: 'جاهزة',
  warning: 'تحذيرات',
  error: 'أخطاء',
  duplicate: 'مكررة',
};

const statusClassName: Record<ImportRowStatus, string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-red-200 bg-red-50 text-red-700',
  duplicate: 'border-blue-200 bg-blue-50 text-blue-700',
};

const decisionLabels: Record<ImportDecision, string> = {
  create: 'استيراد',
  skip: 'تخطي',
};

const canCreateRow = (entry: ImportPreviewRow) => entry.status !== 'error' && entry.status !== 'duplicate';

const ItemImportStudio: React.FC<ItemImportStudioProps> = ({
  open,
  fileName,
  rows,
  sourceHeaders,
  columnMatches,
  existingItems,
  isImporting,
  onClose,
  onConfirm,
}) => {
  const [filter, setFilter] = useState<ImportRowStatus | 'all' | 'creatable'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [decisionOverrides, setDecisionOverrides] = useState<Record<string, ImportDecision>>({});

  useEffect(() => {
    setFilter('all');
    setQuery('');
    setPage(1);
    setDecisionOverrides({});
  }, [fileName, rows]);

  const analysis = useMemo(() => analyzeItemImportRows({ rows, existingItems, columnMatches }), [rows, existingItems, columnMatches]);

  const previewRows = useMemo(() => analysis.rows.map((entry) => {
    const nextDecision = decisionOverrides[entry.id] || entry.decision;
    return {
      ...entry,
      decision: canCreateRow(entry) ? nextDecision : 'skip',
    };
  }), [analysis.rows, decisionOverrides]);

  const smartSummary = useMemo(() => {
    const creatable = previewRows.filter((entry) => entry.decision === 'create').length;
    return {
      ...analysis.summary,
      creatable,
      skipped: previewRows.length - creatable,
    };
  }, [analysis.summary, previewRows]);

  const filteredRows = useMemo(() => {
    const searchValue = query.trim().toLowerCase();
    return previewRows.filter((entry) => {
      const matchesFilter = filter === 'all'
        || (filter === 'creatable' ? entry.decision === 'create' : entry.status === filter);
      if (!matchesFilter) return false;
      if (!searchValue) return true;
      return [entry.row.name, entry.row.code, entry.row.barcode, entry.row.category, entry.row.unit, entry.sourceRow]
        .some((value) => String(value || '').toLowerCase().includes(searchValue));
    });
  }, [filter, previewRows, query]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rowsToImport = previewRows.filter((entry) => entry.decision === 'create').map((entry) => entry.row);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  if (!open) return null;

  const setDecision = (entry: ImportPreviewRow, decision: ImportDecision) => {
    if (decision === 'create' && !canCreateRow(entry)) {
      toast.error('لا يمكن استيراد الصفوف التي تحتوي على أخطاء أو تكرار مؤكد.');
      return;
    }
    setDecisionOverrides((current) => ({ ...current, [entry.id]: decision }));
  };

  const applyDecisionToWarnings = (decision: ImportDecision) => {
    const updates: Record<string, ImportDecision> = {};
    previewRows.forEach((entry) => {
      if (entry.status === 'warning') updates[entry.id] = decision;
    });
    setDecisionOverrides((current) => ({ ...current, ...updates }));
  };

  const exportIssueReport = async () => {
    const reportRows = buildImportIssueExportRows(previewRows);
    await exportRowsToExcel({
      fileName: `items-import-review-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: 'Import Review',
      rows: reportRows,
      headerOrder: ['row', 'status', 'decision', 'name', 'code', 'barcode', 'severity', 'issue'],
      columnWidths: [10, 14, 12, 28, 18, 22, 16, 60],
    });
  };

  const confirmImport = () => {
    if (!rowsToImport.length) {
      toast.error('لا توجد صفوف جاهزة للاستيراد.');
      return;
    }
    onConfirm(rowsToImport);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3" role="dialog" aria-modal="true" aria-labelledby="item-import-title">
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-slate-900 p-3 text-white"><Brain size={22} /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="item-import-title" className="text-xl font-black text-slate-900">استوديو استيراد الأصناف الذكي</h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><ShieldCheck size={13} /> تحليل محلي خاص</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{fileName || 'ملف Excel'} - {rows.length} صف - {sourceHeaders.length} عمود مكتشف</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isImporting} className="rounded-full border border-slate-300 p-2 text-slate-500 disabled:opacity-50" aria-label="إغلاق استوديو الاستيراد"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6" aria-live="polite">
            <MetricCard label="إجمالي الصفوف" value={smartSummary.total} icon={<FileSpreadsheet size={18} />} className="border-slate-200 text-slate-800" />
            <MetricCard label="جاهزة" value={smartSummary.ready} icon={<CheckCircle2 size={18} />} className="border-emerald-200 text-emerald-700" />
            <MetricCard label="تحذيرات" value={smartSummary.warnings} icon={<AlertTriangle size={18} />} className="border-amber-200 text-amber-700" />
            <MetricCard label="أخطاء" value={smartSummary.errors} icon={<CircleAlert size={18} />} className="border-red-200 text-red-700" />
            <MetricCard label="مكررات" value={smartSummary.duplicates} icon={<Sparkles size={18} />} className="border-blue-200 text-blue-700" />
            <MetricCard label="سيتم استيرادها" value={smartSummary.creatable} icon={<Play size={18} />} className="border-slate-900 text-slate-900" />
          </div>

          <section className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center gap-2 font-black text-slate-900"><Brain size={17} /> مطابقة الأعمدة</div>
                <div className="space-y-2">
                  {columnMatches.map((match) => (
                    <div key={match.field} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                      <span className="font-bold text-slate-700">{match.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${match.strategy === 'missing' ? 'bg-red-50 text-red-700' : match.confidence < 0.75 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {match.header || 'غير مطابق'} {match.header ? `${Math.round(match.confidence * 100)}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
                {smartSummary.lowConfidenceColumns > 0 && <p className="mt-3 text-xs leading-6 text-amber-700">يوجد أعمدة بثقة متوسطة. راجع الصفوف قبل الاستيراد، ويمكنك تصدير تقرير المراجعة.</p>}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="font-black text-slate-900">قرارات جماعية</div>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => applyDecisionToWarnings('create')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">استيراد صفوف التحذير</button>
                  <button type="button" onClick={() => applyDecisionToWarnings('skip')} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">تخطي صفوف التحذير</button>
                  <button type="button" onClick={() => { void exportIssueReport(); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><Download size={15} /> تصدير تقرير المراجعة</button>
                </div>
              </div>
            </aside>

            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-slate-300 py-2 pl-3 pr-9 text-sm" placeholder="بحث في المعاينة" aria-label="بحث في صفوف الاستيراد" />
                </div>
                {(['all', 'creatable', 'ready', 'warning', 'error', 'duplicate'] as Array<ImportRowStatus | 'all' | 'creatable'>).map((nextFilter) => (
                  <button key={nextFilter} type="button" onClick={() => setFilter(nextFilter)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === nextFilter ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{statusLabels[nextFilter]}</button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-3 py-3 text-right">الصف</th>
                      <th className="px-3 py-3 text-right">الحالة</th>
                      <th className="px-3 py-3 text-right">القرار</th>
                      <th className="px-3 py-3 text-right">الصنف</th>
                      <th className="px-3 py-3 text-right">القسم/الوحدة</th>
                      <th className="px-3 py-3 text-right">الكود/الباركود</th>
                      <th className="px-3 py-3 text-right">الجودة</th>
                      <th className="px-3 py-3 text-right">الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">لا توجد صفوف مطابقة للفلاتر الحالية.</td></tr>}
                    {pageRows.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-200 align-top hover:bg-slate-50">
                        <td className="px-3 py-3 font-mono text-xs text-slate-500">{entry.sourceRow}</td>
                        <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClassName[entry.status]}`}>{statusLabels[entry.status]}</span></td>
                        <td className="px-3 py-3">
                          <select value={entry.decision} onChange={(event) => setDecision(entry, event.target.value as ImportDecision)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" aria-label={`قرار الصف ${entry.sourceRow}`}>
                            <option value="create" disabled={!canCreateRow(entry)}>{decisionLabels.create}</option>
                            <option value="skip">{decisionLabels.skip}</option>
                          </select>
                        </td>
                        <td className="px-3 py-3"><div className="font-bold text-slate-900">{entry.row.name || '-'}</div><div className="text-xs text-slate-500">{entry.row.description || entry.row.englishName || ''}</div></td>
                        <td className="px-3 py-3"><div>{entry.row.category || '-'}</div><div className="text-xs text-slate-500">{entry.row.unit || '-'}</div></td>
                        <td className="px-3 py-3"><div className="font-mono text-xs">{entry.row.code || '-'}</div><div className="font-mono text-xs text-slate-500">{entry.row.barcode || '-'}</div></td>
                        <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{entry.qualityScore}%</span></td>
                        <td className="max-w-md px-3 py-3">
                          <div className="space-y-1">
                            {[...entry.issues.map((issue) => issue.message), ...entry.duplicates.map((duplicate) => duplicate.label)].slice(0, 4).map((message, index) => (
                              <div key={`${entry.id}-${index}`} className="text-xs leading-5 text-slate-600">{message}</div>
                            ))}
                            {entry.issues.length + entry.duplicates.length === 0 && <span className="text-xs text-emerald-700">جاهز بدون ملاحظات.</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3 text-sm text-slate-600">
                <span>عرض {pageRows.length} من {filteredRows.length} صف</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40">السابق</button>
                  <span className="font-bold">{page} / {totalPages}</span>
                  <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40">التالي</button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="text-sm text-slate-600" aria-live="polite">
            سيتم استيراد <span className="font-black text-slate-900">{rowsToImport.length}</span> صف، وتخطي <span className="font-black text-slate-900">{smartSummary.skipped}</span> صف.
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} disabled={isImporting} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">إلغاء</button>
            <button type="button" onClick={confirmImport} disabled={isImporting || rowsToImport.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
              {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {isImporting ? 'جاري الاستيراد...' : 'تنفيذ الاستيراد الذكي'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: number; icon: React.ReactNode; className: string }> = ({ label, value, icon, className }) => (
  <div className={`rounded-2xl border bg-white p-4 shadow-sm ${className}`}>
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm text-slate-500">{label}</div>
      {icon}
    </div>
    <div className="mt-2 text-2xl font-black">{value.toLocaleString('en-US')}</div>
  </div>
);

export default ItemImportStudio;
