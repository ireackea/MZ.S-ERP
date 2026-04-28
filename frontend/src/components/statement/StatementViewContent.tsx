import React from 'react';
import {
  BadgeDollarSign,
  CheckSquare,
  Expand,
  FileText,
  Minimize,
  Printer,
  Scale,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Weight,
  X,
} from 'lucide-react';
import { OPERATION_TYPES } from '../../constants';
import type { GridColumnPreference } from '../../types';
import UniversalColumnManager from '../UniversalColumnManager';
import {
  formatNumber,
  isNumericColumn,
  type SortDirection,
  type StatementRow,
  type StatementSummary,
} from './shared';

type StatementViewContentProps = {
  globalSearch: string;
  setGlobalSearch: React.Dispatch<React.SetStateAction<string>>;
  typeFilter: string;
  setTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  partnerFilter: string;
  setPartnerFilter: React.Dispatch<React.SetStateAction<string>>;
  dateFrom: string;
  setDateFrom: React.Dispatch<React.SetStateAction<string>>;
  dateTo: string;
  setDateTo: React.Dispatch<React.SetStateAction<string>>;
  partnerOptions: string[];
  selectAllFiltered: () => void;
  clearSelection: () => void;
  onShowColumnSettings: () => void;
  isRowsExpanded: boolean;
  onToggleRowsExpanded: () => void;
  onOpenPrintPanel: () => void;
  showActionsOnPrint: boolean;
  onShowActionsOnPrintChange: (checked: boolean) => void;
  visibleColumns: GridColumnPreference[];
  sortKey: string;
  sortDirection: SortDirection;
  getColumnStyle: (column: GridColumnPreference, isHeader?: boolean) => React.CSSProperties;
  toggleSort: (columnKey: string) => void;
  startResize: (event: React.MouseEvent, columnKey: string) => void;
  activeResizeKey: string | null;
  columnFilters: Record<string, string>;
  setColumnFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sortedRows: StatementRow[];
  selectedIds: Set<string>;
  toggleRowSelection: (rowId: string) => void;
  onInspectRow: (row: StatementRow) => void;
  summary: StatementSummary;
  showColumnSettings: boolean;
  onCloseColumnSettings: () => void;
  isForceUnified: boolean;
  columns: GridColumnPreference[];
  setColumns: React.Dispatch<React.SetStateAction<GridColumnPreference[]>>;
  resetColumns: () => void;
  saveColumns: () => void;
};

