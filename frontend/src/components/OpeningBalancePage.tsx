// ENTERPRISE FIX: Phase 3 - Full Legacy Removal & Complete Single Source of Truth - 2026-03-05
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DownloadCloud, RefreshCw, UploadCloud } from 'lucide-react';
import * as XLSX from 'xlsx';

import { useToast } from '@hooks/useToast';
import {
  bulkUpsertOpeningBalances,
  setOpeningBalance,
  type OpeningBalancePayload,
} from '@services/openingBalanceService';
import type { ReportColumnConfig } from '../types';
import { useInventoryStore, type OpeningBalanceStoreRow } from '../store/useInventoryStore';

const currentYear = new Date().getFullYear();
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
  const allowed = new Set(base.map((column) => column.key));
  const normalized = incoming.filter((column) => allowed.has(column.key));
  const missing = base.filter((column) => !normalized.find((entry) => entry.key === column.key));
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
  const inventoryItems = useInventoryStore((state) => state.items);
  const openingBalanceRows = useInventoryStore((state) => state.openingBalanceRows);
  const openingBalancesLoading = useInventoryStore((state) => state.openingBalancesLoading);
  const openingBalancesError = useInventoryStore((state) => state.openingBalancesError);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const loadOpeningBalances = useInventoryStore((state) => state.loadOpeningBalances);
  const setOpeningBalanceRows = useInventoryStore((state) => state.setOpeningBalanceRows);

  const [year, setYear] = useState<number>(currentYear);
  const [syncingItems, setSyncingItems] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [localColumnConfig, setLocalColumnConfig] = useState<ReportColumnConfig[]>(
    mergeColumns(DEFAULT_COLUMNS, columnConfig)
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleColumns = useMemo(
    () => localColumnConfig.filter((column) => column.isVisible),
    [localColumnConfig]
  );

  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

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
    const cleaned = String(raw ?? '').replace(/,/g, '').trim();
    if (!cleaned) return Number.NaN;
    return Number(cleaned);
  };

  const handleNumericFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    const parsed = parseFormattedNumber(event.currentTarget.value);
    if (!Number.isFinite(parsed)) return;
    event.currentTarget.value = String(parsed);
  };

  const handleNumericBlur = (
    event: React.FocusEvent<HTMLInputElement>,
    row: OpeningBalanceStoreRow,
    field: 'quantity' | 'unitCost'
  ) => {
    const parsed = parseFormattedNumber(event.currentTarget.value);
    const previousValue = field === 'quantity' ? row.quantity : row.unitCost;

    if (!Number.isFinite(parsed)) {
      event.currentTarget.value = formatNumber(previousValue ?? null);
      return;
    }

    const rounded = Number(parsed.toFixed(3));
    event.currentTarget.value = formatNumber(rounded);
    void handleEdit(row, field, rounded);
  };

  const normalizedInventoryItems = useMemo(
    () =>
      inventoryItems.map((item) => ({
        id: String(item.id),
        publicId: item.publicId ? String(item.publicId) : undefined,
        code: item.code ? String(item.code) : undefined,
        name: String(item.name),
        unit: item.unit ? String(item.unit) : undefined,
        category: item.category ? String(item.category) : undefined,
      })),
    [inventoryItems]
  );

  const itemMetaByPublicId = useMemo(() => {
    const map = new Map<string, (typeof normalizedInventoryItems)[number]>();
    normalizedInventoryItems.forEach((item) => {
      if (item.publicId) map.set(String(item.publicId), item);
    });
    return map;
  }, [normalizedInventoryItems]);

  const itemMetaById = useMemo(() => {
    const map = new Map<string, (typeof normalizedInventoryItems)[number]>();
    normalizedInventoryItems.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [normalizedInventoryItems]);

  const itemMetaByName = useMemo(() => {
    const map = new Map<string, (typeof normalizedInventoryItems)[number]>();
    normalizedInventoryItems.forEach((item) => {
      map.set(normalize(item.name), item);
    });
    return map;
  }, [normalizedInventoryItems]);

  const getItemMeta = (row: OpeningBalanceStoreRow) => {
    const byPublicId = row.itemPublicId ? itemMetaByPublicId.get(String(row.itemPublicId)) : undefined;
    const byId = itemMetaById.get(String(row.itemId));
    const byName = itemMetaByName.get(normalize(row.item?.name));
    return byPublicId || byId || byName;
  };

  const sortedRows = useMemo(() => {
    const list = [...openingBalanceRows].filter((row) => row.financialYear === year);
    const orderIndex = new Map<string, number>();
    const nameIndex = new Map<string, number>();

    normalizedInventoryItems.forEach((item, index) => {
      const key = item.publicId ?? item.id;
      orderIndex.set(String(key), index);
      nameIndex.set(normalize(item.name), index);
    });

    return list.sort((left, right) => {
      const leftKey = left.itemPublicId ?? left.itemId;
      const rightKey = right.itemPublicId ?? right.itemId;
      const leftIndex =
        orderIndex.get(String(leftKey)) ??
        nameIndex.get(normalize(left.item?.name)) ??
        Number.MAX_SAFE_INTEGER;
      const rightIndex =
        orderIndex.get(String(rightKey)) ??
        nameIndex.get(normalize(right.item?.name)) ??
        Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return (left.item?.name || '').localeCompare(right.item?.name || '', 'ar');
    });
  }, [openingBalanceRows, normalizedInventoryItems, year]);

  useEffect(() => {
    setLocalColumnConfig(mergeColumns(DEFAULT_COLUMNS, columnConfig));
  }, [columnConfig]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadOpeningBalances(year);
  }, [loadOpeningBalances, year]);

  const handleEdit = async (
    row: OpeningBalanceStoreRow,
    field: 'quantity' | 'unitCost',
    value: number
  ) => {
    if (!Number.isFinite(value)) return;
    const previousRows = openingBalanceRows;
    const nextRows = openingBalanceRows.map((entry) =>
      entry.id === row.id ? { ...entry, [field]: value } : entry
    );
    setOpeningBalanceRows(year, nextRows);

    try {
      await setOpeningBalance({
        itemPublicId: row.itemPublicId || row.item?.publicId || String(row.itemId),
        financialYear: year,
        quantity: field === 'quantity' ? value : row.quantity,
        unitCost: field === 'unitCost' ? value : row.unitCost ?? undefined,
      });
    } catch (error: any) {
      setOpeningBalanceRows(year, previousRows);
      showToast(error?.message || 'تعذر حفظ الرصيد', 'error');
    }
  };

  const handleSyncItems = async () => {
    setSyncingItems(true);
    try {
      await loadAll();
      showToast('تم تحديث قائمة الأصناف بنجاح.', 'success');
    } catch (error: any) {
      showToast(error?.message || 'تعذر تحديث الأصناف من المتجر.', 'error');
    } finally {
      setSyncingItems(false);
    }
  };

  const handleExportTemplate = () => {
    const template = normalizedInventoryItems.map((item) => ({
      'اسم الصنف': item.name ?? '',
      'المعرف العام (publicId / الكود)': item.code ?? item.publicId ?? item.id,
      'الوحدة': item.unit ?? '',
      'الفئة': item.category ?? '',
      'الكمية': '',
      'التكلفة': '',
    }));

    const headerOrder = ['اسم الصنف', 'المعرف العام (publicId / الكود)', 'الوحدة', 'الفئة', 'الكمية', 'التكلفة'];
    const worksheet = XLSX.utils.json_to_sheet(template, { header: headerOrder });
    worksheet['!cols'] = [
      { wch: 30 },
      { wch: 28 },
      { wch: 12 },
      { wch: 18 },
      { wch: 10 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Opening Balance Template');
    XLSX.writeFile(workbook, 'Opening_Balance_Template.xlsx');
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!normalizedInventoryItems.length) {
      showToast('لا توجد أصناف محمّلة. اضغط "مزامنة الأصناف" أولاً.', 'error');
      return;
    }

    setImporting(true);
    setErrorDetails(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(worksheet);

      if (!json.length) {
        showToast('الملف فارغ، لا توجد بيانات للاستيراد.', 'error');
        return;
      }

      const payload: OpeningBalancePayload[] = [];
      const errors: string[] = [];

      json.forEach((row, index) => {
        const identifier = normalize(
          row['المعرف العام (publicId / الكود)'] ||
            row['الكود'] ||
            row.Code ||
            row.id ||
            row.ID ||
            row.Name ||
            row['الاسم']
        );
        const name = normalize(row['اسم الصنف'] || row['الاسم']);
        const qty = Number(row['الكمية'] ?? row.Quantity);
        const costRaw = row['التكلفة'] ?? row.Cost;
        const unitCost = Number.isFinite(Number(costRaw)) ? Number(costRaw) : undefined;

        if ((!identifier && !name) || !Number.isFinite(qty) || qty < 0) {
          errors.push(`السطر ${index + 2}: بيانات غير صالحة (معرف/اسم أو كمية).`);
          return;
        }

        const match = normalizedInventoryItems.find((item) => {
          const publicId = normalize(item.publicId ?? item.id);
          const code = normalize(item.code);
          const id = normalize(item.id);
          const itemName = normalize(item.name);
          return publicId === identifier || code === identifier || id === identifier || itemName === name;
        });

        const matchPublicId = match?.publicId ?? match?.id;
        if (!match || !matchPublicId) {
          errors.push(`السطر ${index + 2}: لم يتم العثور على صنف مطابق لـ "${identifier || name}".`);
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
      await loadOpeningBalances(year);
    } catch (error: any) {
      showToast('فشل استيراد الملف.', 'error');
      const responseMessage = error?.response?.data?.message;
      const responseError = error?.response?.data?.error;
      const responseDetails = Array.isArray(responseMessage)
        ? responseMessage.join('\n')
        : responseMessage;

      setErrorDetails(
        responseDetails || responseError || error?.message || 'حدث خطأ أثناء قراءة الملف.'
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleColumnVisibility = (key: string) => {
    setLocalColumnConfig((previous) =>
      previous.map((column) =>
        column.key === key ? { ...column, isVisible: !column.isVisible } : column
      )
    );
  };

  const moveColumn = (key: string, direction: 'up' | 'down') => {
    setLocalColumnConfig((previous) => {
      const next = [...previous];
      const index = next.findIndex((column) => column.key === key);
      if (index < 0) return previous;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveColumns = () => {
    const merged = mergeColumns(DEFAULT_COLUMNS, localColumnConfig);
    onUpdateColumnConfig(merged);
    showToast('تم حفظ إعدادات الأعمدة', 'success');
  };

  const resetColumns = () => {
    setLocalColumnConfig(DEFAULT_COLUMNS);
    onUpdateColumnConfig(DEFAULT_COLUMNS);
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
              onChange={(event) => setYear(Number(event.target.value))}
              title="السنة المالية"
              aria-label="السنة المالية"
              className="border rounded px-3 py-2"
            >
              {[year - 1, year, year + 1].map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleSyncItems()}
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
              onClick={() => void loadOpeningBalances(year)}
              className="bg-slate-100 text-slate-700 px-3 py-2 rounded border border-slate-300 hover:bg-slate-200 flex items-center gap-1"
            >
              <RefreshCw size={14} /> تحديث
            </button>

            <button
              onClick={() => setShowColumnSettings((value) => !value)}
              className="bg-slate-100 text-slate-700 px-3 py-2 rounded border border-slate-300 hover:bg-slate-200"
            >
              إعدادات الأعمدة
            </button>
          </div>
        </div>

        {showColumnSettings && (
          <div className="border rounded-xl p-3 bg-slate-50 space-y-2">
            <div className="text-sm font-bold text-slate-700">إعدادات الأعمدة (داخل القسم)</div>
            {localColumnConfig.map((column, index) => (
              <div key={column.key} className="flex items-center justify-between border rounded p-2 bg-white">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={column.isVisible}
                    onChange={() => toggleColumnVisibility(column.key)}
                  />
                  {column.label}
                </label>
                <div className="flex gap-2">
                  <button
                    disabled={index === 0}
                    className="px-2 py-1 border rounded disabled:opacity-40"
                    onClick={() => moveColumn(column.key, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    disabled={index === localColumnConfig.length - 1}
                    className="px-2 py-1 border rounded disabled:opacity-40"
                    onClick={() => moveColumn(column.key, 'down')}
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

        {(errorDetails || openingBalancesError) && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded whitespace-pre-wrap text-sm">
            {errorDetails || openingBalancesError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="border-b px-4 py-2 text-sm text-slate-600 flex justify-between">
            <span>الجدول</span>
            {openingBalancesLoading && <span className="text-amber-600">جاري التحميل...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column.key} className="py-2 px-3 text-right">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    {visibleColumns.map((column) => {
                      const meta = getItemMeta(row);

                      if (column.key === 'item') {
                        return (
                          <td key={column.key} className="px-3 py-2">
                            {row.item?.name || meta?.name || `#${row.itemId}`}
                          </td>
                        );
                      }

                      if (column.key === 'quantity') {
                        return (
                          <td key={column.key} className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              title={`كمية ${row.item?.name || meta?.name || row.itemId}`}
                              aria-label={`كمية ${row.item?.name || meta?.name || row.itemId}`}
                              className="w-full border rounded px-2 py-1 text-right"
                              defaultValue={formatNumber(row.quantity)}
                              onFocus={handleNumericFocus}
                              onBlur={(event) => handleNumericBlur(event, row, 'quantity')}
                            />
                          </td>
                        );
                      }

                      if (column.key === 'unitCost') {
                        return (
                          <td key={column.key} className="px-3 py-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              title={`تكلفة ${row.item?.name || meta?.name || row.itemId}`}
                              aria-label={`تكلفة ${row.item?.name || meta?.name || row.itemId}`}
                              className="w-full border rounded px-2 py-1 text-right"
                              defaultValue={row.unitCost == null ? '' : formatNumber(row.unitCost)}
                              onFocus={handleNumericFocus}
                              onBlur={(event) => handleNumericBlur(event, row, 'unitCost')}
                            />
                          </td>
                        );
                      }

                      if (column.key === 'unit') {
                        return <td key={column.key} className="px-3 py-2">{meta?.unit || '-'}</td>;
                      }

                      if (column.key === 'category') {
                        return <td key={column.key} className="px-3 py-2">{meta?.category || '-'}</td>;
                      }

                      if (column.key === 'code') {
                        return <td key={column.key} className="px-3 py-2">{meta?.code ?? ''}</td>;
                      }

                      return null;
                    })}
                  </tr>
                ))}

                {!openingBalancesLoading && sortedRows.length === 0 && (
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
