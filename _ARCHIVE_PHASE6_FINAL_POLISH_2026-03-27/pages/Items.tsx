// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 Final Visual Proof & Cleanup - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Phase 6.6 - Global 100% Cleanup & Absolute Verification - 2026-03-13

import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckSquare, Edit3, FileCode, FileUp, Plus, Printer, RefreshCcw, ScanLine, Search, ShieldAlert, Square, Trash2, Upload, X } from 'lucide-react';
import { toast } from '@services/toastService';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';
import { logUserActivity } from '../services/iamService';
import type { Item, ItemSortMode } from '../types';
import { useInventoryStore, sortItems, type ItemForm, type BulkForm } from '../store/useInventoryStore';
import { generateMissingCodes, bulkImportFromExcel, parseExcelFile, uploadItemAttachment, type ExcelImportRow } from '@services/itemsService';

const SORTS: Array<{ value: ItemSortMode; label: string }> = [
  { value: 'manual_locked', label: 'ترتيب يدوي مخصص' },
  { value: 'name_asc', label: 'الاسم أ-ي' },
  { value: 'name_desc', label: 'الاسم ي-أ' },
  { value: 'code_asc', label: 'الكود تصاعدي' },
  { value: 'category_then_name', label: 'حسب التصنيف ثم الاسم' },
];

const emptyForm: ItemForm = { name: '', code: '', category: '', unit: '', minLimit: '0', maxLimit: '1000', orderLimit: '', currentStock: '0' };
const emptyBulk: BulkForm = { category: '', unit: '', minLimit: '', maxLimit: '', orderLimit: '' };

