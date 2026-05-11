import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileCode,
  FileSpreadsheet,
  FileUp,
  Layers,
  LayoutGrid,
  LayoutList,
  Lock,
  Package,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Item, ItemSortMode } from '../../types';
import {
  SORTS,
  STATUS_FILTERS,
  formatQuantity,
  getItemStatusMeta,
  getProgressPercent,
  type StatusFilter,
  type ViewMode,
} from './shared';

type StatsCard = {
  label: string;
  value: number;
  icon: typeof Package;
  iconClassName: string;
};

type ItemsCatalogProps = {
  stats: { totalItems: number; warningItems: number; totalQuantity: number; categoriesCount: number };
  canImport: boolean;
  canExportExcel: boolean;
  canPrint: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canDelete: boolean;
  canGenerateCodes: boolean;
  canUpload: boolean;
  refreshItemsPage: () => void;
  onTemplateDownload: () => void;
  onExcelExport: () => void;
  onPrintItemsPdf: () => void;
  onOpenCreate: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  sortMode: ItemSortMode;
  onSortModeChange: (value: ItemSortMode) => void;
  availableCategories: string[];
  onLockOrder: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  barcodeMode: boolean;
  onToggleBarcodeMode: () => void;
  onFileImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerateCodes: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectedCount: number;
  onOpenBulk: () => void;
  onOpenPendingAction: (mode: 'archive' | 'restore' | 'purge', ids: string[], label: string) => void;
  onClearSelection: () => void;
  tableLoading: boolean;
  tableError: string | null;
  visibleItems: Item[];
  items: Item[];
  selected: Set<string>;
  onToggleSelection: (id: string) => void;
  allSelected: boolean;
  onSelectAll: () => void;
  onMoveItem: (id: string, direction: 'up' | 'down') => void;
  onOpenEdit: (item: Item) => void;
  onOpenUpload: (item: Item, type?: 'image' | 'file') => void;
  barcodeInput: string;
  onBarcodeInputChange: (value: string) => void;
  barcodeInputRef: React.RefObject<HTMLInputElement | null>;
  onBarcodeSubmit: () => void;
};

