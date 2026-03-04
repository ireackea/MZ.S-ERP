// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadCloud, RefreshCw, UploadCloud } from 'lucide-react';
import * as XLSX from 'xlsx';

import { useToast } from '@hooks/useToast';
import {
  bulkUpsertOpeningBalances,
  getOpeningBalances,
  setOpeningBalance,
  OpeningBalancePayload,
} from '@services/openingBalanceService';
import { getItems, ItemDto, syncItems } from '@services/itemsService';
import { ReportColumnConfig } from '../types';
import { useInventoryStore } from '../store/useInventoryStore';
import { useInventory } from '../contexts/InventoryContext';

interface OpeningBalanceRow {
  id: number;
  itemId: number;
  itemPublicId?: string;
  financialYear: number;
  quantity: number;
  unitCost?: number | null;
  item?: { name: string; publicId?: string };
}

interface LocalItemLike {
  id?: string | number;
  name?: string;
  unit?: string;
  category?: string;
  description?: string;
}

const currentYear = new Date().getFullYear();
const COLUMN_STORAGE_KEY = 'feed_factory_opening_balance_columns';
const DEFAULT_COLUMNS: ReportColumnConfig[] = [
  { key: 'item', label: 'الصنف', isVisible: true },
  { key: 'quantity', label: 'الكمية', isVisible: true },
  { key: 'unitCost', label: 'تكلفة الوحدة', isVisible: true },
  { key: 'unit', label: 'وحدة القياس', isVisible: true },
  { key: 'category', label: 'الفئة', isVisible: true },
  { key: 'code', label: 'كود الصنف', isVisible: true },
];

const mergeColumns = (
  base: ReportColumnConfig[],
  incoming?: ReportColumnConfig[]
): ReportColumnConfig[] => {
  if (!incoming || incoming.length === 0) return base;
  const allowed = new Set(base.map((c) => c.key));
  const normalized = incoming.filter((c) => allowed.has(c.key));
  const missing = base.filter((c) => !normalized.find((n) => n.key === c.key));
  return [...normalized, ...missing];
};

interface OpeningBalancePageProps {
  columnConfig: ReportColumnConfig[];
  onUpdateColumnConfig: (config: ReportColumnConfig[]) => void;
}

