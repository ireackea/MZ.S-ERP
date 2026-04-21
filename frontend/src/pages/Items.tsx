// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 Final Visual Proof & Cleanup - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 6.6 - Global 100% Cleanup & Absolute Verification - 2026-03-13

import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Edit3,
  FileCode,
  FileSpreadsheet,
  FileUp,
  LayoutGrid,
  LayoutList,
  Layers,
  Lock,
  Package,
  Plus,
  Printer,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { logUserActivity } from '../services/iamService';
import type { Item, ItemSortMode } from '../types';
import { useInventoryStore, sortItems } from '../store/useInventoryStore';
import {
  bulkImportFromExcel,
  generateMissingCodes,
  getItems as getItemsFromApi,
  parseExcelFile,
  uploadItemAttachment,
  type ExcelImportRow,
  type ItemDto,
} from '@services/itemsService';

type ViewMode = 'list' | 'grid';
type StatusFilter = 'all' | 'good' | 'warning' | 'critical';
type PendingActionMode = 'archive' | 'restore' | 'purge';

type ItemEditorForm = {
  id?: string;
  name: string;
  code: string;
  barcode: string;
  englishName: string;
  category: string;
  unit: string;
  minLimit: string;
  maxLimit: string;
  orderLimit: string;
  currentStock: string;
};

type BulkEditorForm = {
  category: string;
  unit: string;
  minLimit: string;
  maxLimit: string;
  orderLimit: string;
};

type PendingActionState = {
  mode: PendingActionMode;
  ids: string[];
  title: string;
  description: string;
  confirmLabel: string;
  confirmClassName: string;
};

type ItemStatusMeta = {
  key: Exclude<StatusFilter, 'all'>;
  label: string;
  chipClassName: string;
  barClassName: string;
  cardClassName: string;
  icon: LucideIcon;
};

const SORTS: Array<{ value: ItemSortMode; label: string }> = [
  { value: 'manual_locked', label: 'ترتيب يدوي مخصص' },
  { value: 'name_asc', label: 'الاسم أ-ي' },
  { value: 'name_desc', label: 'الاسم ي-أ' },
  { value: 'code_asc', label: 'الكود تصاعدي' },
  { value: 'category_then_name', label: 'حسب التصنيف ثم الاسم' },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'good', label: 'متوفر' },
  { value: 'warning', label: 'منخفض' },
  { value: 'critical', label: 'حرج' },
];

const EMPTY_FORM: ItemEditorForm = {
  name: '',
  code: '',
  barcode: '',
  englishName: '',
  category: '',
  unit: '',
  minLimit: '0',
  maxLimit: '1000',
  orderLimit: '',
  currentStock: '0',
};

const EMPTY_BULK_FORM: BulkEditorForm = {
  category: '',
  unit: '',
  minLimit: '',
  maxLimit: '',
  orderLimit: '',
};

const EXCEL_TEMPLATE_ROWS = [
  {
    code: 'ITEM-001',
    barcode: '629000000001',
    name: 'ذرة صفراء',
    description: 'Yellow Corn',
    category: 'مواد خام',
    unit: 'كيلو',
    minLimit: 10,
    maxLimit: 1000,
    orderLimit: 50,
    currentStock: 0,
  },
];

const quantityFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const n = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const formatQuantity = (value: number | undefined) => quantityFormatter.format(n(value, 0));

const mapItemDtoToItem = (row: ItemDto): Item => ({
  id: String(row.publicId || row.id),
  publicId: row.publicId ? String(row.publicId) : undefined,
  code: row.code || undefined,
  barcode: row.barcode || undefined,
  name: row.name,
  englishName: row.description || undefined,
  category: row.category || 'غير مصنف',
  unit: row.unit || 'وحدة',
  minLimit: n(row.minLimit, 0),
  maxLimit: n(row.maxLimit, 1000),
  orderLimit: row.orderLimit == null ? undefined : n(row.orderLimit, 0),
  currentStock: n(row.currentStock, 0),
  lastUpdated: row.updatedAt || new Date().toISOString(),
});

const getItemStatusMeta = (item: Item): ItemStatusMeta => {
  const currentStock = n(item.currentStock, 0);
  const minLimit = n(item.minLimit, 0);
  const orderLimit = item.orderLimit == null ? undefined : n(item.orderLimit, 0);

  if (orderLimit != null && currentStock <= orderLimit) {
    return {
      key: 'critical',
      label: 'حرج',
      chipClassName: 'bg-red-50 text-red-700 border-red-200',
      barClassName: 'bg-red-500',
      cardClassName: 'border-red-200 ring-red-500/10',
      icon: AlertCircle,
    };
  }

  if (currentStock < minLimit) {
    return {
      key: 'warning',
      label: 'منخفض',
      chipClassName: 'bg-amber-50 text-amber-700 border-amber-200',
      barClassName: 'bg-amber-500',
      cardClassName: 'border-amber-200 ring-amber-500/10',
      icon: AlertTriangle,
    };
  }

  return {
    key: 'good',
    label: 'متوفر',
    chipClassName: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    barClassName: 'bg-emerald-500',
    cardClassName: 'border-emerald-200 ring-emerald-500/10',
    icon: CheckCircle2,
  };
};

const getProgressPercent = (item: Item) => {
  const maxLimit = n(item.maxLimit, 0);
  if (maxLimit <= 0) return 0;
  return Math.min(100, Math.max(0, (n(item.currentStock, 0) / maxLimit) * 100));
};

