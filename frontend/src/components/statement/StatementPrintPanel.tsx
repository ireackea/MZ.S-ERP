import React from 'react';
import { FileDown, FileSpreadsheet, Printer, X } from 'lucide-react';
import type { GridColumnPreference } from '../../types';
import {
  DEFAULT_PRINT_TITLE,
  PRINT_FONT_MAX,
  PRINT_FONT_MIN,
  STATEMENT_SIGNATURE_TITLES,
  formatNumber,
  isNumericColumn,
  type StatementPrintConfig,
  type StatementRow,
  type StatementSummary,
} from './shared';

type StatementPrintPanelProps = {
  open: boolean;
  onClose: () => void;
  saveCurrentPrintSettings: () => void;
  resetPrintSettings: () => void;
  printConfig: StatementPrintConfig;
  setPrintConfig: React.Dispatch<React.SetStateAction<StatementPrintConfig>>;
  printableColumnsCatalog: GridColumnPreference[];
  printColumns: GridColumnPreference[];
  selectAllPrintColumns: () => void;
  deselectAllPrintColumns: () => void;
  togglePrintColumnKey: (columnKey: string) => void;
  selectedRowsCount: number;
  pdfStatusMessage: string;
  onPrint: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  currentPreviewPage: number;
  setCurrentPreviewPage: React.Dispatch<React.SetStateAction<number>>;
  pagedRowsCount: number;
  previewPages: StatementRow[][];
  previewPaper: { width: number; height: number };
  previewMargin: number;
  effectivePrintScale: number;
  isScaleVerySmall: boolean;
  printPreviewRef: React.RefObject<HTMLDivElement | null>;
  previewTableMeasureRef: React.RefObject<HTMLTableElement | null>;
  summary: StatementSummary;
};

