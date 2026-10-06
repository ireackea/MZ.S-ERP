import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { DEFAULT_DISPLAY_LOCALE } from '@services/dateFormat';
import type {
  ExcelImportColumnMatch,
  ExcelImportResult,
  ExcelImportRow,
} from '@services/itemsService';
import { exportRowsToExcel } from '../../../utils/excelWorkbook';
import type { Item } from '../../../types';
import {
  analyzeItemImportRows,
  buildImportIssueExportRows,
  buildImportOutcomeExportRows,
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
  /**
   * Blank lines found in the file, and the row the headers were read from.
   *
   * Both exist so the studio can say "read 380 of 400, 20 blank" and "headers on
   * row 3" instead of leaving the operator to reconcile the numbers themselves. An
   * import that silently drops rows is indistinguishable from one that worked, and
   * the count is the only thing that tells them apart.
   */
  skippedEmptyRows: number;
  headerRow: number;
  /** Header labels appearing more than once — reported, never silently resolved. */
  duplicateHeaders: string[];
  onClose: () => void;
  /**
   * Runs the import and resolves with what the server said.
   *
   * Returning the result — rather than closing the modal from the parent — is what
   * lets the studio mark the refused rows and offer their report. When it resolved to
   * `void`, the only channel back to the operator was a toast, and a toast cannot show
   * 200 refusals or point at the 40 rows the client thought were fine and the server
   * disagreed with. Both ends now have to be in one place, and that place is a table.
   */
  onConfirm: (
    rows: ExcelImportRow[],
    controls?: { signal?: AbortSignal; onProgress?: (percent: number) => void; idempotencyKey?: string },
  ) => Promise<ExcelImportResult | null>;
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

/**
 * A date for a file name: the operator's own calendar day, `YYYY-MM-DD`.
 *
 * Not `toISOString().slice(0, 10)` — that is UTC, so an operator east of Greenwich
 * who opens the studio after midnight gets a report named after yesterday, and a
 * second export the same evening collides with it. Not `formatDate` either: that is
 * a *display* string, and in `ar-EG` it carries Arabic-Indic digits and a `/`, which
 * is a path separator. A file name is not a place for localised text.
 *
 * So: local year/month/day, Latin digits, ISO order, zero-padded — built from the
 * local getters, not from UTC.
 */
const fileNameDate = (when: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
};

const ItemImportStudio: React.FC<ItemImportStudioProps> = ({
  open,
  fileName,
  rows,
  sourceHeaders,
  columnMatches,
  existingItems,
  isImporting,
  skippedEmptyRows,
  headerRow,
  duplicateHeaders,
  onClose,
  onConfirm,
}) => {
  const [filter, setFilter] = useState<ImportRowStatus | 'all' | 'creatable'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [decisionOverrides, setDecisionOverrides] = useState<Record<string, ImportDecision>>({});

  // The server's answer, held rather than toasted. `outcome` is the switch between
  // "you are deciding" and "here is what happened", and it is what keeps the modal
  // open with information in it instead of open with nothing.
  const [outcome, setOutcome] = useState<ExcelImportResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  // One key per *file*, not per press. The server replays the stored result for a key
  // it has already seen, so pressing "import" again after a timeout is a retry rather
  // than a second import that collides with the first and reports failure for work
  // that succeeded. It is cleared only when a different file is opened.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setFilter('all');
    setQuery('');
    setPage(1);
    setDecisionOverrides({});
    setOutcome(null);
    setProgress(null);
    setIsCancelling(false);
    idempotencyKey.current = crypto.randomUUID();
    abortRef.current = null;
  }, [fileName, rows]);

  // Escape cancels an in-flight import, and never closes a dialog that has an import
  // running behind it — losing the operator's decisions to a stray keypress is worse
  // than ignoring the key. It is only bound while the studio is open, and it is torn
  // down with it, so no listener is left on the document.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isImporting) {
        cancelImport();
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, isImporting, onClose]);

  const analysis = useMemo(() => analyzeItemImportRows({ rows, existingItems, columnMatches }), [rows, existingItems, columnMatches]);

  /**
   * The duplicate check is only as complete as the catalogue it was given.
   *
   * If no catalogue has loaded yet, the check runs against nothing and reports "no
   * duplicate" for rows that certainly have one. The alternative — blocking the
   * import until it loads — turns a slow first load into a broken studio, so the
   * state is surfaced instead: the operator either waits, or imports knowing the
   * check did not run.
   */
  const catalogueIsEmpty = analysis.summary.catalogueSize === 0;

  const previewRows = useMemo(() => {
    // The server's refusals, indexed by the sheet row they name.
    //
    // Matched on `sourceRow` because that is the only thing the two sides share: the
    // client numbers rows by their place in the operator's sheet, and the server echoes
    // back the `sourceRow` the client sent. Matching on name or index instead would
    // mark the wrong row the moment the file has a gap in it — which is precisely the
    // file this wave made the numbering honest for.
    const serverRefusals = new Map<number, string[]>();
    for (const error of outcome?.errors ?? []) {
      const list = serverRefusals.get(error.row) ?? [];
      list.push(`${error.field}: ${error.error || error.message}`);
      serverRefusals.set(error.row, list);
    }

    return analysis.rows.map((entry) => {
      const refusals = serverRefusals.get(entry.sourceRow);
      if (refusals && refusals.length > 0) {
        return {
          ...entry,
          // The client's own opinion no longer applies. The server is the authority on
          // what will be stored, and a row it refused stays refused however clean the
          // local analysis thought it was. The local warnings are kept alongside so the
          // operator can see *why* the two disagreed — usually an unreadable number the
          // client had already flagged and the operator chose to import anyway.
          status: 'error' as ImportRowStatus,
          decision: 'skip' as ImportDecision,
          issues: [
            ...entry.issues,
            ...refusals.map((message) => ({
              severity: 'error' as const,
              field: 'server' as const,
              message,
            })),
          ],
        };
      }
      if (outcome) {
        const wasImported = outcome.results.some((row) => row.row === entry.sourceRow);
        if (!wasImported) {
          // Landed nowhere and refused nowhere. The server is silent about it, which is
          // the worst of the three: an error would be actionable, a success would be
          // false, and this is neither. Said plainly rather than counted as success.
          return {
            ...entry,
            status: 'ready' as ImportRowStatus,
            decision: 'skip' as ImportDecision,
            issues: [
              ...entry.issues,
              {
                severity: 'warning' as const,
                field: 'server' as const,
                message: 'لم يذكرها الخادم في النتيجة: لم تُنشأ ولم تُرفض.',
              },
            ],
          };
        }
        return {
          ...entry,
          decision: 'skip' as ImportDecision,
          // Warnings are dropped on a row that landed: the operator's own cautious
          // notes are stale now that the server has spoken, and leaving them would
          // report a clean import as a doubtful one.
          issues: entry.issues.filter((issue) => issue.severity !== 'warning'),
        };
      }
      const nextDecision = decisionOverrides[entry.id] || entry.decision;
      return { ...entry, decision: canCreateRow(entry) ? nextDecision : 'skip' };
    });
  }, [analysis.rows, decisionOverrides, outcome]);

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

  /**
   * Three different reasons a table can be empty, and the operator needs different
   * things from each one.
   *
   * This used to be one line — "لا توجد صفوف مطابقة للفلاتر الحالية" — shown for all
   * three, which is true of all three and useful for none. An empty *file* is a
   * problem with the file. An empty *filter* is a problem with the last thing they
   * clicked. Telling someone who just cleared the search box that their file has no
   * matching rows is not a subtle hint, it is a wrong statement about their data.
   */
  const emptyState = (() => {
    if (rows.length === 0) {
      return {
        title: 'لم يُقرأ أي صف من هذا الملف.',
        detail:
          skippedEmptyRows > 0
            ? `كل السطور فارغة (${skippedEmptyRows} سطراً فارغاً). تحقق من أن الملف يحتوي على بيانات أسفل الترويسة.`
            : 'الملف لا يحتوي على صفوف بيانات. إن كان الملف صورة أو ملفاً غير Excel، فلن يُقرأ.',
      };
    }
    if (filteredRows.length === 0 && (query.trim() || filter !== 'all')) {
      return {
        title: 'لا صفوف مطابقة للفلتر الحالي.',
        detail: `يوجد ${rows.length} صف في الملف، لكن لا يطابق بحثك أو الفلتر المختار. امسح البحث أو اختر «كل الصفوف».`,
      };
    }
    return { title: 'لا توجد صفوف في هذا الملف.', detail: '' };
  })();

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
      fileName: `items-import-review-${fileNameDate(new Date())}.xlsx`,
      sheetName: 'Import Review',
      rows: reportRows,
      headerOrder: ['row', 'status', 'decision', 'name', 'code', 'barcode', 'severity', 'issue'],
      columnWidths: [10, 14, 12, 28, 18, 22, 16, 60],
    });
  };

  /**
   * The outcome report: what the server did, row by row.
   *
   * The review export above answers "what did I decide". This one answers "what
   * happened", which is the question an operator has *after* pressing the button and
   * discovering the studio is still open in front of them with red rows in it. Without
   * it, the refusals exist only on screen: they scroll, they page, and they are gone
   * when the modal closes — so fixing the file means transcribing them by hand.
   */
  const exportOutcomeReport = async () => {
    if (!outcome) return;
    const reportRows = buildImportOutcomeExportRows(previewRows, outcome);
    await exportRowsToExcel({
      fileName: `items-import-result-${fileNameDate(new Date())}.xlsx`,
      sheetName: 'Import Result',
      rows: reportRows,
      headerOrder: ['row', 'outcome', 'name', 'code', 'barcode', 'field', 'message'],
      columnWidths: [10, 16, 28, 18, 22, 18, 70],
    });
  };

  const confirmImport = async () => {
    if (!rowsToImport.length) {
      toast.error('لا توجد صفوف جاهزة للاستيراد.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setOutcome(null);
    const result = await onConfirm(rowsToImport, {
      signal: controller.signal,
      onProgress: (percent) => setProgress(percent),
      idempotencyKey: idempotencyKey.current,
    });
    abortRef.current = null;
    setProgress(null);
    setIsCancelling(false);
    // The studio deliberately stays open. The result is now rendered on the rows that
    // caused it, which is the only place an operator can act on it.
    if (result) {
      setOutcome(result);
    }
  };

  const cancelImport = () => {
    setIsCancelling(true);
    abortRef.current?.abort();
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
              <p className="mt-1 text-sm text-slate-500">
                {fileName || 'ملف Excel'} - {rows.length} صف - {sourceHeaders.length} عمود مكتشف
                {headerRow > 1 && <span> - الترويسة في الصف {headerRow}</span>}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isImporting} className="rounded-full border border-slate-300 p-2 text-slate-500 disabled:opacity-50" aria-label="إغلاق استوديو الاستيراد"><X size={18} /></button>
        </div>

        {/* The two facts about the file itself that the row table cannot show. */}
        {(skippedEmptyRows > 0 || duplicateHeaders.length > 0) && (
          <div className="space-y-2 border-b border-slate-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {skippedEmptyRows > 0 && (
              <p>
                تم تجاهل <span className="font-black">{skippedEmptyRows}</span> سطراً فارغاً. عدد الصفوف التي ستُستورد{' '}
                <span className="font-black">{rows.length}</span>، وهو أقل من عدد أسطر الملف.
              </p>
            )}
            {duplicateHeaders.length > 0 && (
              <p>
                ترويسات مكررة في الملف: <span className="font-black">{duplicateHeaders.join('، ')}</span>.
                عمود مكرر لا يمكن المطابقة معه بشكل صحيح، فأُخذ العمود الأول. راجع المطابقة أدناه.
              </p>
            )}
            {catalogueIsEmpty && (
              <p>
                لم يُحمَّل الكتالوج بعد، لذلك <span className="font-black">فحص التكرار لم يعمل</span>.
                الصفوف التي تطابق أصنافاً موجودة ستُظهر كغير مكررة. أعد فتح الاستوديو بعد تحميل الأصناف.
              </p>
            )}
          </div>
        )}

        {catalogueIsEmpty && (skippedEmptyRows === 0 && duplicateHeaders.length === 0) && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-sm text-slate-600">
            جارٍ فحص التكرار ضد الكتالوج — لم يُحمَّل بعد.
          </div>
        )}

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
                {/* Hidden once the server has answered. Per-row decision dropdowns are
                    disabled for the same reason, and for the same reason: a decision
                    about a row the server already refused is a decision about nothing. */}
                {!outcome && (
                  <div className="mt-3 grid gap-2">
                    <button type="button" onClick={() => applyDecisionToWarnings('create')} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">استيراد صفوف التحذير</button>
                    <button type="button" onClick={() => applyDecisionToWarnings('skip')} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">تخطي صفوف التحذير</button>
                  </div>
                )}
                <div className="mt-3 grid gap-2">
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
                    {pageRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center">
                          <div className="font-bold text-slate-700">{emptyState.title}</div>
                          {emptyState.detail && <div className="mt-2 text-sm text-slate-500">{emptyState.detail}</div>}
                        </td>
                      </tr>
                    )}
                    {pageRows.map((entry) => (
                      <tr key={entry.id} className="border-t border-slate-200 align-top hover:bg-slate-50">
                        <td className="px-3 py-3 font-mono text-xs text-slate-500">{entry.sourceRow}</td>
                        <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClassName[entry.status]}`}>{statusLabels[entry.status]}</span></td>
                        <td className="px-3 py-3">
                          <select value={entry.decision} onChange={(event) => setDecision(entry, event.target.value as ImportDecision)} disabled={Boolean(outcome)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50" aria-label={`قرار الصف ${entry.sourceRow}`}>
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
          <div className="min-w-[240px] flex-1 text-sm text-slate-600" aria-live="polite">
            {isImporting ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span>جارٍ إرسال {rowsToImport.length} صف…</span>
                  <span className="font-black text-slate-900">{progress ?? 0}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="تقدّم إرسال الاستيراد">
                  <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-200" style={{ width: `${progress ?? 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {progress === 0
                    ? 'الاتصال بالخادم…'
                    : 'تمت الإرسال، في انتظار معالجة الخادم.'}
                </p>
              </div>
            ) : outcome ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-800">
                  تم الاستيراد: {outcome.success} ناجح{outcome.failed ? ` · ${outcome.failed} مرفوض` : ''}
                </span>
                <span className="text-xs text-slate-500">رقم الدفعة: {outcome.batchId || '—'}</span>
                <button type="button" onClick={() => { void exportOutcomeReport(); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
                  <Download size={13} /> تنزيل تقرير النتيجة
                </button>
              </div>
            ) : (
              <span>
                سيتم استيراد <span className="font-black text-slate-900">{rowsToImport.length}</span> صف، وتخطي{' '}
                <span className="font-black text-slate-900">{smartSummary.skipped}</span> صف.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isImporting ? (
              // Cancelling, not closing. `abort` leaves the studio exactly as it was —
              // the decisions, the overrides, the scroll position — because the whole
              // point of not closing it is that the operator can come back to it.
              <button type="button" onClick={cancelImport} disabled={isCancelling} className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50">
                {isCancelling ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                {isCancelling ? 'جارٍ الإلغاء…' : 'إلغاء الاستيراد'}
              </button>
            ) : (
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
                {outcome ? 'إغلاق' : 'إلغاء'}
              </button>
            )}
            {!isImporting && (
              <button type="button" onClick={confirmImport} disabled={rowsToImport.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
                <Play size={16} />
                {outcome ? 'إعادة استيراد الصفوف الجاهزة' : 'تنفيذ الاستيراد الذكي'}
              </button>
            )}
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
    <div className="mt-2 text-2xl font-black">{value.toLocaleString(DEFAULT_DISPLAY_LOCALE)}</div>
  </div>
);

export default ItemImportStudio;