const ItemsPage: React.FC = () => {
  const { data: session } = useSession();
  const { hasPermission } = usePermissions();

  const {
    items,
    categories,
    units,
    loading,
    error,
    sortMode,
    manualOrder,
    loadInventoryCore,
    setSortMode,
    lockCurrentItemOrder,
    moveItemManually,
    createItem,
    updateItem,
    bulkUpdate,
    softDelete,
    restore,
    purge,
    exportRowsToExcel,
    exportPdfReport,
  } = useInventoryStore();

  const actorId = String(session?.user?.id || 'system');
  const actorName = String(session?.user?.name || session?.user?.username || 'system');

  const canView = hasPermission('items.view') || hasPermission('items.*') || hasPermission('inventory.view.stock');
  const canEdit = hasPermission('items.sync') || hasPermission('items.*');
  const canArchive = hasPermission('items.archive') || hasPermission('items.*');
  const canRestore = hasPermission('items.restore') || hasPermission('items.*');
  const canDelete = hasPermission('items.delete') || hasPermission('items.*');
  const canGenerateCodes = hasPermission('items.generate_codes') || hasPermission('items.*');
  const canImport = hasPermission('items.import') || hasPermission('items.*');
  const canUpload = hasPermission('items.upload') || hasPermission('items.*');
  const canExportExcel = hasPermission('inventory.export.stock') || hasPermission('reports.export.general') || hasPermission('items.*');
  const canPrint = hasPermission('reports.generate') || hasPermission('reports.*') || hasPermission('items.*');

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ItemEditorForm>(EMPTY_FORM);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkEditorForm>(EMPTY_BULK_FORM);
  const [barcodeMode, setBarcodeMode] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ExcelImportRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadItemId, setUploadItemId] = useState('');
  const [uploadItemName, setUploadItemName] = useState('');
  const [uploadType, setUploadType] = useState<'image' | 'file'>('image');
  const [isUploading, setIsUploading] = useState(false);
  const [archivedItems, setArchivedItems] = useState<Item[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadInventoryCore({ staleMs: 30_000 }).catch(() => undefined);
  }, [loadInventoryCore]);

  useEffect(() => {
    if (!barcodeMode) return;
    const timer = window.setTimeout(() => barcodeInputRef.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, [barcodeMode]);

  const loadArchivedItems = async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const result = await getItemsFromApi({ page: 1, limit: 1000, isArchived: true });
      setArchivedItems(result.data.map(mapItemDtoToItem));
    } catch (loadError: any) {
      setArchivedError(loadError?.message || 'تعذر تحميل الأصناف المؤرشفة.');
    } finally {
      setArchivedLoading(false);
    }
  };

  useEffect(() => {
    setSelected(new Set());
    if (!showArchived) return;
    void loadArchivedItems();
  }, [showArchived]);

  const allKnownItems = useMemo(() => {
    const registry = new Map<string, Item>();
    [...items, ...archivedItems].forEach((item) => {
      registry.set(String(item.id), item);
    });
    return [...registry.values()];
  }, [items, archivedItems]);

  const availableCategories = useMemo(() => {
    const next = new Set<string>(categories.filter(Boolean));
    allKnownItems.forEach((item) => {
      if (item.category) next.add(item.category);
    });
    return [...next].sort((left, right) => left.localeCompare(right, 'ar-EG'));
  }, [allKnownItems, categories]);

  const availableUnits = useMemo(() => {
    const next = new Set<string>(units.filter(Boolean));
    allKnownItems.forEach((item) => {
      if (item.unit) next.add(item.unit);
    });
    return [...next].sort((left, right) => left.localeCompare(right, 'ar-EG'));
  }, [allKnownItems, units]);

  const baseItems = showArchived ? archivedItems : items;

  const sortedItems = useMemo(
    () => sortItems(baseItems, sortMode, manualOrder),
    [baseItems, manualOrder, sortMode],
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return sortedItems.filter((item) => {
      const matchesCategory = category === 'all' || item.category === category;
      const status = getItemStatusMeta(item);
      const matchesStatus = statusFilter === 'all' || status.key === statusFilter;
      const matchesSearch = !query
        || item.name.toLowerCase().includes(query)
        || String(item.code || '').toLowerCase().includes(query)
        || String(item.barcode || '').toLowerCase().includes(query)
        || String(item.englishName || '').toLowerCase().includes(query)
        || String(item.category || '').toLowerCase().includes(query)
        || String(item.unit || '').toLowerCase().includes(query);

      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [category, search, sortedItems, statusFilter]);

  const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(String(item.id)));

  const stats = useMemo(() => {
    const warningItems = items.filter((item) => getItemStatusMeta(item).key !== 'good');
    const totalQuantity = items.reduce((sum, item) => sum + n(item.currentStock, 0), 0);

    return {
      totalItems: items.length,
      warningItems: warningItems.length,
      totalQuantity,
      categoriesCount: new Set(items.map((item) => item.category)).size,
    };
  }, [items]);

  const tableLoading = showArchived ? archivedLoading : loading;
  const tableError = showArchived ? archivedError : error;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: Item) => {
    setForm({
      id: String(item.id),
      name: item.name,
      code: item.code || '',
      barcode: item.barcode || '',
      englishName: item.englishName || '',
      category: item.category,
      unit: item.unit,
      minLimit: String(n(item.minLimit, 0)),
      maxLimit: String(n(item.maxLimit, 1000)),
      orderLimit: item.orderLimit == null ? '' : String(n(item.orderLimit, 0)),
      currentStock: String(n(item.currentStock, 0)),
    });
    setFormOpen(true);
  };

  const selectAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(visibleItems.map((item) => String(item.id))));
  };

  const toggleSelection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const refreshItemsPage = async (options?: { includeArchived?: boolean }) => {
    await loadInventoryCore({ force: true, staleMs: 0 });
    if (options?.includeArchived || showArchived) {
      await loadArchivedItems();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canEdit) {
      toast.error('لا تملك الصلاحية لتنفيذ هذا الإجراء');
      return;
    }

    const normalizedName = form.name.trim();
    const normalizedCategory = form.category.trim();
    const normalizedUnit = form.unit.trim();
    const normalizedCode = form.code.trim();
    const normalizedBarcode = form.barcode.trim();
    const normalizedEnglishName = form.englishName.trim();

    if (!normalizedName || !normalizedCategory || !normalizedUnit) {
      toast.error('يرجى تعبئة اسم الصنف والتصنيف ووحدة القياس.');
      return;
    }

    if (
      normalizedCode
      && allKnownItems.some(
        (item) => String(item.id) !== String(form.id || '') && String(item.code || '').trim().toLowerCase() === normalizedCode.toLowerCase(),
      )
    ) {
      toast.error('كود الصنف مستخدم مسبقًا.');
      return;
    }

    const itemData: Item = {
      id: form.id || crypto.randomUUID(),
      name: normalizedName,
      code: normalizedCode || undefined,
      barcode: normalizedBarcode || undefined,
      englishName: normalizedEnglishName || undefined,
      category: normalizedCategory,
      unit: normalizedUnit,
      minLimit: n(form.minLimit, 0),
      maxLimit: n(form.maxLimit, 1000),
      orderLimit: form.orderLimit.trim() ? n(form.orderLimit, 0) : undefined,
      currentStock: n(form.currentStock, 0),
      lastUpdated: new Date().toISOString(),
    };

    if (form.id) {
      await updateItem(itemData, actorId, actorName);
      logUserActivity({ userId: actorId, userName: actorName, event: 'items_update', details: `تم تحديث الصنف ${itemData.name}` });
    } else {
      await createItem(itemData, actorId, actorName);
      logUserActivity({ userId: actorId, userName: actorName, event: 'items_create', details: `تم إنشاء الصنف ${itemData.name}` });
    }

    setFormOpen(false);
    setForm(EMPTY_FORM);
  };

  const applyBulk = async () => {
    if (!selected.size || !canEdit) return;

    const patch: Partial<Item> = {};
    if (bulk.category.trim()) patch.category = bulk.category.trim();
    if (bulk.unit.trim()) patch.unit = bulk.unit.trim();
    if (bulk.minLimit.trim()) patch.minLimit = n(bulk.minLimit, 0);
    if (bulk.maxLimit.trim()) patch.maxLimit = n(bulk.maxLimit, 1000);
    if (bulk.orderLimit.trim()) patch.orderLimit = n(bulk.orderLimit, 0);

    if (Object.keys(patch).length === 0) {
      toast.error('حدد على الأقل حقلاً واحدًا للتعديل الجماعي.');
      return;
    }

    await bulkUpdate([...selected], patch, actorId, actorName);
    logUserActivity({ userId: actorId, userName: actorName, event: 'items_bulk_update', details: `تم تعديل ${selected.size} صنف` });
    setBulkOpen(false);
    setBulk(EMPTY_BULK_FORM);
    setSelected(new Set());
  };

  const openPendingAction = (mode: PendingActionMode, ids: string[], label: string) => {
    if (!ids.length) return;

    const registry: Record<PendingActionMode, Omit<PendingActionState, 'ids'>> = {
      archive: {
        mode: 'archive',
        title: 'تأكيد أرشفة الأصناف',
        description: `سيتم نقل ${label} إلى المؤرشف مع بقائها متاحة للاستعادة لاحقًا.`,
        confirmLabel: 'أرشفة',
        confirmClassName: 'bg-amber-600 hover:bg-amber-700',
      },
      restore: {
        mode: 'restore',
        title: 'تأكيد استعادة الأصناف',
        description: `سيتم إعادة ${label} إلى قائمة الأصناف النشطة.`,
        confirmLabel: 'استعادة',
        confirmClassName: 'bg-emerald-600 hover:bg-emerald-700',
      },
      purge: {
        mode: 'purge',
        title: 'تأكيد الحذف النهائي',
        description: `سيتم حذف ${label} نهائيًا من النظام ولا يمكن التراجع عن هذا الإجراء.`,
        confirmLabel: 'حذف نهائي',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
      },
    };

    setPendingAction({ ...registry[mode], ids });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    try {
      if (pendingAction.mode === 'archive') {
        await softDelete(pendingAction.ids, actorName);
        await refreshItemsPage();
        logUserActivity({ userId: actorId, userName: actorName, event: 'items_archive', details: `تمت أرشفة ${pendingAction.ids.length} صنف` });
      }

      if (pendingAction.mode === 'restore') {
        await restore(pendingAction.ids);
        await refreshItemsPage({ includeArchived: true });
        logUserActivity({ userId: actorId, userName: actorName, event: 'items_restore', details: `تمت استعادة ${pendingAction.ids.length} صنف` });
      }

      if (pendingAction.mode === 'purge') {
        await purge(pendingAction.ids, actorId, actorName);
        await refreshItemsPage({ includeArchived: true });
        logUserActivity({ userId: actorId, userName: actorName, event: 'items_purge', details: `تم حذف ${pendingAction.ids.length} صنف نهائيًا` });
      }

      setSelected(new Set());
      setPendingAction(null);
    } catch {
      // Toasts are already handled in store actions.
    }
  };

  const handleBarcodeSubmit = () => {
    const scannedCode = barcodeInput.trim();
    if (!scannedCode) return;

    const foundItem = items.find(
      (item) => item.barcode?.trim().toLowerCase() === scannedCode.toLowerCase()
        || item.code?.trim().toLowerCase() === scannedCode.toLowerCase(),
    );

    if (foundItem) {
      openEdit(foundItem);
      toast.success(`تم العثور على الصنف: ${foundItem.name}`);
    } else {
      setForm({ ...EMPTY_FORM, barcode: scannedCode });
      setFormOpen(true);
      toast.info('الصنف غير موجود. تم فتح نموذج إضافة صنف جديد مع تعبئة الباركود.');
    }

    setBarcodeInput('');
  };

  const handleTemplateDownload = async () => {
    await exportRowsToExcel({
      fileName: 'items-import-template.xlsx',
      sheetName: 'Template',
      rows: EXCEL_TEMPLATE_ROWS,
    });
    logUserActivity({ userId: actorId, userName: actorName, event: 'items_import_template', details: 'تم تنزيل قالب استيراد الأصناف' });
  };

  const handleExcelExport = async () => {
    if (!visibleItems.length) {
      toast.error('لا توجد بيانات قابلة للتصدير.');
      return;
    }

    await exportRowsToExcel({
      fileName: `items-${showArchived ? 'archived' : 'active'}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: showArchived ? 'Archived Items' : 'Items',
      rows: visibleItems.map((item) => ({
        'كود الصنف': item.code || '',
        الباركود: item.barcode || '',
        'اسم الصنف': item.name,
        'الاسم الإنجليزي': item.englishName || '',
        الفئة: item.category,
        الوحدة: item.unit,
        'الكمية الحالية': n(item.currentStock, 0),
        'الحد الأدنى': n(item.minLimit, 0),
        'الحد الأعلى': n(item.maxLimit, 1000),
        'حد إعادة الطلب': item.orderLimit == null ? '' : n(item.orderLimit, 0),
        الحالة: getItemStatusMeta(item).label,
      })),
    });

    logUserActivity({ userId: actorId, userName: actorName, event: 'data_export', details: `تصدير Excel من صفحة الأصناف - ${visibleItems.length} سجل` });
  };

  const onPrintItemsPdf = async () => {
    if (!visibleItems.length) {
      toast.error('لا توجد بيانات قابلة للطباعة.');
      return;
    }

    await exportPdfReport({
      endpoint: '/reports/print',
      fileName: `items-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      payload: {
        type: 'items',
        title: showArchived ? 'تقرير الأصناف المؤرشفة' : 'تقرير الأصناف',
        subtitle: `عدد السجلات: ${visibleItems.length}`,
        generatedBy: actorName,
        filename: `items-report-${new Date().toISOString().slice(0, 10)}`,
        data: {
          columns: [
            { key: 'code', label: 'Code', align: 'left' },
            { key: 'barcode', label: 'Barcode', align: 'left' },
            { key: 'name', label: 'Name', align: 'left' },
            { key: 'englishName', label: 'English Name', align: 'left' },
            { key: 'category', label: 'Category', align: 'left' },
            { key: 'unit', label: 'Unit', align: 'left' },
            { key: 'currentStock', label: 'Current Stock', align: 'right' },
            { key: 'minLimit', label: 'Min Limit', align: 'right' },
            { key: 'maxLimit', label: 'Max Limit', align: 'right' },
            { key: 'status', label: 'Status', align: 'left' },
          ],
          rows: visibleItems.map((item) => ({
            code: item.code || '-',
            barcode: item.barcode || '-',
            name: item.name,
            englishName: item.englishName || '-',
            category: item.category,
            unit: item.unit,
            currentStock: formatQuantity(item.currentStock),
            minLimit: formatQuantity(item.minLimit),
            maxLimit: formatQuantity(item.maxLimit),
            status: getItemStatusMeta(item).label,
          })),
          summary: [
            { label: 'Rows', value: String(visibleItems.length) },
            { label: 'Category Filter', value: category === 'all' ? 'All' : category },
            { label: 'Status Filter', value: STATUS_FILTERS.find((entry) => entry.value === statusFilter)?.label || 'كل الحالات' },
          ],
        },
      },
    });

    logUserActivity({ userId: actorId, userName: actorName, event: 'data_export', details: `طباعة PDF من صفحة الأصناف - ${visibleItems.length} سجل` });
  };

  const handleGenerateCodes = async () => {
    if (!canEdit) {
      toast.error('لا تملك الصلاحية لتنفيذ هذا الإجراء');
      return;
    }

    try {
      const result = await generateMissingCodes();
      toast.success(`تم توليد ${result.success} كود من ${result.total}`);
      await refreshItemsPage();
      logUserActivity({ userId: actorId, userName: actorName, event: 'items_generate_codes', details: `تم توليد ${result.success} كود للأصناف` });
    } catch (generateError: any) {
      toast.error(generateError?.message || 'فشل توليد الأكواد');
    }
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsedItems = await parseExcelFile(file);
      setImportPreview(parsedItems);
      setImportOpen(true);
      toast.success(`تم تحميل ${parsedItems.length} صنف للمعاينة`);
    } catch (importError: any) {
      toast.error(importError?.message || 'فشل قراءة ملف Excel');
    } finally {
      event.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview.length) return;

    try {
      setIsImporting(true);
      const result = await bulkImportFromExcel(importPreview);
      toast.success(`تم استيراد ${result.success} صنف بنجاح، فشل ${result.failed}`);

      if (result.errors.length > 0) {
        toast.warning(`أخطاء: ${result.errors.map((entry) => `صف ${entry.row}: ${entry.error}`).join(', ')}`);
      }

      setImportOpen(false);
      setImportPreview([]);
      await refreshItemsPage();
      logUserActivity({ userId: actorId, userName: actorName, event: 'data_import', details: `استيراد ${result.success} صنف من Excel` });
    } catch (importError: any) {
      toast.error(importError?.message || 'فشل استيراد البيانات');
    } finally {
      setIsImporting(false);
    }
  };

  const openUploadModal = (item: Item, type: 'image' | 'file' = 'image') => {
    setUploadItemId(String(item.publicId || item.id));
    setUploadItemName(item.name);
    setUploadType(type);
    setUploadOpen(true);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !uploadItemId) return;

    try {
      setIsUploading(true);
      await uploadItemAttachment(uploadItemId, file, uploadType);
      toast.success('تم رفع المرفق بنجاح');
      setUploadOpen(false);
      logUserActivity({ userId: actorId, userName: actorName, event: 'items_upload', details: `رفع ${uploadType === 'image' ? 'صورة' : 'ملف'} للصنف ${uploadItemName}` });
    } catch (uploadError: any) {
      toast.error(uploadError?.message || 'فشل رفع المرفق');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <ShieldAlert size={18} />
          لا تملك الصلاحية للوصول إلى هذه الصفحة
        </div>
        <div>تحتاج إلى صلاحية items.view.</div>
      </div>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'إجمالي الأصناف',
            value: formatQuantity(stats.totalItems),
            icon: Package,
            iconClassName: 'bg-blue-50 text-blue-600',
          },
          {
            label: 'أصناف منخفضة أو حرجة',
            value: formatQuantity(stats.warningItems),
            icon: AlertTriangle,
            iconClassName: 'bg-amber-50 text-amber-600',
          },
          {
            label: 'إجمالي الكمية الحالية',
            value: formatQuantity(stats.totalQuantity),
            icon: FileSpreadsheet,
            iconClassName: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: 'عدد التصنيفات',
            value: formatQuantity(stats.categoriesCount),
            icon: Layers,
            iconClassName: 'bg-violet-50 text-violet-600',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-extrabold text-slate-900">{card.value}</p>
              </div>
              <div className={`rounded-2xl p-3 ${card.iconClassName}`}>
                <card.icon size={24} />
              </div>
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
              <button
                type="button"
                onClick={() => void refreshItemsPage({ includeArchived: showArchived })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RefreshCcw size={14} />
                تحديث
              </button>
              {canImport && (
                <button
                  type="button"
                  onClick={() => void handleTemplateDownload()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet size={14} />
                  قالب الاستيراد
                </button>
              )}
              {canExportExcel && (
                <button
                  type="button"
                  onClick={() => void handleExcelExport()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet size={14} />
                  تصدير Excel
                </button>
              )}
              {canPrint && (
                <button
                  type="button"
                  onClick={() => void onPrintItemsPdf()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer size={14} />
                  PDF
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <Plus size={14} />
                  إضافة صنف
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="بحث الأصناف"
                className="w-full rounded-xl border border-slate-300 py-2 pr-8 pl-3 text-sm"
                placeholder="بحث بالاسم، الكود، الباركود، الاسم الإنجليزي، التصنيف أو الوحدة..."
              />
            </div>

            <select
              aria-label="تصفية حسب التصنيف"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">كل التصنيفات</option>
              {availableCategories.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>

            <select
              aria-label="تصفية حسب الحالة"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {STATUS_FILTERS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>

            <select
              aria-label="ترتيب الأصناف"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as ItemSortMode)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {SORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>

            {canEdit && (
              <button
                type="button"
                onClick={() => lockCurrentItemOrder()}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${sortMode === 'manual_locked' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
              >
                <Lock size={14} />
                قفل الترتيب اليدوي
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowArchived((value) => !value);
                setPendingAction(null);
              }}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${showArchived ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            >
              {showArchived ? 'عرض الأصناف النشطة' : 'عرض المؤرشفة'}
            </button>

            <button
              type="button"
              onClick={() => {
                setBarcodeMode((value) => !value);
                setBarcodeInput('');
              }}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${barcodeMode ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            >
              <ScanLine size={14} />
              {barcodeMode ? 'إيقاف المسح' : 'مسح باركود'}
            </button>

            {canImport && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <FileUp size={14} />
                استيراد Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            )}

            {canGenerateCodes && (
              <button
                type="button"
                onClick={() => void handleGenerateCodes()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <FileCode size={14} />
                توليد الأكواد
              </button>
            )}

            <div className="mr-auto flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                aria-label="عرض جدولي"
              >
                <LayoutList size={16} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                aria-label="عرض بطاقات"
              >
                <LayoutGrid size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-900">
            <span className="font-bold">{selected.size} صنف محدد</span>
            {!showArchived && canEdit && (
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
              >
                تعديل جماعي
              </button>
            )}
            {!showArchived && canArchive && (
              <button
                type="button"
                onClick={() => openPendingAction('archive', [...selected], `${selected.size} صنف`)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-amber-700"
              >
                أرشفة المحدد
              </button>
            )}
            {showArchived && canRestore && (
              <button
                type="button"
                onClick={() => openPendingAction('restore', [...selected], `${selected.size} صنف`)}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-emerald-700"
              >
                استعادة المحدد
              </button>
            )}
            {showArchived && canDelete && (
              <button
                type="button"
                onClick={() => openPendingAction('purge', [...selected], `${selected.size} صنف`)}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-red-700"
              >
                حذف نهائي
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-3 text-right">
                  <button type="button" onClick={selectAll} aria-label={allSelected ? 'إلغاء تحديد كل الأصناف' : 'تحديد كل الأصناف'}>
                    {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
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
              {tableLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">جاري التحميل...</td>
                </tr>
              )}
              {!tableLoading && tableError && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-red-600">{tableError}</td>
                </tr>
              )}
              {!tableLoading && !tableError && visibleItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {showArchived ? 'لا توجد أصناف مؤرشفة مطابقة للفلترة الحالية.' : 'لا توجد أصناف مطابقة للفلترة الحالية.'}
                  </td>
                </tr>
              )}
              {!tableLoading && !tableError && visibleItems.map((item, index) => {
                const status = getItemStatusMeta(item);
                const progressPercent = getProgressPercent(item);
                const isSelected = selected.has(String(item.id));
                const globalIndex = items.findIndex((entry) => String(entry.id) === String(item.id));
                const canMoveUp = !showArchived && sortMode === 'manual_locked' && globalIndex > 0;
                const canMoveDown = !showArchived && sortMode === 'manual_locked' && globalIndex >= 0 && globalIndex < items.length - 1;

                return (
                  <tr key={String(item.id)} className={`border-t border-slate-200 ${isSelected ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => toggleSelection(String(item.id))} aria-label={isSelected ? `إلغاء تحديد الصنف ${item.name}` : `تحديد الصنف ${item.name}`}>
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">{index + 1}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.code && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{item.code}</span>}
                          {item.barcode && <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700">{item.barcode}</span>}
                          <span className="font-semibold text-slate-900">{item.name}</span>
                        </div>
                        {item.englishName && <div className="text-xs text-slate-400">{item.englishName}</div>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{item.category}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-2 rounded-full ${status.barClassName}`} style={{ width: `${progressPercent}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>{formatQuantity(item.minLimit)}</span>
                          <span>{formatQuantity(item.maxLimit)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      {formatQuantity(item.currentStock)} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${status.chipClassName}`}>
                        <status.icon size={12} />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {!showArchived && (
                          <>
                            <button
                              type="button"
                              disabled={!canMoveUp}
                              onClick={() => moveItemManually(String(item.id), 'up')}
                              className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40"
                              title="تحريك لأعلى"
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              disabled={!canMoveDown}
                              onClick={() => moveItemManually(String(item.id), 'down')}
                              className="rounded-lg border border-slate-300 p-1 text-slate-600 disabled:opacity-40"
                              title="تحريك لأسفل"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </>
                        )}
                        {canEdit && !showArchived && (
                          <button type="button" onClick={() => openEdit(item)} className="rounded-lg border border-slate-300 p-1 text-slate-700" title={`تعديل الصنف ${item.name}`}>
                            <Edit3 size={14} />
                          </button>
                        )}
                        {canUpload && !showArchived && (
                          <button type="button" onClick={() => openUploadModal(item, 'image')} className="rounded-lg border border-slate-300 p-1 text-slate-700" title={`رفع مرفق للصنف ${item.name}`}>
                            <Upload size={14} />
                          </button>
                        )}
                        {canArchive && !showArchived && (
                          <button type="button" onClick={() => openPendingAction('archive', [String(item.id)], item.name)} className="rounded-lg border border-amber-300 p-1 text-amber-700" title={`أرشفة الصنف ${item.name}`}>
                            <Archive size={14} />
                          </button>
                        )}
                        {showArchived && canRestore && (
                          <button type="button" onClick={() => openPendingAction('restore', [String(item.id)], item.name)} className="rounded-lg border border-emerald-300 p-1 text-emerald-700" title={`استعادة الصنف ${item.name}`}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {showArchived && canDelete && (
                          <button type="button" onClick={() => openPendingAction('purge', [String(item.id)], item.name)} className="rounded-lg border border-red-300 p-1 text-red-700" title={`حذف الصنف ${item.name} نهائياً`}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {tableLoading && (
              <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">جاري التحميل...</div>
            )}
            {!tableLoading && tableError && (
              <div className="col-span-full rounded-2xl border border-red-200 bg-white p-8 text-center text-red-600">{tableError}</div>
            )}
            {!tableLoading && !tableError && visibleItems.length === 0 && (
              <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                {showArchived ? 'لا توجد أصناف مؤرشفة مطابقة للفلترة الحالية.' : 'لا توجد أصناف مطابقة للفلترة الحالية.'}
              </div>
            )}
            {!tableLoading && !tableError && visibleItems.map((item) => {
              const status = getItemStatusMeta(item);
              const progressPercent = getProgressPercent(item);
              const isSelected = selected.has(String(item.id));
              const globalIndex = items.findIndex((entry) => String(entry.id) === String(item.id));
              const canMoveUp = !showArchived && sortMode === 'manual_locked' && globalIndex > 0;
              const canMoveDown = !showArchived && sortMode === 'manual_locked' && globalIndex >= 0 && globalIndex < items.length - 1;

              return (
                <motion.article
                  key={String(item.id)}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={`relative rounded-2xl border bg-white p-5 shadow-sm ring-1 ${isSelected ? 'border-emerald-400 ring-emerald-500/20' : `${status.cardClassName} ring-transparent`}`}
                >
                  <button type="button" onClick={() => toggleSelection(String(item.id))} className="absolute left-4 top-4 text-slate-500">
                    {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>

                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.code && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{item.code}</span>}
                          {item.barcode && <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-700">{item.barcode}</span>}
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{item.name}</h3>
                          {item.englishName && <p className="text-sm text-slate-400">{item.englishName}</p>}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${status.chipClassName}`}>
                        <status.icon size={12} />
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <span className="text-sm text-slate-500">التصنيف</span>
                      <span className="font-medium text-slate-800">{item.category}</span>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                        <span>الكمية الحالية</span>
                        <span>{formatQuantity(item.currentStock)} {item.unit}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-2 rounded-full ${status.barClassName}`} style={{ width: `${progressPercent}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                        <span>Min: {formatQuantity(item.minLimit)}</span>
                        <span>Max: {formatQuantity(item.maxLimit)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!showArchived && (
                        <>
                          <button type="button" disabled={!canMoveUp} onClick={() => moveItemManually(String(item.id), 'up')} className="rounded-lg border border-slate-300 p-2 text-slate-600 disabled:opacity-40" title="تحريك لأعلى">
                            <ChevronUp size={14} />
                          </button>
                          <button type="button" disabled={!canMoveDown} onClick={() => moveItemManually(String(item.id), 'down')} className="rounded-lg border border-slate-300 p-2 text-slate-600 disabled:opacity-40" title="تحريك لأسفل">
                            <ChevronDown size={14} />
                          </button>
                        </>
                      )}
                      {canEdit && !showArchived && (
                        <button type="button" onClick={() => openEdit(item)} className="rounded-lg border border-slate-300 p-2 text-slate-700" title={`تعديل الصنف ${item.name}`}>
                          <Edit3 size={14} />
                        </button>
                      )}
                      {canUpload && !showArchived && (
                        <button type="button" onClick={() => openUploadModal(item, 'image')} className="rounded-lg border border-slate-300 p-2 text-slate-700" title={`رفع مرفق للصنف ${item.name}`}>
                          <Upload size={14} />
                        </button>
                      )}
                      {canArchive && !showArchived && (
                        <button type="button" onClick={() => openPendingAction('archive', [String(item.id)], item.name)} className="rounded-lg border border-amber-300 p-2 text-amber-700" title={`أرشفة الصنف ${item.name}`}>
                          <Archive size={14} />
                        </button>
                      )}
                      {showArchived && canRestore && (
                        <button type="button" onClick={() => openPendingAction('restore', [String(item.id)], item.name)} className="rounded-lg border border-emerald-300 p-2 text-emerald-700" title={`استعادة الصنف ${item.name}`}>
                          <RotateCcw size={14} />
                        </button>
                      )}
                      {showArchived && canDelete && (
                        <button type="button" onClick={() => openPendingAction('purge', [String(item.id)], item.name)} className="rounded-lg border border-red-300 p-2 text-red-700" title={`حذف الصنف ${item.name} نهائياً`}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
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
            <input
              ref={barcodeInputRef}
              value={barcodeInput}
              onChange={(event) => setBarcodeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleBarcodeSubmit();
                }
              }}
              placeholder="امسح الباركود أو أدخل الكود ثم اضغط Enter"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="button" onClick={handleBarcodeSubmit} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
              بحث
            </button>
            <button type="button" onClick={() => { setBarcodeMode(false); setBarcodeInput(''); }} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{form.id ? 'تعديل بيانات الصنف' : 'إضافة صنف جديد'}</h2>
                <p className="text-sm text-slate-500">حافظ على توافق الحقول مع العقد الحية للنظام: الكود، الباركود، الوصف، الحدود، والأرصدة.</p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-full border border-slate-300 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="mb-4 text-lg font-semibold text-slate-900">البيانات الأساسية</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <input
                    placeholder="اسم الصنف"
                    required
                    value={form.name}
                    onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="الكود"
                    value={form.code}
                    onChange={(event) => setForm((state) => ({ ...state, code: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="الباركود"
                    value={form.barcode}
                    onChange={(event) => setForm((state) => ({ ...state, barcode: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="الاسم الإنجليزي / الوصف"
                    value={form.englishName}
                    onChange={(event) => setForm((state) => ({ ...state, englishName: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    required
                    list="item-categories"
                    placeholder="التصنيف"
                    value={form.category}
                    onChange={(event) => setForm((state) => ({ ...state, category: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    required
                    list="item-units"
                    placeholder="الوحدة"
                    value={form.unit}
                    onChange={(event) => setForm((state) => ({ ...state, unit: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="mb-4 text-lg font-semibold text-slate-900">ضبط المخزون والحدود</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <input
                    type="number"
                    placeholder="الحد الأدنى"
                    value={form.minLimit}
                    onChange={(event) => setForm((state) => ({ ...state, minLimit: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="الحد الأعلى"
                    value={form.maxLimit}
                    onChange={(event) => setForm((state) => ({ ...state, maxLimit: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="حد إعادة الطلب"
                    value={form.orderLimit}
                    onChange={(event) => setForm((state) => ({ ...state, orderLimit: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="الكمية الحالية"
                    value={form.currentStock}
                    onChange={(event) => setForm((state) => ({ ...state, currentStock: event.target.value }))}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <datalist id="item-categories">
                {availableCategories.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
              <datalist id="item-units">
                {availableUnits.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                إلغاء
              </button>
              <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-bold text-slate-900">تعديل جماعي</h3>
                <p className="text-sm text-slate-500">سيتم تطبيق القيم التالية على {selected.size} صنف محدد.</p>
              </div>
              <button type="button" onClick={() => setBulkOpen(false)} className="rounded-full border border-slate-300 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <input list="bulk-categories" placeholder="تصنيف جديد (اختياري)" value={bulk.category} onChange={(event) => setBulk((state) => ({ ...state, category: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input list="bulk-units" placeholder="وحدة جديدة (اختياري)" value={bulk.unit} onChange={(event) => setBulk((state) => ({ ...state, unit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد أدنى جديد" value={bulk.minLimit} onChange={(event) => setBulk((state) => ({ ...state, minLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد أعلى جديد" value={bulk.maxLimit} onChange={(event) => setBulk((state) => ({ ...state, maxLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="حد إعادة طلب جديد" value={bulk.orderLimit} onChange={(event) => setBulk((state) => ({ ...state, orderLimit: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            </div>
            <datalist id="bulk-categories">
              {availableCategories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <datalist id="bulk-units">
              {availableUnits.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button type="button" onClick={() => setBulkOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                إلغاء
              </button>
              <button type="button" onClick={() => void applyBulk()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                تطبيق
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-bold text-slate-900">معاينة الاستيراد</h3>
                <p className="text-sm text-slate-500">عدد الأصناف في الملف: {importPreview.length}</p>
              </div>
              <button type="button" onClick={() => { setImportOpen(false); setImportPreview([]); }} className="rounded-full border border-slate-300 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-x-auto p-6">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-right">الاسم</th>
                    <th className="px-3 py-2 text-right">الكود</th>
                    <th className="px-3 py-2 text-right">الباركود</th>
                    <th className="px-3 py-2 text-right">الوصف</th>
                    <th className="px-3 py-2 text-right">التصنيف</th>
                    <th className="px-3 py-2 text-right">الوحدة</th>
                    <th className="px-3 py-2 text-right">الكمية</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 25).map((item, index) => (
                    <tr key={`${item.name}-${index}`} className="border-t border-slate-200">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2">{item.code || '-'}</td>
                      <td className="px-3 py-2">{item.barcode || '-'}</td>
                      <td className="px-3 py-2">{item.description || '-'}</td>
                      <td className="px-3 py-2">{item.category || '-'}</td>
                      <td className="px-3 py-2">{item.unit || '-'}</td>
                      <td className="px-3 py-2">{item.currentStock || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 25 && <p className="mt-3 text-sm text-slate-500">... و {importPreview.length - 25} صنف إضافي.</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button type="button" onClick={() => { setImportOpen(false); setImportPreview([]); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                إلغاء
              </button>
              <button type="button" onClick={() => void handleConfirmImport()} disabled={isImporting} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {isImporting ? 'جاري الاستيراد...' : 'تأكيد الاستيراد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-xl font-bold text-slate-900">رفع مرفق</h3>
                <p className="text-sm text-slate-500">{uploadItemName}</p>
              </div>
              <button type="button" onClick={() => setUploadOpen(false)} className="rounded-full border border-slate-300 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex gap-2">
                <button type="button" onClick={() => setUploadType('image')} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${uploadType === 'image' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700'}`}>
                  صورة
                </button>
                <button type="button" onClick={() => setUploadType('file')} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${uploadType === 'file' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-700'}`}>
                  ملف
                </button>
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center hover:bg-slate-50">
                <Upload className="mb-3 text-slate-400" size={28} />
                <span className="text-sm font-medium text-slate-700">اختر الملف المطلوب رفعه</span>
                <span className="mt-1 text-xs text-slate-500">{uploadType === 'image' ? 'PNG / JPG / GIF حتى 5MB' : 'أي ملف حتى 10MB'}</span>
                <input type="file" accept={uploadType === 'image' ? 'image/*' : '*/*'} onChange={handleFileUpload} disabled={isUploading} className="hidden" />
              </label>
              {isUploading && <div className="text-center text-sm text-slate-500">جاري الرفع...</div>}
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h3 className="text-xl font-bold text-slate-900">{pendingAction.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{pendingAction.description}</p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4">
              <button type="button" onClick={() => setPendingAction(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
                إلغاء
              </button>
              <button type="button" onClick={() => void confirmPendingAction()} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${pendingAction.confirmClassName}`}>
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
};

export default ItemsPage;