const StatementPrintPanel: React.FC<StatementPrintPanelProps> = ({
  open,
  onClose,
  saveCurrentPrintSettings,
  resetPrintSettings,
  printConfig,
  setPrintConfig,
  printableColumnsCatalog,
  printColumns,
  selectAllPrintColumns,
  deselectAllPrintColumns,
  togglePrintColumnKey,
  selectedRowsCount,
  pdfStatusMessage,
  onPrint,
  onExportPdf,
  onExportExcel,
  currentPreviewPage,
  setCurrentPreviewPage,
  pagedRowsCount,
  previewPages,
  previewPaper,
  previewMargin,
  effectivePrintScale,
  isScaleVerySmall,
  printPreviewRef,
  previewTableMeasureRef,
  summary,
}) => {
  if (!open) return null;

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white; }
          nav, aside, header, .no-print, .print-panel-ui { display: none !important; }
          .print-panel-preview-wrap { display: block !important; }
          .statement-print-wrap { display: none !important; }
          .print-flow-paged .print-panel-page { page-break-after: always !important; break-after: page !important; }
          .print-flow-paged .print-panel-page:last-child { page-break-after: auto !important; break-after: auto !important; }
          .print-panel-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: auto !important;
            break-after: auto !important;
            width: 100% !important;
            min-height: auto !important;
            transform: none !important;
            border: none !important;
            padding: 0 !important;
          }
          .statement-table th, .statement-table td { border: 1px solid #cbd5e1 !important; }
          .statement-table { font-size: 9pt !important; }
          .print-signature-line { border-bottom: 1px solid #0f172a !important; }
        }
      `}</style>

      <div className="fixed inset-0 z-[90] bg-slate-950/70 p-4 backdrop-blur-sm print:bg-white print:p-0">
        <div className="flex h-full w-full overflow-hidden rounded-2xl bg-white print:h-auto print:rounded-none">
          <aside className="print-panel-ui w-full max-w-sm overflow-y-auto border-l border-slate-200 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">لوحة إعدادات الطباعة</h3>
              <button title="إغلاق لوحة الطباعة" aria-label="إغلاق لوحة الطباعة" onClick={onClose} className="text-slate-500 hover:text-red-600"><X size={18} /></button>
            </div>

            <div className="print-panel-ui mb-3 grid grid-cols-2 gap-2">
              <button onClick={saveCurrentPrintSettings} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-900">حفظ الإعدادات الحالية</button>
              <button onClick={resetPrintSettings} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">إعادة تعيين الإعدادات</button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <div className="font-bold text-slate-700">بيانات المستند</div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">عنوان المستند</label>
                  <input
                    type="text"
                    value={printConfig.printTitle}
                    onChange={(event) => setPrintConfig((prev) => ({ ...prev, printTitle: event.target.value }))}
                    placeholder={DEFAULT_PRINT_TITLE}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">اتجاه الصفحة</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setPrintConfig((prev) => ({ ...prev, orientation: 'portrait' }))} className={`rounded-lg border px-3 py-2 ${printConfig.orientation === 'portrait' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>طولي</button>
                    <button onClick={() => setPrintConfig((prev) => ({ ...prev, orientation: 'landscape' }))} className={`rounded-lg border px-3 py-2 ${printConfig.orientation === 'landscape' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>عرضي</button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">مقاس الورق</label>
                  <select title="اختيار مقاس الورق" value={printConfig.paperSize} onChange={(event) => setPrintConfig((prev) => ({ ...prev, paperSize: event.target.value as StatementPrintConfig['paperSize'] }))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
                    <option value="a4">A4</option>
                    <option value="a3">A3</option>
                    <option value="letter">Letter</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">الهوامش</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'narrow' }))} className={`rounded-lg border px-2 py-2 text-xs ${printConfig.margins === 'narrow' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>ضيقة</button>
                    <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'normal' }))} className={`rounded-lg border px-2 py-2 text-xs ${printConfig.margins === 'normal' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>عادية</button>
                    <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'wide' }))} className={`rounded-lg border px-2 py-2 text-xs ${printConfig.margins === 'wide' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>واسعة</button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="font-bold text-slate-700">تحجيم الصفحة</div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name="page-fitting" checked={printConfig.scalingMode === 'actual'} onChange={() => setPrintConfig((prev) => ({ ...prev, scalingMode: 'actual' }))} className="accent-emerald-600" />
                  الحجم الفعلي
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name="page-fitting" checked={printConfig.scalingMode === 'fit'} onChange={() => setPrintConfig((prev) => ({ ...prev, scalingMode: 'fit' }))} className="accent-emerald-600" />
                  احتواء كل الأعمدة بصفحة واحدة
                </label>
                <div className="text-xs text-slate-500">نسبة التحجيم التلقائي: {Math.round(effectivePrintScale * 100)}%</div>
                {isScaleVerySmall && <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">قد تصبح المعاينة صغيرة جدًا؛ يفضّل تقليل الأعمدة المطبوعة.</div>}
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="font-bold text-slate-700">تدفق الطباعة</div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPrintConfig((prev) => ({ ...prev, flowMode: 'continuous' }))} className={`rounded-lg border px-3 py-2 text-xs ${printConfig.flowMode === 'continuous' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>مستمر</button>
                  <button onClick={() => setPrintConfig((prev) => ({ ...prev, flowMode: 'paged' }))} className={`rounded-lg border px-3 py-2 text-xs ${printConfig.flowMode === 'paged' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>صفحات</button>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="font-bold text-slate-700">حجم الخط</div>
                <label className="mb-1 block text-xs text-slate-500">مقاس الخط: {printConfig.fontSize}px</label>
                <input type="range" title="تعديل مقاس الخط" min={PRINT_FONT_MIN} max={PRINT_FONT_MAX} step={1} value={printConfig.fontSize} onChange={(event) => setPrintConfig((prev) => ({ ...prev, fontSize: Number(event.target.value) }))} className="w-full" />
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{PRINT_FONT_MIN}px</span>
                  <span>{PRINT_FONT_MAX}px</span>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-700">الأعمدة المطبوعة</div>
                  <span className="text-xs text-slate-500">{printColumns.length} / {printableColumnsCatalog.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={selectAllPrintColumns} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">تحديد الكل</button>
                  <button onClick={deselectAllPrintColumns} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">إلغاء الكل</button>
                </div>
                <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                  {printableColumnsCatalog.map((column) => (
                    <label key={`print-column-${column.key}`} className="flex items-center gap-2 text-xs text-slate-700">
                      <input type="checkbox" checked={printConfig.printColumnKeys.includes(column.key)} onChange={() => togglePrintColumnKey(column.key)} className="accent-emerald-600" />
                      {column.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="font-bold text-slate-700">خيارات إضافية</div>
                {[
                  { key: 'printGridlines', label: 'إظهار خطوط الجدول' },
                  { key: 'printBackgroundColors', label: 'إظهار ألوان الخلفية' },
                  { key: 'printSummaryCards', label: 'إظهار بطاقات الملخص' },
                  { key: 'printSignatures', label: 'إظهار حقول التوقيع' },
                  { key: 'repeatHeaders', label: 'تكرار رؤوس الجدول' },
                  { key: 'autoSizeColumnsByContent', label: 'ضبط عرض الأعمدة تلقائيًا' },
                ].map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(printConfig[option.key as keyof StatementPrintConfig])}
                      onChange={(event) => setPrintConfig((prev) => ({ ...prev, [option.key]: event.target.checked }))}
                      className="accent-emerald-600"
                    />
                    {option.label}
                  </label>
                ))}
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="font-bold text-slate-700">نطاق الطباعة</div>
                <label className="flex items-center gap-2 text-sm text-slate-700"><input type="radio" name="print-range" checked={printConfig.range === 'current_page'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'current_page' }))} className="accent-emerald-600" /> الصفحة الحالية فقط</label>
                <label className="flex items-center gap-2 text-sm text-slate-700"><input type="radio" name="print-range" checked={printConfig.range === 'selected_rows'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'selected_rows' }))} className="accent-emerald-600" /> الصفوف المحددة فقط ({selectedRowsCount})</label>
                <label className="flex items-center gap-2 text-sm text-slate-700"><input type="radio" name="print-range" checked={printConfig.range === 'all'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'all' }))} className="accent-emerald-600" /> كل الصفوف</label>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                {pdfStatusMessage && (
                  <div className={`rounded-lg border px-3 py-2 text-xs ${pdfStatusMessage.startsWith('تم ') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                    {pdfStatusMessage}
                  </div>
                )}
                <button onClick={onPrint} className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"><Printer size={14} /> طباعة</button>
                <button onClick={onExportPdf} className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"><FileDown size={14} /> حفظ PDF</button>
                <button onClick={onExportExcel} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"><FileSpreadsheet size={14} /> تصدير Excel</button>
              </div>
            </div>
          </aside>

          <section className="flex-1 overflow-auto bg-slate-100 p-5 print:bg-white print:p-0">
            <div className="print-panel-ui mb-4 flex items-center justify-between">
              <div className="text-sm font-bold text-slate-700">معاينة حيّة (WYSIWYG)</div>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => setCurrentPreviewPage((prev) => Math.max(1, prev - 1))} className="rounded border border-slate-300 bg-white px-2 py-1" disabled={printConfig.flowMode !== 'paged' || currentPreviewPage <= 1}>السابق</button>
                <span className="px-2">{printConfig.flowMode === 'paged' ? `صفحة ${currentPreviewPage} / ${Math.max(1, pagedRowsCount)}` : 'عرض مستمر'}</span>
                <button onClick={() => setCurrentPreviewPage((prev) => Math.min(Math.max(1, pagedRowsCount), prev + 1))} className="rounded border border-slate-300 bg-white px-2 py-1" disabled={printConfig.flowMode !== 'paged' || currentPreviewPage >= Math.max(1, pagedRowsCount)}>التالي</button>
              </div>
            </div>

            <div ref={printPreviewRef} className={`print-panel-preview-wrap space-y-6 ${printConfig.flowMode === 'paged' ? 'print-flow-paged' : 'print-flow-continuous'}`}>
              {previewPages.map((pageRows, pageIndex) => (
                <div key={`preview-page-${pageIndex}`} className="print-panel-page mx-auto border border-slate-300 bg-white shadow-xl" style={{ width: `${previewPaper.width}px`, minHeight: `${previewPaper.height}px`, padding: `${previewMargin}px` }}>
                  <div className="mb-3 text-center">
                    <h4 className="text-base font-bold text-slate-800">{(printConfig.printTitle || '').trim() || DEFAULT_PRINT_TITLE}</h4>
                  </div>

                  {printColumns.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-slate-500">اختر الأعمدة المطلوب طباعتها من لوحة الإعدادات لعرض المعاينة هنا.</div>
                  ) : (
                    <div className="print-fit-wrapper overflow-visible" style={{ zoom: printConfig.scalingMode === 'fit' ? effectivePrintScale : 1, width: printConfig.scalingMode === 'fit' ? `${100 / Math.max(0.25, effectivePrintScale)}%` : '100%' }}>
                      <table ref={pageIndex === 0 ? previewTableMeasureRef : null} className="border-collapse" style={{ fontSize: `${printConfig.fontSize}px`, width: printConfig.scalingMode === 'fit' ? 'max-content' : '100%', tableLayout: 'auto' }}>
                        {(printConfig.repeatHeaders || pageIndex === 0) && (
                          <thead>
                            <tr>
                              {printColumns.map((column) => (
                                <th key={`head-${column.key}-${pageIndex}`} className="whitespace-nowrap px-1.5 py-0.5 text-center font-bold" style={{ border: printConfig.printGridlines ? '1px solid #cbd5e1' : 'none', backgroundColor: printConfig.printBackgroundColors ? '#f1f5f9' : 'transparent' }}>{column.label}</th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {pageRows.map((row, rowIndex) => (
                            <tr key={`${row.id}-${pageIndex}`}>
                              {printColumns.map((column) => {
                                const rawValue = (row as Record<string, unknown>)[column.key];
                                const value = isNumericColumn(column.key)
                                  ? formatNumber(Number(rawValue || 0), ['delayMinutes', 'packageCount', 'rowNumber'].includes(column.key) ? 0 : 3)
                                  : String(rawValue ?? '');
                                return (
                                  <td key={`${column.key}-${row.id}`} className="whitespace-nowrap px-1.5 py-0.5 text-center" style={{ border: printConfig.printGridlines ? '1px solid #e2e8f0' : 'none', backgroundColor: printConfig.printBackgroundColors && rowIndex % 2 === 1 ? '#f8fafc' : 'transparent' }}>
                                    {value}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {printConfig.printSummaryCards && pageIndex === previewPages.length - 1 && (
                    <div className={`mt-4 grid grid-cols-2 gap-2 ${printConfig.scalingMode === 'fit' ? 'mt-2' : 'mt-4'}`} style={{ fontSize: `${Math.max(8, printConfig.fontSize - 1)}px` }}>
                      <div className="rounded border border-slate-200 p-2"><div className="text-[10px] text-slate-500">إجمالي الوزن القائم</div><div className="font-bold text-slate-800">{formatNumber(summary.gross)} كجم</div></div>
                      <div className="rounded border border-slate-200 p-2"><div className="text-[10px] text-slate-500">إجمالي الوزن الصافي</div><div className="font-bold text-slate-800">{formatNumber(summary.net)} كجم</div></div>
                      <div className="rounded border border-slate-200 p-2"><div className="text-[10px] text-slate-500">الفرق بين القائم والصافي</div><div className="font-bold text-slate-800">{formatNumber(summary.difference)} كجم</div></div>
                      <div className="rounded border border-slate-200 p-2"><div className="text-[10px] text-slate-500">إجمالي قيمة التأخير</div><div className="font-bold text-slate-800">{formatNumber(summary.delayAmount)} ج.م</div></div>
                    </div>
                  )}

                  {printConfig.printSignatures && pageIndex === previewPages.length - 1 && (
                    <div className={`grid grid-cols-3 gap-4 text-center ${printConfig.scalingMode === 'fit' ? 'mt-3' : 'mt-6'}`} style={{ fontSize: `${printConfig.fontSize}px` }}>
                      {STATEMENT_SIGNATURE_TITLES.map((title) => (
                        <div key={`${title}-${pageIndex}`}>
                          <div className="h-8" />
                          <div className="border-b border-slate-900" />
                          <p className="mt-1 text-[11px] font-bold text-slate-700">{title}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default StatementPrintPanel;