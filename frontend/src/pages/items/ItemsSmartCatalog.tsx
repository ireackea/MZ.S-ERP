import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Columns3,
  Edit3,
  FileCode,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  Layers,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import UniversalColumnManager from '../../components/UniversalColumnManager';
import { ItemOrderProfiles } from './ItemOrderProfiles';
import type { OrderProfileList } from '@services/itemsService';
import { useInventoryStore } from '../../store/useInventoryStore';
import { assertStorageKeyAllowed } from '../../services/storageOwnership';
import type { GridColumnPreference, Item, ItemSortMode } from '../../types';
import {
  SORTS,
  STATUS_FILTERS,
  formatQuantity,
  getItemStatusMeta,
  getProgressPercent,
  type StatusFilter,
} from './shared';

type ItemsSmartCatalogProps = {
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
  /** True while the order is being written, so the button can say so. */
  savingItemOrder: boolean;
  /** Gates the save button: writing the catalog order is `items.reorder`. */
  canReorder: boolean;
  /** The named, saved orders. Null until loaded, which is not the same as empty. */
  orderProfiles: OrderProfileList | null;
  /** Set when only a prefix of the catalogue is loaded; the panel explains it. */
  catalogTruncation: { truncated: boolean; total: number } | null;
  applyingOrderProfile: boolean;
  onCreateOrderProfile: (name: string) => void;
  onApplyOrderProfile: (id: string) => void;
  onRefreshOrderProfile: (id: string) => void;
  onRenameOrderProfile: (id: string, name: string) => void;
  onDeleteOrderProfile: (id: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  barcodeMode: boolean;
  onToggleBarcodeMode: () => void;
  onFileImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onGenerateCodes: () => void;
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

type AdvancedFilter = 'all' | 'missingCode' | 'missingBarcode' | 'missingDescription' | 'missingPackageWeight' | 'readyForOps';

type ColumnRenderContext = {
  item: Item;
  index: number;
  status: ReturnType<typeof getItemStatusMeta>;
  progressPercent: number;
  isSelected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

const ITEMS_CATALOG_COLUMNS: GridColumnPreference[] = [
  { key: 'select', label: 'تحديد', visible: true, order: 0, width: 64, frozen: true, locked: true },
  { key: 'rowNumber', label: '#', visible: true, order: 1, width: 64, frozen: true },
  { key: 'identity', label: 'هوية الصنف', visible: true, order: 2, width: 280, frozen: true, locked: true },
  { key: 'category', label: 'القسم', visible: true, order: 3, width: 150 },
  { key: 'unit', label: 'الوحدة', visible: true, order: 4, width: 110 },
  { key: 'stock', label: 'الرصيد', visible: true, order: 5, width: 130 },
  { key: 'limits', label: 'الحدود', visible: true, order: 6, width: 220 },
  { key: 'packageWeight', label: 'وزن العبوة', visible: true, order: 7, width: 130 },
  { key: 'dataQuality', label: 'جودة البيانات', visible: true, order: 8, width: 150 },
  { key: 'status', label: 'الحالة', visible: true, order: 9, width: 130 },
  { key: 'actions', label: 'إجراءات', visible: true, order: 10, width: 170, frozen: true, locked: true },
];

const advancedFilters: Array<{ value: AdvancedFilter; label: string }> = [
  { value: 'all', label: 'كل الأصناف' },
  { value: 'missingCode', label: 'بلا كود' },
  { value: 'missingBarcode', label: 'بلا باركود' },
  { value: 'missingDescription', label: 'بلا وصف' },
  { value: 'missingPackageWeight', label: 'بلا وزن عبوة' },
  { value: 'readyForOps', label: 'جاهز للتشغيل' },
];

const getQualityScore = (item: Item) => {
  const checks = [
    Boolean(String(item.name || '').trim()),
    Boolean(String(item.code || '').trim()),
    Boolean(String(item.barcode || '').trim()),
    Boolean(String(item.category || '').trim()),
    Boolean(String(item.unit || '').trim()),
    Boolean(String(item.englishName || '').trim()),
    item.packageWeight != null && Number(item.packageWeight) > 0,
    Number.isFinite(Number(item.minLimit)),
    Number.isFinite(Number(item.maxLimit)),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

const getQualityTone = (score: number) => {
  if (score >= 80) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (score >= 55) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
};

const cellStyle = (column: GridColumnPreference): React.CSSProperties => ({
  minWidth: column.width || 120,
  width: column.width || undefined,
});

const ItemsSmartCatalog: React.FC<ItemsSmartCatalogProps> = ({
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
  savingItemOrder,
  canReorder,
  orderProfiles,
  catalogTruncation,
  applyingOrderProfile,
  onCreateOrderProfile,
  onApplyOrderProfile,
  onRefreshOrderProfile,
  onRenameOrderProfile,
  onDeleteOrderProfile,
  showArchived,
  onToggleArchived,
  barcodeMode,
  onToggleBarcodeMode,
  onFileImport,
  onGenerateCodes,
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
  const getGridPreferences = useInventoryStore((state) => state.getGridPreferences);
  const setGridPreferences = useInventoryStore((state) => state.setGridPreferences);
  const resetGridPreferences = useInventoryStore((state) => state.resetGridPreferences);
  const [columns, setColumns] = useState<GridColumnPreference[]>(() => getGridPreferences('items_catalog', ITEMS_CATALOG_COLUMNS));
  const [showColumnManager, setShowColumnManager] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedFilter>('all');
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[]>(() => {
    try {
      assertStorageKeyAllowed('items.categoryOrder');
      const saved = localStorage.getItem('items.categoryOrder');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const orderedColumns = useMemo(() => columns.filter((column) => column.visible).sort((left, right) => left.order - right.order), [columns]);

  const categoryStats = useMemo(() => {
    const map = new Map<string, { name: string; count: number; warning: number; missing: number }>();
    for (const item of items) {
      const name = item.category || 'غير مصنف';
      const current = map.get(name) || { name, count: 0, warning: 0, missing: 0 };
      current.count += 1;
      if (getItemStatusMeta(item).key !== 'good') current.warning += 1;
      if (getQualityScore(item) < 80) current.missing += 1;
      map.set(name, current);
    }

    const allCategoryNames = Array.from(new Set([...availableCategories, ...map.keys()]));
    const natural = allCategoryNames.map((name) => map.get(name) || { name, count: 0, warning: 0, missing: 0 });
    const rank = new Map(categoryOrder.map((name, index) => [name, index]));
    return natural.sort((left, right) => {
      const leftRank = rank.get(left.name);
      const rightRank = rank.get(right.name);
      if (leftRank != null || rightRank != null) return (leftRank ?? 9999) - (rightRank ?? 9999);
      return left.name.localeCompare(right.name, 'ar-EG');
    });
  }, [availableCategories, categoryOrder, items]);

  const categoryRank = useMemo(() => new Map(categoryStats.map((entry, index) => [entry.name, index])), [categoryStats]);

  const smartItems = useMemo(() => {
    const filteredItems = visibleItems.filter((item) => {
      if (advancedFilter === 'missingCode') return !String(item.code || '').trim();
      if (advancedFilter === 'missingBarcode') return !String(item.barcode || '').trim();
      if (advancedFilter === 'missingDescription') return !String(item.englishName || '').trim();
      if (advancedFilter === 'missingPackageWeight') return item.packageWeight == null || Number(item.packageWeight) <= 0;
      if (advancedFilter === 'readyForOps') return getQualityScore(item) >= 80 && getItemStatusMeta(item).key === 'good';
      return true;
    });

    if (category !== 'all' || sortMode !== 'category_then_name') return filteredItems;

    const visibleIndex = new Map(visibleItems.map((item, index) => [String(item.id), index]));
    return [...filteredItems].sort((left, right) => {
      const leftRank = categoryRank.get(left.category || 'غير مصنف') ?? 9999;
      const rightRank = categoryRank.get(right.category || 'غير مصنف') ?? 9999;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (visibleIndex.get(String(left.id)) ?? 0) - (visibleIndex.get(String(right.id)) ?? 0);
    });
  }, [advancedFilter, category, categoryRank, sortMode, visibleItems]);

  const selectedDetailItem = useMemo(() => {
    if (!detailItemId) return null;
    return items.find((item) => String(item.id) === detailItemId) || smartItems.find((item) => String(item.id) === detailItemId) || null;
  }, [detailItemId, items, smartItems]);

  const insights = useMemo(() => {
    const missingCode = items.filter((item) => !String(item.code || '').trim()).length;
    const missingBarcode = items.filter((item) => !String(item.barcode || '').trim()).length;
    const missingPackageWeight = items.filter((item) => item.packageWeight == null || Number(item.packageWeight) <= 0).length;
    const averageQuality = items.length ? Math.round(items.reduce((sum, item) => sum + getQualityScore(item), 0) / items.length) : 0;
    return { missingCode, missingBarcode, missingPackageWeight, averageQuality };
  }, [items]);

  const applyColumns = (next: GridColumnPreference[]) => {
    setColumns(next);
    setGridPreferences('items_catalog', next);
  };

  const resetColumns = () => {
    resetGridPreferences('items_catalog', ITEMS_CATALOG_COLUMNS);
    setColumns(getGridPreferences('items_catalog', ITEMS_CATALOG_COLUMNS));
  };

  const moveCategory = (name: string, direction: 'up' | 'down') => {
    const current = categoryStats.map((entry) => entry.name);
    const index = current.indexOf(name);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setCategoryOrder(next);
    assertStorageKeyAllowed('items.categoryOrder');
    localStorage.setItem('items.categoryOrder', JSON.stringify(next));
  };

  const renderCell = (column: GridColumnPreference, context: ColumnRenderContext) => {
    const { item, index, status, progressPercent, isSelected, canMoveUp, canMoveDown } = context;
    const qualityScore = getQualityScore(item);

    if (column.key === 'select') {
      return <button type="button" onClick={() => onToggleSelection(String(item.id))}>{isSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>;
    }

    if (column.key === 'rowNumber') return <span className="font-mono text-xs text-slate-500">{index + 1}</span>;

    if (column.key === 'identity') {
      return (
        <button type="button" onClick={() => setDetailItemId(String(item.id))} className="block w-full text-right">
          <div className="flex flex-wrap items-center gap-2">
            {item.code ? <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{item.code}</span> : <span className="rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-700">بلا كود</span>}
            {item.barcode ? <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700">{item.barcode}</span> : null}
          </div>
          <div className="mt-1 font-black text-slate-900">{item.name}</div>
          {item.englishName ? <div className="text-xs text-slate-500">{item.englishName}</div> : null}
        </button>
      );
    }

    if (column.key === 'category') return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{item.category}</span>;
    if (column.key === 'unit') return <span className="font-bold text-slate-800">{item.unit}</span>;
    if (column.key === 'stock') return <span className="font-black text-slate-900">{formatQuantity(item.currentStock)}</span>;

    if (column.key === 'limits') {
      return (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-2 rounded-full ${status.barClassName}`} style={{ width: `${progressPercent}%` }} /></div>
          <div className="flex justify-between text-[11px] text-slate-500"><span>أدنى {formatQuantity(item.minLimit)}</span><span>أعلى {formatQuantity(item.maxLimit)}</span></div>
        </div>
      );
    }

    if (column.key === 'packageWeight') return item.packageWeight ? <span>{formatQuantity(item.packageWeight)}</span> : <span className="text-xs text-amber-700">غير محدد</span>;
    if (column.key === 'dataQuality') return <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getQualityTone(qualityScore)}`}>{qualityScore}%</span>;
    if (column.key === 'status') return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${status.chipClassName}`}><status.icon size={12} />{status.label}</span>;

    if (column.key === 'actions') {
      return (
        <div className="flex flex-wrap items-center gap-1">
          {/* Gated on `canEdit` and positioned inside the visible list.
              They were previously gated on neither, so a read-only user could
              rearrange the catalog while the save button beside them was
              disabled, and the position was read from the unfiltered array
              while the row was rendered from the filtered one — with a filter
              active the arrow appeared to do nothing. */}
          {!showArchived && <button type="button" disabled={!canMoveUp} onClick={() => onMoveItem(String(item.id), 'up')} className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40" title="تحريك لأعلى"><ChevronUp size={14} /></button>}
          {!showArchived && <button type="button" disabled={!canMoveDown} onClick={() => onMoveItem(String(item.id), 'down')} className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40" title="تحريك لأسفل"><ChevronDown size={14} /></button>}
          {canEdit && !showArchived && <button type="button" onClick={() => onOpenEdit(item)} className="rounded-lg border border-slate-300 p-1 text-slate-700" title="تعديل"><Edit3 size={14} /></button>}
          {canUpload && !showArchived && <button type="button" onClick={() => onOpenUpload(item, 'image')} className="rounded-lg border border-slate-300 p-1 text-slate-700" title="رفع مرفق"><Upload size={14} /></button>}
          {canArchive && !showArchived && <button type="button" onClick={() => onOpenPendingAction('archive', [String(item.id)], item.name)} className="rounded-lg border border-amber-300 p-1 text-amber-700" title="أرشفة"><Archive size={14} /></button>}
          {showArchived && canRestore && <button type="button" onClick={() => onOpenPendingAction('restore', [String(item.id)], item.name)} className="rounded-lg border border-emerald-300 p-1 text-emerald-700" title="استعادة"><RotateCcw size={14} /></button>}
          {showArchived && canDelete && <button type="button" onClick={() => onOpenPendingAction('purge', [String(item.id)], item.name)} className="rounded-lg border border-red-300 p-1 text-red-700" title="حذف نهائي"><Trash2 size={14} /></button>}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-slate-900 p-3 text-white"><LayoutDashboard size={24} /></div>
            <div>
              <h1 className="text-2xl font-black text-slate-900">سجل الأصناف التشغيلي</h1>
              <p className="mt-1 text-sm text-slate-500">تنظيم الأقسام، ترتيب الأصناف، البحث المتقدم، والتحكم الكامل في أعمدة بيانات الصنف.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={refreshItemsPage} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><RefreshCcw size={15} /> تحديث</button>
            {canImport && <button type="button" onClick={onTemplateDownload} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><FileSpreadsheet size={15} /> قالب</button>}
            {canExportExcel && <button type="button" onClick={onExcelExport} className="inline-flex items-center gap-2 rounded-2xl border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700"><FileSpreadsheet size={15} /> Excel</button>}
            {canPrint && <button type="button" onClick={onPrintItemsPdf} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><Printer size={15} /> PDF</button>}
            {canImport && <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><FileUp size={15} /> استيراد<input type="file" accept=".xlsx,.xls" onChange={onFileImport} className="hidden" /></label>}
            {canGenerateCodes && <button type="button" onClick={onGenerateCodes} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"><FileCode size={15} /> توليد الأكواد</button>}
            {canEdit && <button type="button" onClick={onOpenCreate} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white"><Plus size={15} /> صنف جديد</button>}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">إجمالي الأصناف</div><div className="mt-2 text-2xl font-black text-slate-900">{formatQuantity(catalogTruncation?.truncated ? catalogTruncation.total : stats.totalItems)}</div>{catalogTruncation?.truncated && <div className="mt-1 text-xs font-bold text-amber-700">معروض الآن {formatQuantity(stats.totalItems)} منها</div>}</div>
        <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">منخفضة أو حرجة</div><div className="mt-2 text-2xl font-black text-amber-700">{formatQuantity(stats.warningItems)}</div></div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">متوسط جودة البيانات</div><div className="mt-2 text-2xl font-black text-emerald-700">{insights.averageQuality}%</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm text-slate-500">نواقص حرجة</div><div className="mt-2 text-sm font-bold text-slate-800">{insights.missingCode} بلا كود - {insights.missingBarcode} بلا باركود - {insights.missingPackageWeight} بلا وزن</div></div>
      </div>

      <ItemOrderProfiles
        profiles={orderProfiles?.profiles ?? null}
        catalogSize={orderProfiles?.catalogSize ?? 0}
        catalogTruncation={catalogTruncation}
        activeProfileId={orderProfiles?.activeProfileId ?? null}
        busy={applyingOrderProfile}
        canReorder={canReorder}
        onSaveAs={(name) => onCreateOrderProfile(name)}
        onApply={(id) => onApplyOrderProfile(id)}
        onRefresh={(id) => onRefreshOrderProfile(id)}
        onRename={(id, name) => onRenameOrderProfile(id, name)}
        onDelete={(id) => onDeleteOrderProfile(id)}
      />

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} className="w-full rounded-2xl border border-slate-300 py-3 pl-3 pr-10 text-sm" placeholder="بحث ذكي: الاسم، الكود، الباركود، القسم، الوحدة، الوصف..." />
          </div>
          <select value={category} onChange={(event) => onCategoryChange(event.target.value)} className="rounded-2xl border border-slate-300 px-3 py-3 text-sm">
            <option value="all">كل الأقسام</option>
            {availableCategories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)} className="rounded-2xl border border-slate-300 px-3 py-3 text-sm">
            {STATUS_FILTERS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          {/* A preview, not a saved order. Choosing one of these changes what is on
              screen and saves nothing; the panel above is where it is given a name.
              The old wording made it look like picking a sort had already been
              saved, which is the confusion this note removes. */}
          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-3 text-sm">
            <span className="text-xs font-bold text-slate-500">معاينة الترتيب</span>
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as ItemSortMode)} className="rounded-xl border border-slate-300 px-2 py-1 text-sm">
              {SORTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={onLockOrder} disabled={!canReorder || savingItemOrder} className="inline-flex items-center gap-2 rounded-2xl border border-amber-300 px-3 py-3 text-sm font-bold text-amber-700 disabled:opacity-50" title={showArchived ? 'الترتيب يُحفظ من قائمة الأصناف النشطة' : 'يحفظ الترتيب المعروض الآن للجميع، بلا اسم'}>
            <Settings2 size={15} /> {savingItemOrder ? 'جارٍ الحفظ…' : 'حفظ الترتيب الحالي'}
          </button>
          <button type="button" onClick={onToggleArchived} className={`rounded-2xl border px-3 py-3 text-sm font-bold ${showArchived ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700'}`}>{showArchived ? 'الأصناف النشطة' : 'المؤرشفة'}</button>
          <button type="button" onClick={onToggleBarcodeMode} className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-bold ${barcodeMode ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700'}`}><ScanLine size={15} /> مسح</button>
          <button type="button" onClick={() => setShowColumnManager((value) => !value)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-3 text-sm font-bold text-slate-700"><Columns3 size={15} /> الأعمدة</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {advancedFilters.map((filter) => (
            <button key={filter.value} type="button" onClick={() => setAdvancedFilter(filter.value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${advancedFilter === filter.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{filter.label}</button>
          ))}
        </div>

        {showColumnManager ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <UniversalColumnManager columns={columns} onChange={applyColumns} onReset={resetColumns} />
          </div>
        ) : null}
      </section>

      {selectedCount > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-900">
            <span className="font-black">{selectedCount} صنف محدد</span>
            {!showArchived && canEdit && <button type="button" onClick={onOpenBulk} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700">تعديل جماعي</button>}
            {!showArchived && canArchive && <button type="button" onClick={() => onOpenPendingAction('archive', [...selected], `${selectedCount} صنف`)} className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-amber-700">أرشفة</button>}
            {showArchived && canRestore && <button type="button" onClick={() => onOpenPendingAction('restore', [...selected], `${selectedCount} صنف`)} className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-emerald-700">استعادة</button>}
            {showArchived && canDelete && <button type="button" onClick={() => onOpenPendingAction('purge', [...selected], `${selectedCount} صنف`)} className="rounded-xl border border-red-300 bg-white px-3 py-2 text-red-700">حذف نهائي</button>}
            <button type="button" onClick={onClearSelection} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700">إلغاء التحديد</button>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><Layers size={18} className="text-slate-700" /><h2 className="font-black text-slate-900">ترتيب الأقسام</h2></div>
          <div className="space-y-2">
            <button type="button" onClick={() => onCategoryChange('all')} className={`w-full rounded-2xl border px-3 py-3 text-right text-sm font-bold ${category === 'all' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'}`}>كل الأقسام - {items.length}</button>
            {categoryStats.map((entry, index) => (
              <div key={entry.name} className={`rounded-2xl border p-3 ${category === entry.name ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <button type="button" onClick={() => onCategoryChange(entry.name)} className="w-full text-right">
                  <div className="font-black text-slate-900">{entry.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{entry.count} صنف - {entry.warning} تنبيه - {entry.missing} ناقص بيانات</div>
                </button>
                <div className="mt-2 flex gap-1">
                  <button type="button" onClick={() => moveCategory(entry.name, 'up')} disabled={index === 0} className="rounded-lg border border-slate-200 p-1 text-slate-600 disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => moveCategory(entry.name, 'down')} disabled={index === categoryStats.length - 1} className="rounded-lg border border-slate-200 p-1 text-slate-600 disabled:opacity-30"><ArrowDown size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="font-black text-slate-900">شبكة بيانات الأصناف</h2>
              <p className="text-xs text-slate-500">{smartItems.length} نتيجة مع فلترة الأعمدة والترتيب المخصص.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"><SlidersHorizontal size={14} /> {advancedFilters.find((entry) => entry.value === advancedFilter)?.label}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  {orderedColumns.map((column) => (
                    <th key={column.key} className="px-3 py-3 text-right" style={cellStyle(column)}>{column.key === 'select' ? <button type="button" onClick={onSelectAll}>{allSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button> : column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableLoading && <tr><td colSpan={orderedColumns.length} className="px-4 py-12 text-center text-slate-500">جاري تحميل الأصناف...</td></tr>}
                {!tableLoading && tableError && <tr><td colSpan={orderedColumns.length} className="px-4 py-12 text-center text-red-600">{tableError}</td></tr>}
                {!tableLoading && !tableError && smartItems.length === 0 && <tr><td colSpan={orderedColumns.length} className="px-4 py-12 text-center text-slate-500">لا توجد أصناف مطابقة للفلاتر الحالية.</td></tr>}
                {!tableLoading && !tableError && smartItems.map((item, index) => {
                  const status = getItemStatusMeta(item);
                  const progressPercent = getProgressPercent(item);
                  const isSelected = selected.has(String(item.id));
                  // The position that decides whether an arrow is usable has to
                  // be the position of the row the user is looking at. Reading it
                  // from the unfiltered `items` made the first visible row under a
                  // filter look movable when the neighbour it would have swapped
                  // with was filtered out of sight.
                  const visibleIndex = smartItems.findIndex((entry) => String(entry.id) === String(item.id));
                  const canMoveUp = canReorder && !showArchived && sortMode === 'manual_locked' && visibleIndex > 0;
                  const canMoveDown = canReorder && !showArchived && sortMode === 'manual_locked' && visibleIndex >= 0 && visibleIndex < smartItems.length - 1;
                  const context = { item, index, status, progressPercent, isSelected, canMoveUp, canMoveDown };

                  return (
                    <tr key={String(item.id)} className={`border-t border-slate-200 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}`}>
                      {orderedColumns.map((column) => <td key={column.key} className="px-3 py-3 align-middle" style={cellStyle(column)}>{renderCell(column, context)}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selectedDetailItem ? (
        <div className="fixed inset-y-0 left-0 z-50 w-full max-w-xl overflow-y-auto border-r border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-500">ملف الصنف</div>
              <h2 className="mt-1 text-2xl font-black text-slate-900">{selectedDetailItem.name}</h2>
              <p className="text-sm text-slate-500">{selectedDetailItem.code || 'بلا كود'} - {selectedDetailItem.category} - {selectedDetailItem.unit}</p>
            </div>
            <button type="button" onClick={() => setDetailItemId(null)} className="rounded-full border border-slate-300 p-2 text-slate-500"><X size={18} /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4"><div className="text-xs text-slate-500">الرصيد الحالي</div><div className="mt-1 text-xl font-black text-slate-900">{formatQuantity(selectedDetailItem.currentStock)} {selectedDetailItem.unit}</div></div>
            <div className="rounded-2xl border border-slate-200 p-4"><div className="text-xs text-slate-500">جودة البيانات</div><div className="mt-1 text-xl font-black text-slate-900">{getQualityScore(selectedDetailItem)}%</div></div>
            <div className="rounded-2xl border border-slate-200 p-4"><div className="text-xs text-slate-500">الباركود</div><div className="mt-1 font-mono text-sm text-slate-900">{selectedDetailItem.barcode || 'غير محدد'}</div></div>
            <div className="rounded-2xl border border-slate-200 p-4"><div className="text-xs text-slate-500">وزن العبوة</div><div className="mt-1 font-bold text-slate-900">{selectedDetailItem.packageWeight ? formatQuantity(selectedDetailItem.packageWeight) : 'غير محدد'}</div></div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <h3 className="font-black text-slate-900">الحدود والمخزون</h3>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`${getItemStatusMeta(selectedDetailItem).barClassName} h-3 rounded-full`} style={{ width: `${getProgressPercent(selectedDetailItem)}%` }} /></div>
            <div className="mt-2 flex justify-between text-xs text-slate-500"><span>أدنى {formatQuantity(selectedDetailItem.minLimit)}</span><span>إعادة الطلب {selectedDetailItem.orderLimit == null ? '-' : formatQuantity(selectedDetailItem.orderLimit)}</span><span>أعلى {formatQuantity(selectedDetailItem.maxLimit)}</span></div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 p-4">
            <h3 className="font-black text-slate-900">اقتراحات تحسين ملف الصنف</h3>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              {!selectedDetailItem.code ? <div>أضف كوداً أو استخدم توليد الأكواد لرفع جودة البحث والتقارير.</div> : null}
              {!selectedDetailItem.barcode ? <div>إضافة باركود ستجعل المسح السريع أدق في المخزن.</div> : null}
              {!selectedDetailItem.englishName ? <div>الوصف يساعد في الاستيراد والبحث متعدد اللغات.</div> : null}
              {!selectedDetailItem.packageWeight ? <div>وزن العبوة مهم لحسابات العبوات والحركات.</div> : null}
              {getQualityScore(selectedDetailItem) >= 90 ? <div>ملف الصنف مكتمل تقريباً وجاهز للتشغيل اليومي.</div> : null}
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            {canEdit && <button type="button" onClick={() => onOpenEdit(selectedDetailItem)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"><Edit3 size={16} /> تعديل البيانات</button>}
            {canUpload && <button type="button" onClick={() => onOpenUpload(selectedDetailItem, 'image')} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"><Upload size={16} /> مرفق</button>}
          </div>
        </div>
      ) : null}

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
    </div>
  );
};

export default ItemsSmartCatalog;