const OpeningBalancePage: React.FC<OpeningBalancePageProps> = ({
  columnConfig,
  onUpdateColumnConfig,
}) => {
  const { showToast, ToastComponent } = useToast();
  const { items: inventoryItems } = useInventoryStore();

  const [year, setYear] = useState<number>(currentYear);
  const [rows, setRows] = useState<OpeningBalanceRow[]>([]);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [localColumnConfig, setLocalColumnConfig] = useState<ReportColumnConfig[]>(
    mergeColumns(DEFAULT_COLUMNS, columnConfig)
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleColumns = useMemo(
    () => localColumnConfig.filter((col) => col.isVisible),
    [localColumnConfig]
  );

  const normalize = (v: unknown) => String(v ?? '').trim().toLowerCase();

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    []
  );

  const formatNumber = (value: number | null | undefined): string => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    return numberFormatter.format(numeric);
  };

  const parseFormattedNumber = (raw: string): number => {
    const cleaned = String(raw ?? '')
      .replace(/,/g, '')
      .trim();
    if (!cleaned) return Number.NaN;
    return Number(cleaned);
  };

  const handleNumericFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const parsed = parseFormattedNumber(e.currentTarget.value);
    if (!Number.isFinite(parsed)) return;
    e.currentTarget.value = String(parsed);
  };

  const handleNumericBlur = (
    e: React.FocusEvent<HTMLInputElement>,
    row: OpeningBalanceRow,
    field: 'quantity' | 'unitCost'
  ) => {
    const parsed = parseFormattedNumber(e.currentTarget.value);
    const previousValue = field === 'quantity' ? row.quantity : row.unitCost;

    if (!Number.isFinite(parsed)) {
      e.currentTarget.value = formatNumber(previousValue ?? null);
      return;
    }

    const rounded = Number(parsed.toFixed(3));
    e.currentTarget.value = formatNumber(rounded);
    void handleEdit(row, field, rounded);
  };

  const sortedRows = useMemo(() => {
    const list = [...rows];
    const orderIndex = new Map<string, number>();
    const nameIndex = new Map<string, number>();
    const source = inventoryItems.length ? inventoryItems : items;
    source.forEach((item: any, idx: number) => {
      const key = item.publicId ?? item.id;
      if (key !== undefined) orderIndex.set(String(key), idx);
      const itemName = normalize(item.name);
      if (itemName) nameIndex.set(itemName, idx);
    });

    return list.sort((a, b) => {
      const aKey = a.itemPublicId ?? a.itemId;
      const bKey = b.itemPublicId ?? b.itemId;
      const aIdx =
        orderIndex.get(String(aKey)) ??
        nameIndex.get(normalize(a.item?.name)) ??
        Number.MAX_SAFE_INTEGER;
      const bIdx =
        orderIndex.get(String(bKey)) ??
        nameIndex.get(normalize(b.item?.name)) ??
        Number.MAX_SAFE_INTEGER;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.item?.name || '').localeCompare(b.item?.name || '', 'ar');
    });
  }, [rows, items, inventoryItems]);

  useEffect(() => {
    setLocalColumnConfig(mergeColumns(DEFAULT_COLUMNS, columnConfig));
  }, [columnConfig]);

  const normalizeInventoryItem = (item: any): ItemDto | null => {
    if (!item?.name) return null;
    const idValue = Number(item.id);
    return {
      id: Number.isFinite(idValue) ? idValue : 0,
      publicId: item.publicId ?? (item.id ? String(item.id) : undefined),
      code: item.code ? String(item.code) : undefined,
      name: String(item.name),
      unit: item.unit ? String(item.unit) : undefined,
      category: item.category ? String(item.category) : undefined,
      description: item.description ? String(item.description) : undefined,
    };
  };

  const itemMetaByPublicId = useMemo(() => {
    const map = new Map<string, ItemDto>();
    inventoryItems.forEach((item) => {
      const normalizedItem = normalizeInventoryItem(item);
      const key = normalizedItem?.publicId;
      if (normalizedItem && key) map.set(String(key), normalizedItem);
    });
    items.forEach((item) => {
      if (item.publicId) map.set(String(item.publicId), item);
    });
    return map;
  }, [items, inventoryItems]);

  const itemMetaById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    items.forEach((item) => {
      if (typeof item.id !== 'undefined') map.set(String(item.id), item);
    });
    return map;
  }, [items]);

  const itemMetaByName = useMemo(() => {
    const map = new Map<string, ItemDto>();
    inventoryItems.forEach((item) => {
      const normalizedItem = normalizeInventoryItem(item);
      if (!normalizedItem) return;
      map.set(normalize(normalizedItem.name), normalizedItem);
    });
    items.forEach((item) => {
      if (item.name) map.set(normalize(item.name), item);
    });
    return map;
  }, [items, inventoryItems]);

  const getItemMeta = (row: OpeningBalanceRow) => {
    let meta: ItemDto | undefined;
    if (row.itemPublicId && itemMetaByPublicId.has(String(row.itemPublicId))) {
      meta = itemMetaByPublicId.get(String(row.itemPublicId));
    } else if (row.itemId && itemMetaById.has(String(row.itemId))) {
      meta = itemMetaById.get(String(row.itemId));
    }

    const nameKey = normalize(row.item?.name || meta?.name);
    const byName = nameKey ? itemMetaByName.get(nameKey) : undefined;

    if (meta) {
      if (!meta.code && byName?.code) meta = { ...meta, code: byName.code };
      if (!meta.unit && byName?.unit) meta = { ...meta, unit: byName.unit };
      if (!meta.category && byName?.category) meta = { ...meta, category: byName.category };
      return meta;
    }

    return byName;
  };

  const getLocalItemsForSync = () => {
    try {
      const raw = localStorage.getItem('feed_factory_items');
      const parsed = raw ? (JSON.parse(raw) as LocalItemLike[]) : [];
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((item) => ({
          publicId: String(item?.id ?? '').trim(),
          name: String(item?.name ?? '').trim(),
          unit: item?.unit ? String(item.unit) : undefined,
          category: item?.category ? String(item.category) : undefined,
          description: item?.description ? String(item.description) : undefined,
        }))
        .filter((item) => item.publicId && item.name);
    } catch {
      return [];
    }
  };

  const getFetchItemsErrorMessage = (err: any): string => {
    const status = err?.response?.status;
    const serverMessage = err?.response?.data?.message;
    if (status === 401) return 'غير مصرح (401): طابق ADMIN_TOKEN مع VITE_BACKUP_API_TOKEN.';
    if (status === 404) return 'المسار /items غير موجود. تحقق من تشغيل Backend الصحيح.';
    if (err?.code === 'ERR_NETWORK') return 'تعذر الاتصال بالخادم. تحقق من VITE_API_URL ومنفذ الـ Backend.';
    return serverMessage || err?.message || 'فشل جلب الأصناف من الخادم.';
  };

  const loadBalances = async (targetYear: number) => {
    setLoadingBalances(true);
    setErrorDetails(null);
    try {
      const data = await getOpeningBalances(targetYear);
      setRows(data || []);
    } catch (e: any) {
      const message = e?.message || 'تعذر تحميل أرصدة بداية المدة';
      setErrorDetails(message);
      showToast(message, 'error');
    } finally {
      setLoadingBalances(false);
    }
  };

  const fetchItems = async (manual = false) => {
    setSyncingItems(manual);
    try {
      let data = await getItems();

      if (!data.length) {
        const localItems = getLocalItemsForSync();
        if (localItems.length) {
          if (manual) {
            await syncItems(localItems);
            data = await getItems();
            showToast(`تمت مزامنة ${localItems.length} صنف من قسم الأصناف.`, 'success');
          } else {
            setItems(localItems as unknown as ItemDto[]);
            localStorage.setItem('cached_items', JSON.stringify(localItems));
            showToast('لا توجد أصناف في الخادم حالياً. تم عرض الأصناف المحلية.', 'error');
            return;
          }
        }
      }

      setItems(data);
      localStorage.setItem('cached_items', JSON.stringify(data));
      if (manual) showToast('تم تحديث قائمة الأصناف بنجاح.', 'success');
    } catch (err: any) {
      const cached = JSON.parse(localStorage.getItem('cached_items') || '[]');
      if (Array.isArray(cached) && cached.length) {
        setItems(cached);
        showToast(
          manual
            ? 'تعذر التحديث من الخادم، تم استخدام النسخة المحلية.'
            : 'تم استخدام النسخة المحلية للأصناف.',
          'error'
        );
      } else {
        const localItems = getLocalItemsForSync();
        if (localItems.length) {
          setItems(localItems as unknown as ItemDto[]);
          localStorage.setItem('cached_items', JSON.stringify(localItems));
          showToast('تعذر الوصول للخادم، تم تحميل أصناف قسم الأصناف المحلي.', 'error');
        } else {
          showToast(getFetchItemsErrorMessage(err), 'error');
        }
      }
    } finally {
      setSyncingItems(false);
    }
  };

  useEffect(() => {
    void loadBalances(year);
  }, [year]);

  useEffect(() => {
    void fetchItems();
  }, []);

  const handleEdit = async (row: OpeningBalanceRow, field: 'quantity' | 'unitCost', value: number) => {
    if (!Number.isFinite(value)) return;
    const previous = rows;
    const next = rows.map((r) => (r.id === row.id ? { ...r, [field]: value } : r));
    setRows(next);
    try {
      await setOpeningBalance({
        itemPublicId: row.itemPublicId || row.item?.publicId || String(row.itemId),
        financialYear: year,
        quantity: field === 'quantity' ? value : row.quantity,
        unitCost: field === 'unitCost' ? value : row.unitCost ?? undefined,
      });
    } catch (e: any) {
      setRows(previous);
      showToast(e?.message || 'تعذر حفظ الرصيد', 'error');
    }
  };

  const handleExportTemplate = () => {
    const exportSource = inventoryItems.length ? inventoryItems : items;
    const template = (exportSource || []).map((item: any) => ({
      'اسم الصنف': item.name ?? '',
      'المعرف العام (publicId / الكود)': item.code ?? '',
      'الوحدة': item.unit ?? '',
      'الفئة': item.category ?? '',
      'الكمية': '',
      'التكلفة': '',
    }));

    const headerOrder = ['اسم الصنف', 'المعرف العام (publicId / الكود)', 'الوحدة', 'الفئة', 'الكمية', 'التكلفة'];
    const ws = XLSX.utils.json_to_sheet(template, { header: headerOrder });

    ws['!cols'] = [
      { wch: 30 },
      { wch: 28 },
      { wch: 12 },
      { wch: 18 },
      { wch: 10 },
      { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Opening Balance Template');
    XLSX.writeFile(wb, 'Opening_Balance_Template.xlsx');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!items.length) {
      showToast('لا توجد أصناف محمّلة. اضغط "مزامنة الأصناف" أولاً.', 'error');
      return;
    }

    setImporting(true);
    setErrorDetails(null);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);

      if (!json.length) {
        showToast('الملف فارغ، لا توجد بيانات للاستيراد.', 'error');
        return;
      }

      const payload: OpeningBalancePayload[] = [];
      const errors: string[] = [];
      const importSource = inventoryItems.length ? inventoryItems : items;

      json.forEach((row, idx) => {
        const identifier = normalize(
          row['المعرف العام (publicId / الكود)'] ||
            row['الكود'] ||
            row['Code'] ||
            row['id'] ||
            row['ID'] ||
            row['Name'] ||
            row['الاسم']
        );
        const name = normalize(row['اسم الصنف'] || row['الاسم']);
        const qtyRaw = row['الكمية'] ?? row['Quantity'];
        const qty = Number(qtyRaw);
        const costRaw = row['التكلفة'] ?? row['Cost'];
        const unitCost = Number.isFinite(Number(costRaw)) ? Number(costRaw) : undefined;

        if ((!identifier && !name) || !Number.isFinite(qty) || qty < 0) {
          errors.push(`السطر ${idx + 2}: بيانات غير صالحة (معرف/اسم أو كمية).`);
          return;
        }

        const match = importSource.find((i: any) => {
          const pid = normalize(i.publicId ?? i.id);
          const code = normalize(i.code);
          const id = normalize(i.id);
          const nm = normalize(i.name);
          return pid === identifier || code === identifier || id === identifier || nm === name;
        });

        const matchPublicId = match?.publicId ?? match?.id;

        if (!match || !matchPublicId) {
          errors.push(`السطر ${idx + 2}: لم يتم العثور على صنف مطابق لـ "${identifier || name}".`);
          return;
        }

        payload.push({
          itemPublicId: String(matchPublicId),
          financialYear: year,
          quantity: qty,
          unitCost,
        });
      });

      if (!payload.length) {
        showToast('لم يتم تجهيز أي صف للاستيراد.', 'error');
        if (errors.length) setErrorDetails(errors.join('\n'));
        return;
      }

      const result = await bulkUpsertOpeningBalances(payload);
      const backendErrors = Array.isArray(result?.errors) ? result.errors : [];
      const failedCount = Number(result?.failed || 0);
      const syncedCount = Number(result?.synced || payload.length);

      if (failedCount > 0) {
        showToast(`تمت المعالجة: ${syncedCount} نجح، ${failedCount} فشل.`, 'error');
      } else {
        showToast(`تم استيراد ${syncedCount} صف بنجاح.`, 'success');
      }

      const allErrors = [...errors, ...backendErrors];
      setErrorDetails(allErrors.length ? allErrors.join('\n') : null);
      void loadBalances(year);
    } catch (err: any) {
      showToast('فشل استيراد الملف.', 'error');
      const responseMessage = err?.response?.data?.message;
      const responseError = err?.response?.data?.error;
      const responseDetails = Array.isArray(responseMessage)
        ? responseMessage.join('\n')
        : responseMessage;

      setErrorDetails(
        responseDetails ||
          responseError ||
          err?.message ||
          'حدث خطأ أثناء قراءة الملف.'
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleColumnVisibility = (key: string) => {
    setLocalColumnConfig((prev) => prev.map((col) => (col.key === key ? { ...col, isVisible: !col.isVisible } : col)));
  };

  const moveColumn = (key: string, direction: 'up' | 'down') => {
    setLocalColumnConfig((prev) => {
      const next = [...prev];
      const idx = next.findIndex((col) => col.key === key);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const saveColumns = () => {
    const merged = mergeColumns(DEFAULT_COLUMNS, localColumnConfig);
    onUpdateColumnConfig(merged);
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(merged));
    showToast('تم حفظ إعدادات الأعمدة', 'success');
  };

  const resetColumns = () => {
    setLocalColumnConfig(DEFAULT_COLUMNS);
    onUpdateColumnConfig(DEFAULT_COLUMNS);
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(DEFAULT_COLUMNS));
    showToast('تمت إعادة الأعمدة للوضع الافتراضي', 'success');
  };

  return (
    <>
      <div className="p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">أرصدة بداية المدة</h1>
            <p className="text-sm text-slate-500">تحكم في أرصدة الأصناف عند بداية السنة المالية.</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">السنة المالية</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border rounded px-3 py-2"
            >
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => fetchItems(true)}
              disabled={syncingItems}
              className="bg-indigo-600 text-white px-4 py-2 rounded disabled:opacity-60"
            >
              {syncingItems ? 'جاري المزامنة...' : 'مزامنة الأصناف'}
            </button>

            <button
              onClick={handleExportTemplate}
              className="bg-emerald-600 text-white px-4 py-2 rounded flex items-center gap-2"
            >
              <DownloadCloud size={16} /> تصدير قالب
            </button>

            <label className="bg-slate-100 text-slate-700 px-4 py-2 rounded border border-slate-300 cursor-pointer hover:bg-slate-200 flex items-center gap-2">
              <UploadCloud size={16} />
              استيراد Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                ref={fileInputRef}
                onChange={handleImport}
                disabled={importing}
              />
            </label>

            <button
              onClick={() => void loadBalances(year)}
              className="bg-slate-100 text-slate-700 px-3 py-2 rounded border border-slate-300 hover:bg-slate-200 flex items-center gap-1"
            >
              <RefreshCw size={14} /> تحديث
            </button>

            <button
              onClick={() => setShowColumnSettings((s) => !s)}
              className="bg-slate-100 text-slate-700 px-3 py-2 rounded border border-slate-300 hover:bg-slate-200"
            >
              إعدادات الأعمدة
            </button>
          </div>
        </div>

        {showColumnSettings && (
          <div className="border rounded-xl p-3 bg-slate-50 space-y-2">
            <div className="text-sm font-bold text-slate-700">إعدادات الأعمدة (داخل القسم)</div>
            {localColumnConfig.map((col, idx) => (
              <div key={col.key} className="flex items-center justify-between border rounded p-2 bg-white">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={col.isVisible}
                    onChange={() => toggleColumnVisibility(col.key)}
                  />
                  {col.label}
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={idx === 0}
                    className="px-2 py-1 border rounded disabled:opacity-40"
                    onClick={() => moveColumn(col.key, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    disabled={idx === localColumnConfig.length - 1}
                    className="px-2 py-1 border rounded disabled:opacity-40"
                    onClick={() => moveColumn(col.key, 'down')}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button className="bg-slate-800 text-white px-3 py-2 rounded" onClick={saveColumns}>
                حفظ
              </button>
              <button className="bg-white border px-3 py-2 rounded" onClick={resetColumns}>
                إعادة الضبط
              </button>
            </div>
          </div>
        )}

        {errorDetails && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded whitespace-pre-wrap text-sm">
            {errorDetails}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="border-b px-4 py-2 text-sm text-slate-600 flex justify-between">
            <span>الجدول</span>
            {loadingBalances && <span className="text-amber-600">جاري التحميل...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {visibleColumns.map((col) => (
                    <th key={col.key} className="py-2 px-3 text-right">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    {visibleColumns.map((col) => {
                      const meta = getItemMeta(row);
                      if (col.key === 'item') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            {row.item?.name || meta?.name || `#${row.itemId}`}
                          </td>
                        );
                      }

                      if (col.key === 'quantity') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-full border rounded px-2 py-1 text-right"
                              defaultValue={formatNumber(row.quantity)}
                              onFocus={handleNumericFocus}
                              onBlur={(e) => handleNumericBlur(e, row, 'quantity')}
                            />
                          </td>
                        );
                      }

                      if (col.key === 'unitCost') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-full border rounded px-2 py-1 text-right"
                              defaultValue={row.unitCost == null ? '' : formatNumber(row.unitCost)}
                              onFocus={handleNumericFocus}
                              onBlur={(e) => handleNumericBlur(e, row, 'unitCost')}
                            />
                          </td>
                        );
                      }

                      if (col.key === 'unit') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            {meta?.unit || '-'}
                          </td>
                        );
                      }

                      if (col.key === 'category') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            {meta?.category || '-'}
                          </td>
                        );
                      }

                      if (col.key === 'code') {
                        return (
                          <td key={col.key} className="px-3 py-2">
                            {meta?.code ?? ''}
                          </td>
                        );
                      }

                      return null;
                    })}
                  </tr>
                ))}

                {!loadingBalances && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(1, visibleColumns.length)} className="px-3 py-6 text-center text-slate-400">
                      لا توجد أرصدة مسجلة لهذه السنة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <ToastComponent />
    </>
  );
};

export default OpeningBalancePage;