const StatementViewContent: React.FC<StatementViewContentProps> = ({
  globalSearch,
  setGlobalSearch,
  typeFilter,
  setTypeFilter,
  partnerFilter,
  setPartnerFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  partnerOptions,
  selectAllFiltered,
  clearSelection,
  onShowColumnSettings,
  isRowsExpanded,
  onToggleRowsExpanded,
  onOpenPrintPanel,
  showActionsOnPrint,
  onShowActionsOnPrintChange,
  visibleColumns,
  sortKey,
  sortDirection,
  getColumnStyle,
  toggleSort,
  startResize,
  activeResizeKey,
  columnFilters,
  setColumnFilters,
  sortedRows,
  selectedIds,
  toggleRowSelection,
  onInspectRow,
  summary,
  showColumnSettings,
  onCloseColumnSettings,
  isForceUnified,
  columns,
  setColumns,
  resetColumns,
  saveColumns,
}) => {
  return (
    <>
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800 dark:text-slate-100"><FileText className="text-blue-600" /> كشف الحساب</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">راجع العمليات المسجلة، وخصص عرض البيانات، ثم اطبع أو صدّر التقرير مباشرة.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={selectAllFiltered} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><CheckSquare size={14} /> تحديد الكل</button>
            <button onClick={clearSelection} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Square size={14} /> إلغاء التحديد</button>
            <button onClick={onShowColumnSettings} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Settings size={14} /> الإعدادات</button>
            <button onClick={onToggleRowsExpanded} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" title={isRowsExpanded ? 'طي الصفوف' : 'توسيع الصفوف'}>
              {isRowsExpanded ? <Minimize size={14} /> : <Expand size={14} />}
              {isRowsExpanded ? 'طي الصفوف' : 'توسيع الصفوف'}
            </button>
            <button onClick={onOpenPrintPanel} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"><Printer size={14} /> طباعة / تصدير</button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative xl:col-span-2">
            <Search size={16} className="absolute right-3 top-3 text-slate-400" />
            <input type="text" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="ابحث بالاسم أو الكود أو رقم الفاتورة" className="w-full rounded-xl border border-slate-300 py-2.5 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40" />
          </label>

          <select title="تصفية حسب نوع العملية" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            <option value="all">كل العمليات</option>
            {OPERATION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <input type="text" value={partnerFilter} onChange={(event) => setPartnerFilter(event.target.value)} list="statement-partners" placeholder="المورد/العميل" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <datalist id="statement-partners">
            {partnerOptions.map((partner) => (
              <option key={partner} value={partner} />
            ))}
          </datalist>

          <div className="grid grid-cols-1 gap-2">
            <input title="تاريخ البداية" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            <input title="تاريخ النهاية" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={showActionsOnPrint} onChange={(event) => onShowActionsOnPrintChange(event.target.checked)} className="accent-emerald-600" />
          إظهار عمود الإجراءات داخل الجدول
        </label>
      </div>

      <div className="statement-print-wrap space-y-5">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700"><SlidersHorizontal size={16} className="text-blue-600" /> سجل كشف الحساب</div>
            <div className="text-xs text-slate-500">عدد السجلات: {sortedRows.length}</div>
          </div>

          <div className={`overflow-auto ${isRowsExpanded ? 'max-h-none' : 'max-h-[560px]'}`}>
            <table className="statement-table w-max min-w-full border-collapse text-center text-sm">
              <thead className="sticky top-0 z-30 bg-white">
                <tr className="border-b border-slate-200">
                  {visibleColumns.map((column) => {
                    const isActionColumn = column.key === 'actions';
                    if (isActionColumn && !showActionsOnPrint) {
                      return <th key={column.key} className="m-0 w-0 min-w-0 p-0 print:hidden" />;
                    }

                    const isActiveSort = sortKey === column.key;
                    return (
                      <th key={column.key} style={getColumnStyle(column, true)} className={`relative border-l border-slate-200 p-2 text-xs font-bold text-slate-600 ${isActionColumn && !showActionsOnPrint ? 'print:hidden' : ''}`}>
                        <button onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 hover:text-emerald-700">
                          {column.label}
                          {isActiveSort && <span className="text-emerald-700">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                        <div role="presentation" title="اسحب لتغيير عرض العمود" onMouseDown={(event) => startResize(event, column.key)} className={`absolute left-0 top-0 h-full w-1.5 cursor-col-resize ${activeResizeKey === column.key ? 'bg-emerald-400/60' : 'hover:bg-slate-300/60'}`} />
                      </th>
                    );
                  })}
                </tr>

                <tr className="no-print border-b border-slate-200">
                  {visibleColumns.map((column) => {
                    if (column.key === 'select' || column.key === 'rowNumber' || column.key === 'actions') {
                      return <th key={column.key} style={getColumnStyle(column)} className="border-l border-slate-100 bg-slate-50 p-1" />;
                    }

                    if (column.key === 'type') {
                      return (
                        <th key={column.key} style={getColumnStyle(column)} className="border-l border-slate-100 bg-slate-50 p-1">
                          <select title="تصفية حسب نوع العملية داخل الجدول" value={columnFilters[column.key] || ''} onChange={(event) => setColumnFilters((prev) => ({ ...prev, [column.key]: event.target.value }))} className="w-full rounded border border-slate-200 px-2 py-1 text-xs">
                            <option value="">الكل</option>
                            {OPERATION_TYPES.map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </th>
                      );
                    }

                    return (
                      <th key={column.key} style={getColumnStyle(column)} className="border-l border-slate-100 bg-slate-50 p-1">
                        <input type="text" value={columnFilters[column.key] || ''} onChange={(event) => setColumnFilters((prev) => ({ ...prev, [column.key]: event.target.value }))} placeholder="تصفية" className="w-full rounded border border-slate-200 px-2 py-1 text-xs" />
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    {visibleColumns.map((column) => {
                      const isActionColumn = column.key === 'actions';
                      const cellClass = `border-l border-slate-100 p-2 text-slate-700 ${isActionColumn && !showActionsOnPrint ? 'print:hidden' : ''}`;

                      if (column.key === 'select') {
                        return (
                          <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                            <button onClick={() => toggleRowSelection(row.id)} className="text-emerald-700">
                              {selectedIds.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          </td>
                        );
                      }

                      if (column.key === 'actions') {
                        return (
                          <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                            <button onClick={() => onInspectRow(row)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">عرض</button>
                          </td>
                        );
                      }

                      const rawValue = (row as Record<string, unknown>)[column.key];
                      const displayValue = isNumericColumn(column.key)
                        ? formatNumber(Number(rawValue || 0), ['delayMinutes', 'packageCount', 'rowNumber'].includes(column.key) ? 0 : 3)
                        : String(rawValue ?? '');

                      return (
                        <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} className="p-8 text-center font-bold text-slate-400">لا توجد بيانات مطابقة لعرضها في كشف الحساب.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Weight size={14} className="text-blue-600" /> إجمالي الوزن القائم</div><div className="mt-1 text-2xl font-extrabold text-slate-800">{formatNumber(summary.gross)} كجم</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Weight size={14} className="text-emerald-600" /> إجمالي الوزن الصافي</div><div className="mt-1 text-2xl font-extrabold text-slate-800">{formatNumber(summary.net)} كجم</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Scale size={14} className="text-amber-600" /> الفرق بين القائم والصافي</div><div className="mt-1 text-2xl font-extrabold text-slate-800">{formatNumber(summary.difference)} كجم</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><BadgeDollarSign size={14} className="text-red-600" /> إجمالي قيمة التأخير</div><div className="mt-1 text-2xl font-extrabold text-slate-800">{formatNumber(summary.delayAmount)} ج.م</div></div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-8 text-center md:grid-cols-3">
            {['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'].map((title) => (
              <div key={title}>
                <div className="h-12" />
                <div className="print-signature-line border-b border-slate-900" />
                <p className="mt-2 text-sm font-bold text-slate-700">{title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showColumnSettings && (
        <div className="no-print fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
              <h3 className="flex items-center gap-2 font-bold text-slate-800"><Settings size={16} /> إعدادات عرض الأعمدة</h3>
              <button onClick={onCloseColumnSettings} title="إغلاق" aria-label="إغلاق" className="text-slate-500 hover:text-red-600"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-5">
              {isForceUnified && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">تم فرض إعدادات الأعمدة بواسطة سياسة العرض الموحد، لذا يمكنك المراجعة فقط من هذه النافذة.</div>}
              <UniversalColumnManager columns={columns} onChange={setColumns} onReset={resetColumns} mode="user" disabled={isForceUnified} />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
              <button onClick={onCloseColumnSettings} className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700">إلغاء</button>
              <button onClick={saveColumns} className="rounded-lg bg-slate-900 px-4 py-2 text-white">حفظ</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StatementViewContent;