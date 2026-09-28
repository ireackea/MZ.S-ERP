import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { logUserActivity } from '../../services/iamService';
import type { Item } from '../../types';
import { useInventoryStore, sortItems } from '../../store/useInventoryStore';
import {
  bulkImportFromExcel,
  generateMissingCodes,
  getItems as getItemsFromApi,
  parseExcelFileWithInsights,
  uploadItemAttachment,
  type ExcelImportParseResult,
  type ExcelImportRow,
} from '@services/itemsService';
import ItemsSmartCatalog from './ItemsSmartCatalog';
import ItemsDialogs from './ItemsDialogs';
import ItemImportStudio from './import/ItemImportStudio';
import {
  EMPTY_BULK_FORM,
  EMPTY_FORM,
  EXCEL_TEMPLATE_ROWS,
  STATUS_FILTERS,
  formatQuantity,
  getItemStatusMeta,
  mapItemDtoToItem,
  n,
  type BulkEditorForm,
  type ItemEditorForm,
  type PendingActionMode,
  type PendingActionState,
  type StatusFilter,
} from './shared';

const ItemsPageContent: React.FC = () => {
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
    saveItemOrder,
    moveItemManually,
    savingItemOrder,
  orderProfiles,
  catalogTruncation,
  applyingOrderProfile,
  loadOrderProfiles,
  createOrderProfile,
  applyOrderProfile,
  refreshOrderProfile,
  renameOrderProfile,
  deleteOrderProfile,
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

  const canView = hasPermission('items.view') || hasPermission('items.*') || hasPermission('transactions.view');
  // The save-order button writes a catalog-wide setting, so it is gated on the
  // permission that guards that endpoint. `items.sync` is an apiOnly machine
  // permission; using it here meant a sync right silently became "you may
  // rearrange the whole catalog".
  const canReorder = hasPermission('items.reorder') || hasPermission('items.*');
  const canEdit = hasPermission('items.sync') || hasPermission('items.*');
  const canArchive = hasPermission('items.archive') || hasPermission('items.*');
  const canRestore = hasPermission('items.restore') || hasPermission('items.*');
  const canDelete = hasPermission('items.delete') || hasPermission('items.*');
  const canGenerateCodes = hasPermission('items.generate_codes') || hasPermission('items.*');
  const canImport = hasPermission('items.import') || hasPermission('items.*');
  const canUpload = hasPermission('items.upload') || hasPermission('items.*');
  const canExportExcel = hasPermission('reports.generate') || hasPermission('items.*');
  const canPrint = hasPermission('reports.generate') || hasPermission('reports.*') || hasPermission('items.*');

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
  const [importParseResult, setImportParseResult] = useState<ExcelImportParseResult | null>(null);
  const [importSourceFileName, setImportSourceFileName] = useState('');
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
    // The named orders are loaded with the catalogue rather than on demand, so
    // the panel is populated the first time the page is shown. Loading it lazily
    // on expand would mean the operator opens a panel that is empty while a
    // request is in flight, and reads that as "you have no saved orders".
    void loadOrderProfiles();
    }, [loadInventoryCore, loadOrderProfiles]);

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
  const sortedItems = useMemo(() => sortItems(baseItems, sortMode, manualOrder), [baseItems, manualOrder, sortMode]);

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
      packageWeight: item.packageWeight == null ? '' : String(n(item.packageWeight, 0)),
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      packageWeight: form.packageWeight.trim() ? n(form.packageWeight, 0) : undefined,
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
    if (bulk.packageWeight.trim()) patch.packageWeight = n(bulk.packageWeight, 0);
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
    await exportRowsToExcel({ fileName: 'items-import-template.xlsx', sheetName: 'Template', rows: EXCEL_TEMPLATE_ROWS });
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
      const parsedItems = await parseExcelFileWithInsights(file);
      setImportParseResult(parsedItems);
      setImportSourceFileName(file.name);
      setImportOpen(true);
      toast.success(`تم تحميل ${parsedItems.rows.length} صف من الملف`);
    } catch (importError: any) {
      toast.error(importError?.message || 'فشل قراءة ملف Excel');
    } finally {
      event.target.value = '';
    }
  };

  const handleConfirmImport = async (rowsToImport: ExcelImportRow[]) => {
    if (!rowsToImport.length) return;

    try {
      setIsImporting(true);
      const result = await bulkImportFromExcel(rowsToImport);
      toast.success(`تم تنفيذ الاستيراد: ${result.success} صف ناجح، ${result.failed} مرفوض`);

      if (result.errors.length > 0) {
        toast.warning(`أخطاء: ${result.errors.map((entry) => `صف ${entry.row}: ${entry.error}`).join(', ')}`);
      }

        closeImportModal();
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

  const toggleArchivedView = () => {
    setShowArchived((value) => !value);
    setPendingAction(null);
  };

  const toggleBarcodeMode = () => {
    setBarcodeMode((value) => !value);
    setBarcodeInput('');
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportParseResult(null);
    setImportSourceFileName('');
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} /> لا تملك الصلاحية للوصول إلى هذه الصفحة</div>
        <div>تحتاج إلى صلاحية items.view.</div>
      </div>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <ItemsSmartCatalog
        stats={stats}
        canImport={canImport}
        canExportExcel={canExportExcel}
        canPrint={canPrint}
        canEdit={canEdit}
        canArchive={canArchive}
        canRestore={canRestore}
        canDelete={canDelete}
        canGenerateCodes={canGenerateCodes}
        canUpload={canUpload}
        refreshItemsPage={() => { void refreshItemsPage({ includeArchived: showArchived }); }}
        onTemplateDownload={() => { void handleTemplateDownload(); }}
        onExcelExport={() => { void handleExcelExport(); }}
        onPrintItemsPdf={() => { void onPrintItemsPdf(); }}
        onOpenCreate={openCreate}
        search={search}
        onSearchChange={setSearch}
        category={category}
        onCategoryChange={setCategory}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        availableCategories={availableCategories}
        onLockOrder={() => { void saveItemOrder(); }}
        savingItemOrder={savingItemOrder}
        canReorder={canReorder}
        orderProfiles={orderProfiles}
        catalogTruncation={catalogTruncation}
        applyingOrderProfile={applyingOrderProfile}
        onCreateOrderProfile={(name) => { void createOrderProfile(name); }}
        onApplyOrderProfile={(id) => { void applyOrderProfile(id); }}
        onRefreshOrderProfile={(id) => { void refreshOrderProfile(id); }}
        onRenameOrderProfile={(id, name) => { void renameOrderProfile(id, name); }}
        onDeleteOrderProfile={(id) => { void deleteOrderProfile(id); }}
        showArchived={showArchived}
        onToggleArchived={toggleArchivedView}
        barcodeMode={barcodeMode}
        onToggleBarcodeMode={toggleBarcodeMode}
        onFileImport={(event) => { void handleFileImport(event); }}
        onGenerateCodes={() => { void handleGenerateCodes(); }}
        selectedCount={selected.size}
        onOpenBulk={() => setBulkOpen(true)}
        onOpenPendingAction={openPendingAction}
        onClearSelection={() => setSelected(new Set())}
        tableLoading={tableLoading}
        tableError={tableError}
        visibleItems={visibleItems}
        items={items}
        selected={selected}
        onToggleSelection={toggleSelection}
        allSelected={allSelected}
        onSelectAll={selectAll}
        onMoveItem={(id, direction) => { void moveItemManually(id, direction, visibleItems.map((item) => String(item.id))); }}
        onOpenEdit={openEdit}
        onOpenUpload={openUploadModal}
        barcodeInput={barcodeInput}
        onBarcodeInputChange={setBarcodeInput}
        barcodeInputRef={barcodeInputRef}
        onBarcodeSubmit={handleBarcodeSubmit}
      />

      <ItemImportStudio
        open={importOpen}
        fileName={importSourceFileName}
        rows={importParseResult?.rows || []}
        sourceHeaders={importParseResult?.sourceHeaders || []}
        columnMatches={importParseResult?.columnMatches || []}
        existingItems={items}
        isImporting={isImporting}
        onClose={closeImportModal}
        onConfirm={(rowsToImport) => { void handleConfirmImport(rowsToImport); }}
      />

      <ItemsDialogs
        formOpen={formOpen}
        form={form}
        setForm={setForm}
        onSubmit={submit}
        onCloseForm={() => setFormOpen(false)}
        availableCategories={availableCategories}
        availableUnits={availableUnits}
        bulkOpen={bulkOpen}
        bulk={bulk}
        setBulk={setBulk}
        onApplyBulk={() => { void applyBulk(); }}
        onCloseBulk={() => setBulkOpen(false)}
        selectedCount={selected.size}
        uploadOpen={uploadOpen}
        uploadItemName={uploadItemName}
        uploadType={uploadType}
        setUploadType={setUploadType}
        isUploading={isUploading}
        onCloseUpload={() => setUploadOpen(false)}
        onFileUpload={(event) => { void handleFileUpload(event); }}
        pendingAction={pendingAction}
        onCancelPendingAction={() => setPendingAction(null)}
        onConfirmPendingAction={() => { void confirmPendingAction(); }}
      />
    </motion.section>
  );
};

export default ItemsPageContent;