const ItemsPage: React.FC = () => {
  const { data: session } = useSession();
  const { hasPermission } = usePermissions();

  const {
    items,
    categories,
    units,
    loading,
    error,
    soft,
    sortMode,
    manualOrder,
    loadAll,
    setSortMode,
    move,
    createItem,
    updateItem,
    bulkUpdate,
    softDelete,
    restore,
    purge,
  } = useInventoryStore();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkForm>(emptyBulk);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);
  
  // Phase 5: Barcode Scanner
  const [barcodeMode, setBarcodeMode] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  
  // Phase 5: Bulk Import
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ExcelImportRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  
  // Phase 5: Attachment Upload
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadItemId, setUploadItemId] = useState<string>('');
  const [uploadItemName, setUploadItemName] = useState<string>('');
  const [uploadType, setUploadType] = useState<'image' | 'file'>('image');
  const [isUploading, setIsUploading] = useState(false);

  const actorId = String(session?.user?.id || 'system');
  const actorName = String(session?.user?.name || session?.user?.username || 'system');
  const canView = hasPermission('items.view') || hasPermission('inventory.view.stock');
  const canEdit = hasPermission('items.sync') || hasPermission('items.*');
  const canDelete = hasPermission('items.delete') || hasPermission('items.*');
  const canGenerateCodes = hasPermission('items.generate_codes') || hasPermission('items.*');
  const canImport = hasPermission('items.import') || hasPermission('items.*');
  const canUpload = hasPermission('items.upload') || hasPermission('items.*');

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Phase 5: Barcode Scanner Listener
  useEffect(() => {
    if (!barcodeMode) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const scannedCode = barcodeInput.trim();
        if (!scannedCode) return;

        // Search for item by barcode
        const foundItem = items.find(i => i.barcode === scannedCode || i.code === scannedCode);
        
        if (foundItem) {
          openEdit(foundItem);
          toast.success(`تم العثور على الصنف: ${foundItem.name}`);
        } else {
          // Open form with barcode pre-filled
          setForm({ ...emptyForm, code: scannedCode });
          setFormOpen(true);
          toast.info('صنف غير موجود - جاري إضافة صنف جديد');
        }
        
        setBarcodeInput('');
      } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setBarcodeInput(prev => prev + event.key);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [barcodeMode, barcodeInput, items]);

  // Phase 5: Bulk Import Handlers
  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsedItems = await parseExcelFile(file);
      setImportPreview(parsedItems);
      setImportOpen(true);
      toast.success(`تم تحميل ${parsedItems.length} صنف للمعاينة`);
    } catch (error: any) {
      toast.error(error?.message || 'فشل قراءة ملف Excel');
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview.length) return;

    try {
      setIsImporting(true);
      const result = await bulkImportFromExcel(importPreview);
      toast.success(`تم استيراد ${result.success} صنف بنجاح، فشل ${result.failed}`);
      
      if (result.errors.length > 0) {
        toast.warning(`أخطاء: ${result.errors.map(e => `صف ${e.row}: ${e.error}`).join(', ')}`);
      }
      
      setImportOpen(false);
      setImportPreview([]);
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || 'فشل استيراد البيانات');
    } finally {
      setIsImporting(false);
    }
  };

  // Phase 5: Attachment Upload Handlers
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
      await loadAll();
    } catch (error: any) {
      toast.error(error?.message || 'فشل رفع المرفق');
    } finally {
      setIsUploading(false);
    }
  };

  const visible = useMemo(() => {
    let result = sortMode === 'manual_locked'
      ? items
      : sortItems(items, sortMode, manualOrder);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        i.name.toLowerCase().includes(q) ||
        i.code?.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    }

    if (category !== 'all') {
      result = result.filter((i) => i.category === category);
    }

    const archivedIds = new Set(Object.keys(soft));
    if (showArchived) {
      result = result.filter((i) => archivedIds.has(String(i.id)));
    } else {
      result = result.filter((i) => !archivedIds.has(String(i.id)));
    }

    return result;
  }, [items, sortMode, manualOrder, search, category, showArchived, soft]);

  const allSelected = visible.length > 0 && visible.every((i) => selected.has(String(i.id)));

  const selectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((i) => String(i.id))));
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const openEdit = (item: Item) => {
    setForm({
      id: String(item.id),
      name: item.name,
      code: item.code || '',
      category: item.category,
      unit: item.unit,
      minLimit: String(item.minLimit),
      maxLimit: String(item.maxLimit),
      orderLimit: item.orderLimit != null ? String(item.orderLimit) : '',
      currentStock: String(item.currentStock),
    });
    setFormOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error('لا تملك الصلاحية لتنفيذ هذا الإجراء');
      return;
    }

    const itemData: Item = {
      id: form.id || crypto.randomUUID(),
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      category: form.category.trim(),
      unit: form.unit.trim(),
      minLimit: n(form.minLimit, 0),
      maxLimit: n(form.maxLimit, 1000),
      orderLimit: form.orderLimit ? n(form.orderLimit, 0) : undefined,
      currentStock: n(form.currentStock, 0),
      lastUpdated: new Date().toISOString(),
    };

    if (form.id) {
      await updateItem(itemData, actorId, actorName);
    } else {
      await createItem(itemData, actorId, actorName);
    }

    setFormOpen(false);
    setForm(emptyForm);
  };

  const applyBulk = async () => {
    if (!selected.size || !canEdit) return;

    const patch: Partial<Item> = {};
    if (bulk.category) patch.category = bulk.category;
    if (bulk.unit) patch.unit = bulk.unit;
    if (bulk.minLimit) patch.minLimit = n(bulk.minLimit, 0);
    if (bulk.maxLimit) patch.maxLimit = n(bulk.maxLimit, 1000);
    if (bulk.orderLimit) patch.orderLimit = n(bulk.orderLimit, 0);

    await bulkUpdate(Array.from(selected), patch, actorId, actorName);
    setBulkOpen(false);
    setBulk(emptyBulk);
    setSelected(new Set());
  };

  const n = (v: unknown, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);

  const onPrintItemsPdf = async () => {
    try {
      const payload = {
        type: 'items_list',
        data: {
          items: visible.map((item) => ({
            id: String(item.id),
            code: item.code || '-',
            name: item.name,
            category: item.category,
            unit: item.unit,
            currentStock: n(item.currentStock, 0),
            minLimit: n(item.minLimit, 0),
            maxLimit: n(item.maxLimit, 1000),
            orderLimit: item.orderLimit == null ? '-' : n(item.orderLimit, 0),
          })),
          filters: {
            search,
            category,
            showArchived,
          },
        },
      };

      const response = await fetch('/api/reports/print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Failed to generate items PDF.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `items-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير PDF بنجاح');
    } catch (error: any) {
      toast.error(error?.message || 'فشل تصدير PDF');
    }
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <ShieldAlert size={18} />
          لا تملك الصلاحية للوصول إلى هذه الصفحة
        </div>
        <div>تحتاج إلى صلاحية <code>items.view</code>.</div>
      </div>
    );
  }

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">إدارة الأصناف</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadAll()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <RefreshCcw size={14} />
              تحديث
            </button>
            
            {/* Phase 5: Barcode Scanner Toggle */}
            <button
              onClick={() => {
                setBarcodeMode(!barcodeMode);
                if (!barcodeMode) {
                  setTimeout(() => barcodeInputRef.current?.focus(), 100);
                  toast.info('وضع مسح الباركود مفعل - استخدم قارئ الباركود أو لوحة المفاتيح');
                }
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm ${barcodeMode ? 'bg-emerald-600 text-white' : 'border border-slate-300'}`}
            >
              <ScanLine size={14} />
              {barcodeMode ? 'جاري المسح...' : 'مسح باركود'}
            </button>
            
            {/* Phase 5: Bulk Import */}
            {canImport && (
              <label className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
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
                onClick={async () => {
                  if (!canEdit) {
                    toast.error('لا تملك الصلاحية لتنفيذ هذا الإجراء');
                    return;
                  }
                  try {
                    setIsGeneratingCodes(true);
                    const result = await generateMissingCodes();
                    toast.success(`تم توليد ${result.success} كود من ${result.total}`);
                    await loadAll();
                  } catch (error: any) {
                    toast.error(error?.message || 'فشل توليد الأكواد');
                  } finally {
                    setIsGeneratingCodes(false);
                  }
                }}
                disabled={isGeneratingCodes}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              >
                <FileCode size={14} />
                {isGeneratingCodes ? 'جاري التوليد...' : 'توليد الأكواد'}
              </button>
            )}
            <button onClick={() => void onPrintItemsPdf()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <Printer size={14} />
              PDF
            </button>
            {canEdit && (
              <button onClick={() => { setForm(emptyForm); setFormOpen(true); }} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">
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
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث الأصناف"
              className="w-full rounded-lg border border-slate-300 py-2 pr-8 text-sm"
              placeholder="بحث..."
            />
          </div>
          <select aria-label="تصفية حسب التصنيف" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="all">كل التصنيفات</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select aria-label="ترتيب الأصناف" value={sortMode} onChange={(e) => setSortMode(e.target.value as ItemSortMode)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button onClick={() => setShowArchived((v) => !v)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {showArchived ? 'إخفاء المؤرشفة' : 'عرض المؤرشفة فقط'}
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-sm">
          <span className="ml-2 font-bold">{selected.size} صنف محدد</span>
          {canEdit && (
            <button onClick={() => setBulkOpen(true)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1">
              Bulk Edit
            </button>
          )}
          {!showArchived && (
            <button
              onClick={() => {
                const ids = Array.from(selected);
                softDelete(ids, actorName);
                logUserActivity({ userId: actorId, userName: actorName, event: 'items_soft_delete', details: `Soft delete (${ids.length})` });
                toast.success('تم أرشفة الأصناف بنجاح');
                setSelected(new Set());
              }}
              className="ml-2 rounded border border-amber-300 bg-white px-2 py-1 text-amber-700"
            >
              Soft Delete
            </button>
          )}
          {showArchived && (
            <button
              onClick={() => {
                const ids = Array.from(selected);
                restore(ids);
                logUserActivity({ userId: actorId, userName: actorName, event: 'items_restore', details: `Restore (${ids.length})` });
                toast.success('تم استعادة الأصناف بنجاح');
                setSelected(new Set());
              }}
              className="ml-2 rounded border border-emerald-300 bg-white px-2 py-1 text-emerald-700"
            >
              Restore
            </button>
          )}
          {showArchived && canDelete && (
            <button
              onClick={async () => {
                const ids = Array.from(selected);
                await purge(ids, actorId, actorName);
                setSelected(new Set());
              }}
              className="ml-2 rounded border border-red-300 bg-white px-2 py-1 text-red-700"
            >
              Purge
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-right">
                <button type="button" aria-label={allSelected ? 'إلغاء تحديد كل الأصناف' : 'تحديد كل الأصناف'} title={allSelected ? 'إلغاء تحديد كل الأصناف' : 'تحديد كل الأصناف'} onClick={selectAll}>
                  {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
              </th>
              <th className="px-3 py-2 text-right">الكود</th>
              <th className="px-3 py-2 text-right">الاسم</th>
              <th className="px-3 py-2 text-right">التصنيف</th>
              <th className="px-3 py-2 text-right">الوحدة</th>
              <th className="px-3 py-2 text-right">الكمية</th>
              <th className="px-3 py-2 text-right">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  جاري التحميل...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  لا توجد سجلات لعرضها
                </td>
              </tr>
            )}
            {!loading && !error && visible.map((i) => (
              <tr key={String(i.id)} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <button type="button" aria-label={selected.has(String(i.id)) ? `إلغاء تحديد الصنف ${i.name}` : `تحديد الصنف ${i.name}`} title={selected.has(String(i.id)) ? `إلغاء تحديد الصنف ${i.name}` : `تحديد الصنف ${i.name}`} onClick={() => toggle(String(i.id))}>
                    {selected.has(String(i.id)) ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{i.code || '-'}</td>
                <td className="px-3 py-2 font-semibold">{i.name}</td>
                <td className="px-3 py-2">{i.category}</td>
                <td className="px-3 py-2">{i.unit}</td>
                <td className="px-3 py-2">{n(i.currentStock, 0).toLocaleString()}</td>
                <td className="px-3 py-2">
                  {sortMode === 'manual_locked' && !showArchived && (
                    <>
                      <button onClick={() => move(String(i.id), 'up')} className="ml-1 rounded border border-slate-300 px-1">
                        أعلى
                      </button>
                      <button onClick={() => move(String(i.id), 'down')} className="ml-1 rounded border border-slate-300 px-1">
                        أسفل
                      </button>
                    </>
                  )}
                  {canEdit && !showArchived && (
                    <>
                      <button type="button" aria-label={`تعديل الصنف ${i.name}`} title={`تعديل الصنف ${i.name}`} onClick={() => openEdit(i)} className="ml-1 rounded border border-slate-300 p-1">
                        <Edit3 size={14} />
                      </button>
                      {canUpload && (
                        <button
                          type="button"
                          aria-label={`رفع مرفق للصنف ${i.name}`}
                          title={`رفع مرفق للصنف ${i.name}`}
                          onClick={() => openUploadModal(i, 'image')}
                          className="ml-1 rounded border border-slate-300 p-1"
                        >
                          <Upload size={14} />
                        </button>
                      )}
                    </>
                  )}
                  {showArchived && canDelete && (
                    <button
                      type="button"
                      aria-label={`حذف الصنف ${i.name} نهائياً`}
                      title={`حذف الصنف ${i.name} نهائياً`}
                      onClick={async () => {
                        await purge([String(i.id)], actorId, actorName);
                        toast.success('تم حذف السجل نهائياً');
                      }}
                      className="ml-1 rounded border border-red-300 p-1 text-red-700"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submit} className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="mb-3 text-lg font-bold">{form.id ? 'تعديل الصنف' : 'إضافة صنف جديد'}</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input required placeholder="الاسم" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input placeholder="الكود" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input required list="item-categories" placeholder="التصنيف" value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input required list="item-units" placeholder="الوحدة" value={form.unit} onChange={(e) => setForm((s) => ({ ...s, unit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Min" value={form.minLimit} onChange={(e) => setForm((s) => ({ ...s, minLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Max" value={form.maxLimit} onChange={(e) => setForm((s) => ({ ...s, maxLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Order Limit" value={form.orderLimit} onChange={(e) => setForm((s) => ({ ...s, orderLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Current Stock" value={form.currentStock} onChange={(e) => setForm((s) => ({ ...s, currentStock: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <datalist id="item-categories">
              {categories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <datalist id="item-units">
              {units.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                إلغاء
              </button>
              <button type="submit" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold">تعديل جماعي ({selected.size})</h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input list="bulk-categories" placeholder="التصنيف الجديد (اختياري)" value={bulk.category} onChange={(e) => setBulk((s) => ({ ...s, category: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input list="bulk-units" placeholder="الوحدة الجديدة (اختياري)" value={bulk.unit} onChange={(e) => setBulk((s) => ({ ...s, unit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Min" value={bulk.minLimit} onChange={(e) => setBulk((s) => ({ ...s, minLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Max" value={bulk.maxLimit} onChange={(e) => setBulk((s) => ({ ...s, maxLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="Order Limit" value={bulk.orderLimit} onChange={(e) => setBulk((s) => ({ ...s, orderLimit: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            </div>
            <datalist id="bulk-categories">
              {categories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <datalist id="bulk-units">
              {units.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setBulkOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                إلغاء
              </button>
              <button onClick={() => void applyBulk()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
                تحديث
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              عرض {((pagination.page - 1) * pagination.limit) + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} من {pagination.total} سجل
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (pagination.page > 1) {
                    setPagination(p => ({ ...p, page: p.page - 1 }));
                    void loadAll();
                  }
                }}
                disabled={pagination.page === 1}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              >
                السابق
              </button>
              <span className="text-sm text-slate-600">
                صفحة {pagination.page} من {pagination.totalPages}
              </span>
              <button
                onClick={() => {
                  if (pagination.page < pagination.totalPages) {
                    setPagination(p => ({ ...p, page: p.page + 1 }));
                    void loadAll();
                  }
                }}
                disabled={pagination.page === pagination.totalPages}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 5: Barcode Scanner Input (Hidden but focused) */}
      {barcodeMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-emerald-300 bg-emerald-50 p-3 shadow-lg">
          <div className="flex items-center gap-2">
            <ScanLine className="text-emerald-600" size={20} />
            <input
              ref={barcodeInputRef}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="امسح الباركود أو أدخل الكود..."
              className="flex-1 rounded-lg border border-emerald-300 px-3 py-1 text-sm focus:outline-none"
              autoFocus
            />
            <button
              onClick={() => {
                setBarcodeMode(false);
                setBarcodeInput('');
              }}
              className="rounded-lg border border-emerald-300 px-2 py-1 text-sm"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Phase 5: Bulk Import Preview Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl max-h-[80vh] overflow-y-auto">
            <h3 className="mb-3 text-lg font-bold">معاينة الاستيراد ({importPreview.length} صنف)</h3>
            <div className="mb-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-right">الاسم</th>
                    <th className="px-3 py-2 text-right">الكود</th>
                    <th className="px-3 py-2 text-right">التصنيف</th>
                    <th className="px-3 py-2 text-right">الوحدة</th>
                    <th className="px-3 py-2 text-right">الكمية</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 10).map((item, idx) => (
                    <tr key={idx} className="border-t border-slate-200">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2">{item.code || '-'}</td>
                      <td className="px-3 py-2">{item.category || '-'}</td>
                      <td className="px-3 py-2">{item.unit || '-'}</td>
                      <td className="px-3 py-2">{item.currentStock || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 10 && (
                <p className="mt-2 text-sm text-slate-500">... و{importPreview.length - 10} أصناف أخرى</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setImportOpen(false); setImportPreview([]); }} className="rounded border border-slate-300 px-3 py-2 text-sm">
                إلغاء
              </button>
              <button onClick={handleConfirmImport} disabled={isImporting} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                {isImporting ? 'جاري الاستيراد...' : 'تأكيد الاستيراد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 5: Upload Attachment Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-lg font-bold">رفع مرفق: {uploadItemName}</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold">نوع المرفق</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setUploadType('image')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${uploadType === 'image' ? 'bg-emerald-600 text-white' : 'border-slate-300'}`}
                >
                  صورة
                </button>
                <button
                  onClick={() => setUploadType('file')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${uploadType === 'file' ? 'bg-emerald-600 text-white' : 'border-slate-300'}`}
                >
                  ملف
                </button>
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-semibold">اختر الملف</label>
              <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-6 hover:bg-slate-50">
                <div className="text-center">
                  <Upload className="mx-auto mb-2 text-slate-400" size={32} />
                  <p className="text-sm text-slate-600">انقر لاختيار ملف</p>
                  <p className="text-xs text-slate-500">
                    {uploadType === 'image' ? 'PNG, JPG, GIF (حد أقصى 5MB)' : 'أي ملف (حد أقصى 10MB)'}
                  </p>
                </div>
                <input
                  type="file"
                  accept={uploadType === 'image' ? 'image/*' : '*/*'}
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
            </div>
            {isUploading && (
              <div className="mb-4 text-center text-sm text-slate-600">جاري الرفع...</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setUploadOpen(false)} className="rounded border border-slate-300 px-3 py-2 text-sm">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
};

export default ItemsPage;