const ItemsCatalog: React.FC<ItemsCatalogProps> = ({
  stats,
  canImport,
  canExportExcel,
  canPrint,
  canEdit,
  canArchive,
  canRestore,
  canDelete,
  canGenerateCodes,
  canUpload,
  refreshItemsPage,
  onTemplateDownload,
  onExcelExport,
  onPrintItemsPdf,
  onOpenCreate,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  statusFilter,
  onStatusFilterChange,
  sortMode,
  onSortModeChange,
  availableCategories,
  onLockOrder,
  showArchived,
  onToggleArchived,
  barcodeMode,
  onToggleBarcodeMode,
  onFileImport,
  onGenerateCodes,
  viewMode,
  onViewModeChange,
  selectedCount,
  onOpenBulk,
  onOpenPendingAction,
  onClearSelection,
  tableLoading,
  tableError,
  visibleItems,
  items,
  selected,
  onToggleSelection,
  allSelected,
  onSelectAll,
  onMoveItem,
  onOpenEdit,
  onOpenUpload,
  barcodeInput,
  onBarcodeInputChange,
  barcodeInputRef,
  onBarcodeSubmit,
}) => {
  const cards: StatsCard[] = [
    { label: 'إجمالي الأصناف', value: stats.totalItems, icon: Package, iconClassName: 'bg-blue-50 text-blue-600' },
    { label: 'أصناف منخفضة أو حرجة', value: stats.warningItems, icon: AlertTriangle, iconClassName: 'bg-amber-50 text-amber-600' },
    { label: 'إجمالي الكمية الحالية', value: stats.totalQuantity, icon: FileSpreadsheet, iconClassName: 'bg-emerald-50 text-emerald-600' },
    { label: 'عدد التصنيفات', value: stats.categoriesCount, icon: Layers, iconClassName: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatQuantity(card.value)}</p>
              </div>
              <div className={`rounded-2xl p-3 ${card.iconClassName}`}><card.icon size={24} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">إدارة الأصناف</h1>
              <p className="text-sm text-slate-500">واجهة تشغيل موحدة للأصناف النشطة والمؤرشفة مع مؤشرات المخزون وعمليات الاستيراد والتتبع.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={refreshItemsPage} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><RefreshCcw size={14} /> تحديث</button>
              {canImport && <button type="button" onClick={onTemplateDownload} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet size={14} /> قالب الاستيراد</button>}
              {canExportExcel && <button type="button" onClick={onExcelExport} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileSpreadsheet size={14} /> تصدير Excel</button>}
              {canPrint && <button type="button" onClick={onPrintItemsPdf} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Printer size={14} /> PDF</button>}
              {canEdit && <button type="button" onClick={onOpenCreate} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={14} /> إضافة صنف</button>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => onSearchChange(event.target.value)} aria-label="بحث الأصناف" className="w-full rounded-xl border border-slate-300 py-2 pl-3 pr-8 text-sm" placeholder="بحث بالاسم، الكود، الباركود، الاسم الإنجليزي، التصنيف أو الوحدة..." />
            </div>
            <select aria-label="تصفية حسب التصنيف" value={category} onChange={(event) => onCategoryChange(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="all">كل التصنيفات</option>
              {availableCategories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {STATUS_FILTERS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            <select aria-label="ترتيب الأصناف" value={sortMode} onChange={(event) => onSortModeChange(event.target.value as ItemSortMode)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {SORTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            {canEdit && <button type="button" onClick={onLockOrder} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${sortMode === 'manual_locked' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}><Lock size={14} /> قفل الترتيب اليدوي</button>}
            <button type="button" onClick={onToggleArchived} className={`rounded-xl border px-3 py-2 text-sm font-medium ${showArchived ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{showArchived ? 'عرض الأصناف النشطة' : 'عرض المؤرشفة'}</button>
            <button type="button" onClick={onToggleBarcodeMode} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${barcodeMode ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}><ScanLine size={14} /> {barcodeMode ? 'إيقاف المسح' : 'مسح باركود'}</button>
            {canImport && <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileUp size={14} /> استيراد Excel<input type="file" accept=".xlsx,.xls" onChange={onFileImport} className="hidden" /></label>}
            {canGenerateCodes && <button type="button" onClick={onGenerateCodes} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FileCode size={14} /> توليد الأكواد</button>}
            <div className="mr-auto flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button type="button" onClick={() => onViewModeChange('list')} className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} aria-label="عرض جدولي"><LayoutList size={16} /></button>
              <button type="button" onClick={() => onViewModeChange('grid')} className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} aria-label="عرض بطاقات"><LayoutGrid size={16} /></button>
            </div>
          </div>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-900">
            <span className="font-bold">{selectedCount} صنف محدد</span>
            {!showArchived && canEdit && <button type="button" onClick={onOpenBulk} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700">تعديل جماعي</button>}
            {!showArchived && canArchive && <button type="button" onClick={() => onOpenPendingAction('archive', [...selected], `${selectedCount} صنف`)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-amber-700">أرشفة المحدد</button>}
            {showArchived && canRestore && <button type="button" onClick={() => onOpenPendingAction('restore', [...selected], `${selectedCount} صنف`)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-emerald-700">استعادة المحدد</button>}
            {showArchived && canDelete && <button type="button" onClick={() => onOpenPendingAction('purge', [...selected], `${selectedCount} صنف`)} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-red-700">حذف نهائي</button>}
            <button type="button" onClick={onClearSelection} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700">إلغاء التحديد</button>
          </div>
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-3 text-right"><button type="button" onClick={onSelectAll} aria-label={allSelected ? 'إلغاء تحديد كل الأصناف' : 'تحديد كل الأصناف'}>{allSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button></th>
                <th className="px-3 py-3 text-right">#</th>
                <th className="px-3 py-3 text-right">الكود / الاسم</th>
                <th className="px-3 py-3 text-right">التصنيف</th>
                <th className="px-3 py-3 text-right">مؤشر المخزون</th>
                <th className="px-3 py-3 text-right">الكمية</th>
                <th className="px-3 py-3 text-right">الحالة</th>
                <th className="px-3 py-3 text-right">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">جاري التحميل...</td></tr>}
              {!tableLoading && tableError && <tr><td colSpan={8} className="px-4 py-10 text-center text-red-600">{tableError}</td></tr>}
              {!tableLoading && !tableError && visibleItems.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">{showArchived ? 'لا توجد أصناف مؤرشفة مطابقة للفلترة الحالية.' : 'لا توجد أصناف مطابقة للفلترة الحالية.'}</td></tr>}
              {!tableLoading && !tableError && visibleItems.map((item, index) => {
                const status = getItemStatusMeta(item);
                const progressPercent = getProgressPercent(item);
                const isSelected = selected.has(String(item.id));
                const globalIndex = items.findIndex((entry) => String(entry.id) === String(item.id));
                const canMoveUp = !showArchived && sortMode === 'manual_locked' && globalIndex > 0;
                const canMoveDown = !showArchived && sortMode === 'manual_locked' && globalIndex >= 0 && globalIndex < items.length - 1;

                return (
                  <tr key={String(item.id)} className={`border-t border-slate-200 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-3"><button type="button" onClick={() => onToggleSelection(String(item.id))}>{isSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button></td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">{index + 1}</td>
                    <td className="px-3 py-3"><div className="flex flex-col gap-1"><div className="flex flex-wrap items-center gap-2">{item.code && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{item.code}</span>}{item.barcode && <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700">{item.barcode}</span>}<span className="font-semibold text-slate-900">{item.name}</span></div>{item.englishName && <div className="text-xs text-slate-400">{item.englishName}</div>}</div></td>
                    <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{item.category}</span></td>
                    <td className="px-3 py-3"><div className="space-y-1"><div className="h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${status.barClassName}`} style={{ width: `${progressPercent}%` }} /></div><div className="flex justify-between text-[11px] text-slate-400"><span>{formatQuantity(item.minLimit)}</span><span>{formatQuantity(item.maxLimit)}</span></div></div></td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{formatQuantity(item.currentStock)} <span className="text-xs font-normal text-slate-500">{item.unit}</span></td>
                    <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${status.chipClassName}`}><status.icon size={12} />{status.label}</span></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap items-center gap-1">{!showArchived && <><button type="button" disabled={!canMoveUp} onClick={() => onMoveItem(String(item.id), 'up')} className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40" title="تحريك لأعلى"><ChevronUp size={14} /></button><button type="button" disabled={!canMoveDown} onClick={() => onMoveItem(String(item.id), 'down')} className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40" title="تحريك لأسفل"><ChevronDown size={14} /></button></>}{canEdit && !showArchived && <button type="button" onClick={() => onOpenEdit(item)} className="rounded-lg border border-slate-300 p-1 text-slate-700" title={`تعديل الصنف ${item.name}`}><Edit3 size={14} /></button>}{canUpload && !showArchived && <button type="button" onClick={() => onOpenUpload(item, 'image')} className="rounded-lg border border-slate-300 p-1 text-slate-700" title={`رفع مرفق للصنف ${item.name}`}><Upload size={14} /></button>}{canArchive && !showArchived && <button type="button" onClick={() => onOpenPendingAction('archive', [String(item.id)], item.name)} className="rounded-lg border border-amber-300 p-1 text-amber-700" title={`أرشفة الصنف ${item.name}`}><Archive size={14} /></button>}{showArchived && canRestore && <button type="button" onClick={() => onOpenPendingAction('restore', [String(item.id)], item.name)} className="rounded-lg border border-emerald-300 p-1 text-emerald-700" title={`استعادة الصنف ${item.name}`}><RotateCcw size={14} /></button>}{showArchived && canDelete && <button type="button" onClick={() => onOpenPendingAction('purge', [String(item.id)], item.name)} className="rounded-lg border border-red-300 p-1 text-red-700" title={`حذف الصنف ${item.name} نهائياً`}><Trash2 size={14} /></button>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {tableLoading && <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">جاري التحميل...</div>}
            {!tableLoading && tableError && <div className="col-span-full rounded-2xl border border-red-200 bg-white p-8 text-center text-red-600">{tableError}</div>}
            {!tableLoading && !tableError && visibleItems.length === 0 && <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">{showArchived ? 'لا توجد أصناف مؤرشفة مطابقة للفلترة الحالية.' : 'لا توجد أصناف مطابقة للفلترة الحالية.'}</div>}
            {!tableLoading && !tableError && visibleItems.map((item) => {
              const status = getItemStatusMeta(item);
              const progressPercent = getProgressPercent(item);
              const isSelected = selected.has(String(item.id));
              const globalIndex = items.findIndex((entry) => String(entry.id) === String(item.id));
              const canMoveUp = !showArchived && sortMode === 'manual_locked' && globalIndex > 0;
              const canMoveDown = !showArchived && sortMode === 'manual_locked' && globalIndex >= 0 && globalIndex < items.length - 1;

              return (
                <motion.article key={String(item.id)} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={`relative rounded-2xl border bg-white p-5 shadow-sm ring-1 ${isSelected ? 'border-emerald-400 ring-emerald-500/20' : `${status.cardClassName} ring-transparent`}`}>
                  <button type="button" onClick={() => onToggleSelection(String(item.id))} className="absolute left-4 top-4 text-slate-500">{isSelected ? <CheckSquare size={18} /> : <Square size={18} />}</button>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2">{item.code && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{item.code}</span>}{item.barcode && <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700">{item.barcode}</span>}</div><div><h3 className="text-lg font-bold text-slate-900">{item.name}</h3>{item.englishName && <p className="text-sm text-slate-400">{item.englishName}</p>}</div></div><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${status.chipClassName}`}><status.icon size={12} />{status.label}</span></div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><span className="text-sm text-slate-500">التصنيف</span><span className="font-medium text-slate-800">{item.category}</span></div>
                    <div><div className="mb-2 flex items-center justify-between text-xs text-slate-500"><span>الكمية الحالية</span><span>{formatQuantity(item.currentStock)} {item.unit}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${status.barClassName}`} style={{ width: `${progressPercent}%` }} /></div><div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>Min: {formatQuantity(item.minLimit)}</span><span>Max: {formatQuantity(item.maxLimit)}</span></div></div>
                    <div className="flex flex-wrap items-center gap-2">{!showArchived && <><button type="button" disabled={!canMoveUp} onClick={() => onMoveItem(String(item.id), 'up')} className="rounded-lg border border-slate-300 p-2 text-slate-600 disabled:opacity-40" title="تحريك لأعلى"><ChevronUp size={14} /></button><button type="button" disabled={!canMoveDown} onClick={() => onMoveItem(String(item.id), 'down')} className="rounded-lg border border-slate-300 p-2 text-slate-600 disabled:opacity-40" title="تحريك لأسفل"><ChevronDown size={14} /></button></>}{canEdit && !showArchived && <button type="button" onClick={() => onOpenEdit(item)} className="rounded-lg border border-slate-300 p-2 text-slate-700" title={`تعديل الصنف ${item.name}`}><Edit3 size={14} /></button>}{canUpload && !showArchived && <button type="button" onClick={() => onOpenUpload(item, 'image')} className="rounded-lg border border-slate-300 p-2 text-slate-700" title={`رفع مرفق للصنف ${item.name}`}><Upload size={14} /></button>}{canArchive && !showArchived && <button type="button" onClick={() => onOpenPendingAction('archive', [String(item.id)], item.name)} className="rounded-lg border border-amber-300 p-2 text-amber-700" title={`أرشفة الصنف ${item.name}`}><Archive size={14} /></button>}{showArchived && canRestore && <button type="button" onClick={() => onOpenPendingAction('restore', [String(item.id)], item.name)} className="rounded-lg border border-emerald-300 p-2 text-emerald-700" title={`استعادة الصنف ${item.name}`}><RotateCcw size={14} /></button>}{showArchived && canDelete && <button type="button" onClick={() => onOpenPendingAction('purge', [String(item.id)], item.name)} className="rounded-lg border border-red-300 p-2 text-red-700" title={`حذف الصنف ${item.name} نهائياً`}><Trash2 size={14} /></button>}</div>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {barcodeMode && (
        <div className="fixed bottom-4 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 rounded-2xl border border-emerald-300 bg-white p-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <ScanLine className="text-emerald-600" size={18} />
            <input ref={barcodeInputRef} value={barcodeInput} onChange={(event) => onBarcodeInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onBarcodeSubmit(); } }} placeholder="امسح الباركود أو أدخل الكود ثم اضغط Enter" className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={onBarcodeSubmit} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white">بحث</button>
            <button type="button" onClick={onToggleBarcodeMode} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"><X size={14} /></button>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemsCatalog;