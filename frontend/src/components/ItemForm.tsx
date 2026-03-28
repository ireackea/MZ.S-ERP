// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Legacy Migration Phase 2 - ItemForm Component - 2026-02-27
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';
import { Loader2, Save, X } from 'lucide-react';
import { toast } from '@services/toastService';
import apiClient from '@api/client';
import { syncItems, type SyncItemPayload } from '@services/itemsService';
import type { DataScope, Item } from '../types';

type FormMode = 'create' | 'edit';

type ItemFormValues = {
  id: string;
  code: string;
  barcode: string;
  name: string;
  englishName: string;
  category: string;
  unit: string;
  zone: string;
  minLimit: string;
  maxLimit: string;
  orderLimit: string;
  currentStock: string;
  packageWeight: string;
  costPrice: string;
  co2PerUnit: string;
  waterUsagePerUnit: string;
  sustainabilityRating: '' | 'A' | 'B' | 'C' | 'D';
  warehouseId: '' | DataScope;
  tagsText: string;
};

type ValidationErrors = Partial<Record<keyof ItemFormValues, string>>;

type InventoryStoreState = {
  items: Item[];
  isSubmitting: boolean;
  createItem: (item: Item) => Promise<Item>;
  updateItem: (item: Item) => Promise<Item>;
};

type ItemFormProps = {
  isOpen: boolean;
  mode: FormMode;
  initialItem?: Partial<Item> | null;
  onClose: () => void;
  onSuccess?: (item: Item) => void;
  title?: string;
};

const ALLOWED_WAREHOUSE_IDS: DataScope[] = ['all', 'warehouse_a', 'warehouse_b'];
const RATING_OPTIONS: Array<'' | 'A' | 'B' | 'C' | 'D'> = ['', 'A', 'B', 'C', 'D'];

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ');

const normalizeSavedItem = (raw: any, fallback: Item): Item => {
  if (!raw || typeof raw !== 'object') return fallback;
  const saved: Item = {
    ...fallback,
    id: String(raw.publicId || raw.id || fallback.id),
    code: raw.code ?? fallback.code,
    barcode: raw.barcode ?? fallback.barcode,
    name: raw.name ?? fallback.name,
    englishName: raw.englishName ?? raw.description ?? fallback.englishName,
    category: raw.category ?? fallback.category,
    unit: raw.unit ?? fallback.unit,
    minLimit: raw.minLimit == null ? fallback.minLimit : toNumber(raw.minLimit, fallback.minLimit),
    maxLimit: raw.maxLimit == null ? fallback.maxLimit : toNumber(raw.maxLimit, fallback.maxLimit),
    orderLimit: raw.orderLimit == null ? fallback.orderLimit : toNumber(raw.orderLimit, fallback.orderLimit ?? 0),
    currentStock: raw.currentStock == null ? fallback.currentStock : toNumber(raw.currentStock, fallback.currentStock),
    lastUpdated: new Date().toISOString(),
  };
  return saved;
};

const toSyncPayload = (item: Item): SyncItemPayload => ({
  publicId: String(item.id),
  name: item.name,
  code: item.code || undefined,
  barcode: item.barcode || undefined,
  unit: item.unit,
  category: item.category,
  minLimit: toNumber(item.minLimit, 0),
  maxLimit: toNumber(item.maxLimit, 1000),
  orderLimit: item.orderLimit == null ? undefined : toNumber(item.orderLimit, 0),
  currentStock: toNumber(item.currentStock, 0),
  description: item.englishName || undefined,
});

const toApiPayload = (item: Item) => ({
  id: String(item.id),
  publicId: String(item.id),
  code: item.code || null,
  barcode: item.barcode || null,
  name: item.name,
  englishName: item.englishName || null,
  description: item.englishName || null,
  category: item.category,
  unit: item.unit,
  zone: item.zone || null,
  minLimit: toNumber(item.minLimit, 0),
  maxLimit: toNumber(item.maxLimit, 1000),
  orderLimit: item.orderLimit == null ? null : toNumber(item.orderLimit, 0),
  currentStock: toNumber(item.currentStock, 0),
  packageWeight: item.packageWeight == null ? null : toNumber(item.packageWeight, 0),
  costPrice: item.costPrice == null ? null : toNumber(item.costPrice, 0),
  co2PerUnit: item.co2PerUnit == null ? null : toNumber(item.co2PerUnit, 0),
  waterUsagePerUnit: item.waterUsagePerUnit == null ? null : toNumber(item.waterUsagePerUnit, 0),
  sustainabilityRating: item.sustainabilityRating || null,
  warehouseId: item.warehouseId || null,
  tags: item.tags || [],
  lastUpdated: item.lastUpdated || new Date().toISOString(),
});

const saveItemWithApi = async (mode: FormMode, item: Item): Promise<Item> => {
  try {
    if (mode === 'create') {
      const response = await apiClient.post('/items', toApiPayload(item));
      return normalizeSavedItem(response.data, item);
    }
    const response = await apiClient.put(`/items/${encodeURIComponent(String(item.id))}`, toApiPayload(item));
    return normalizeSavedItem(response.data, item);
  } catch (error: any) {
    const status = Number(error?.response?.status || 0);
    if ([404, 405, 501].includes(status)) {
      // Backward compatibility with current backend which uses /items/sync.
      await syncItems([toSyncPayload(item)]);
      return item;
    }
    throw error;
  }
};

export const useInventoryStore = create<InventoryStoreState>((set) => ({
  items: [],
  isSubmitting: false,

  createItem: async (item) => {
    set({ isSubmitting: true });
    try {
      const saved = await saveItemWithApi('create', item);
      set((state) => ({
        items: [...state.items.filter((row) => String(row.id) !== String(saved.id)), saved],
      }));
      return saved;
    } finally {
      set({ isSubmitting: false });
    }
  },

  updateItem: async (item) => {
    set({ isSubmitting: true });
    try {
      const saved = await saveItemWithApi('edit', item);
      set((state) => ({
        items: state.items.map((row) => (String(row.id) === String(saved.id) ? saved : row)),
      }));
      return saved;
    } finally {
      set({ isSubmitting: false });
    }
  },
}));

const buildInitialValues = (mode: FormMode, initialItem?: Partial<Item> | null): ItemFormValues => {
  const resolvedId = mode === 'create' ? crypto.randomUUID() : String(initialItem?.id || crypto.randomUUID());
  const warehouseIdValue = initialItem?.warehouseId && ALLOWED_WAREHOUSE_IDS.includes(initialItem.warehouseId)
    ? initialItem.warehouseId
    : '';
  const ratingValue = RATING_OPTIONS.includes((initialItem?.sustainabilityRating as any) || '')
    ? ((initialItem?.sustainabilityRating as any) || '')
    : '';

  return {
    id: resolvedId,
    code: String(initialItem?.code || ''),
    barcode: String(initialItem?.barcode || ''),
    name: String(initialItem?.name || ''),
    englishName: String(initialItem?.englishName || ''),
    category: String(initialItem?.category || ''),
    unit: String(initialItem?.unit || ''),
    zone: String(initialItem?.zone || ''),
    minLimit: String(initialItem?.minLimit ?? 0),
    maxLimit: String(initialItem?.maxLimit ?? 1000),
    orderLimit: initialItem?.orderLimit == null ? '' : String(initialItem.orderLimit),
    currentStock: String(initialItem?.currentStock ?? 0),
    packageWeight: initialItem?.packageWeight == null ? '' : String(initialItem.packageWeight),
    costPrice: initialItem?.costPrice == null ? '' : String(initialItem.costPrice),
    co2PerUnit: initialItem?.co2PerUnit == null ? '' : String(initialItem.co2PerUnit),
    waterUsagePerUnit: initialItem?.waterUsagePerUnit == null ? '' : String(initialItem.waterUsagePerUnit),
    sustainabilityRating: ratingValue as ItemFormValues['sustainabilityRating'],
    warehouseId: warehouseIdValue as ItemFormValues['warehouseId'],
    tagsText: Array.isArray(initialItem?.tags) ? initialItem!.tags!.join(', ') : '',
  };
};

const validateValues = (values: ItemFormValues): ValidationErrors => {
  const errors: ValidationErrors = {};

  const id = normalizeText(values.id);
  const name = normalizeText(values.name);
  const code = normalizeText(values.code);
  const category = normalizeText(values.category);
  const unit = normalizeText(values.unit);
  const englishName = normalizeText(values.englishName);
  const zone = normalizeText(values.zone);
  const barcode = normalizeText(values.barcode);

  const minLimit = toNumber(values.minLimit, NaN);
  const maxLimit = toNumber(values.maxLimit, NaN);
  const currentStock = toNumber(values.currentStock, NaN);
  const orderLimit = values.orderLimit.trim() ? toNumber(values.orderLimit, NaN) : null;
  const packageWeight = values.packageWeight.trim() ? toNumber(values.packageWeight, NaN) : null;
  const costPrice = values.costPrice.trim() ? toNumber(values.costPrice, NaN) : null;
  const co2PerUnit = values.co2PerUnit.trim() ? toNumber(values.co2PerUnit, NaN) : null;
  const waterUsagePerUnit = values.waterUsagePerUnit.trim() ? toNumber(values.waterUsagePerUnit, NaN) : null;

  if (!id) errors.id = 'Item ID is required.';
  else if (id.length < 8) errors.id = 'Item ID must be at least 8 characters.';

  if (!name) errors.name = 'Name is required.';
  else if (name.length < 2 || name.length > 120) errors.name = 'Name length must be between 2 and 120.';

  if (code && code.length > 64) errors.code = 'Code must not exceed 64 characters.';
  if (barcode && barcode.length > 64) errors.barcode = 'Barcode must not exceed 64 characters.';
  if (englishName && englishName.length > 120) errors.englishName = 'English name must not exceed 120 characters.';

  if (!category) errors.category = 'Category is required.';
  else if (category.length > 80) errors.category = 'Category must not exceed 80 characters.';

  if (!unit) errors.unit = 'Unit is required.';
  else if (unit.length > 32) errors.unit = 'Unit must not exceed 32 characters.';

  if (zone && zone.length > 80) errors.zone = 'Zone must not exceed 80 characters.';

  if (!Number.isFinite(minLimit) || minLimit < 0) errors.minLimit = 'Min limit must be a non-negative number.';
  if (!Number.isFinite(maxLimit) || maxLimit < 0) errors.maxLimit = 'Max limit must be a non-negative number.';
  if (!Number.isFinite(currentStock) || currentStock < 0) errors.currentStock = 'Current stock must be a non-negative number.';
  if (Number.isFinite(minLimit) && Number.isFinite(maxLimit) && maxLimit < minLimit) {
    errors.maxLimit = 'Max limit must be greater than or equal to min limit.';
  }

  if (orderLimit != null) {
    if (!Number.isFinite(orderLimit) || orderLimit < 0) errors.orderLimit = 'Order limit must be a non-negative number.';
    if (Number.isFinite(maxLimit) && Number.isFinite(orderLimit) && orderLimit > maxLimit) {
      errors.orderLimit = 'Order limit must not exceed max limit.';
    }
  }

  if (packageWeight != null && (!Number.isFinite(packageWeight) || packageWeight < 0)) {
    errors.packageWeight = 'Package weight must be a non-negative number.';
  }
  if (costPrice != null && (!Number.isFinite(costPrice) || costPrice < 0)) {
    errors.costPrice = 'Cost price must be a non-negative number.';
  }
  if (co2PerUnit != null && (!Number.isFinite(co2PerUnit) || co2PerUnit < 0)) {
    errors.co2PerUnit = 'CO2 must be a non-negative number.';
  }
  if (waterUsagePerUnit != null && (!Number.isFinite(waterUsagePerUnit) || waterUsagePerUnit < 0)) {
    errors.waterUsagePerUnit = 'Water usage must be a non-negative number.';
  }

  if (values.sustainabilityRating && !['A', 'B', 'C', 'D'].includes(values.sustainabilityRating)) {
    errors.sustainabilityRating = 'Rating must be A, B, C, or D.';
  }

  if (values.warehouseId && !ALLOWED_WAREHOUSE_IDS.includes(values.warehouseId)) {
    errors.warehouseId = 'Invalid warehouse scope.';
  }

  if (values.tagsText.trim()) {
    const tags = values.tagsText
      .split(',')
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (tags.some((tag) => tag.length > 40)) {
      errors.tagsText = 'Each tag must not exceed 40 characters.';
    }
  }

  return errors;
};

const valuesToItem = (values: ItemFormValues): Item => {
  const tags = values.tagsText
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  return {
    id: normalizeText(values.id),
    code: normalizeText(values.code) || undefined,
    barcode: normalizeText(values.barcode) || undefined,
    name: normalizeText(values.name),
    englishName: normalizeText(values.englishName) || undefined,
    category: normalizeText(values.category),
    unit: normalizeText(values.unit),
    zone: normalizeText(values.zone) || undefined,
    minLimit: toNumber(values.minLimit, 0),
    maxLimit: toNumber(values.maxLimit, 1000),
    orderLimit: values.orderLimit.trim() ? toNumber(values.orderLimit, 0) : undefined,
    currentStock: toNumber(values.currentStock, 0),
    packageWeight: values.packageWeight.trim() ? toNumber(values.packageWeight, 0) : undefined,
    costPrice: values.costPrice.trim() ? toNumber(values.costPrice, 0) : undefined,
    co2PerUnit: values.co2PerUnit.trim() ? toNumber(values.co2PerUnit, 0) : undefined,
    waterUsagePerUnit: values.waterUsagePerUnit.trim() ? toNumber(values.waterUsagePerUnit, 0) : undefined,
    sustainabilityRating: values.sustainabilityRating || undefined,
    warehouseId: values.warehouseId || undefined,
    tags,
    lastUpdated: new Date().toISOString(),
  };
};

const ItemForm: React.FC<ItemFormProps> = ({
  isOpen,
  mode,
  initialItem,
  onClose,
  onSuccess,
  title,
}) => {
  const { createItem, updateItem, isSubmitting } = useInventoryStore();
  const [values, setValues] = useState<ItemFormValues>(() => buildInitialValues(mode, initialItem));
  const [errors, setErrors] = useState<ValidationErrors>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const headingId = 'item-form-title';

  const headingText = useMemo(() => {
    if (title) return title;
    return mode === 'create' ? 'Create New Item' : 'Edit Item';
  }, [mode, title]);

  useEffect(() => {
    if (!isOpen) return;
    setValues(buildInitialValues(mode, initialItem));
    setErrors({});
    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isOpen, mode, initialItem]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const setField = <K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateAndSetErrors = () => {
    const nextErrors = validateValues(values);
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateAndSetErrors()) {
      toast.error('Please fix validation errors before saving.');
      return;
    }
    const item = valuesToItem(values);
    try {
      const saved = mode === 'create' ? await createItem(item) : await updateItem(item);
      toast.success(mode === 'create' ? 'Item created successfully.' : 'Item updated successfully.');
      onSuccess?.(saved);
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to save item.');
    }
  };

  if (!isOpen) return null;

  const fieldClass = (field: keyof ItemFormValues) =>
    `w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition
     dark:bg-slate-900 dark:text-slate-100 ${
       errors[field]
         ? 'border-red-400 focus:border-red-500'
         : 'border-slate-300 focus:border-slate-500 dark:border-slate-700 dark:focus:border-slate-500'
     }`;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <form onSubmit={onSubmit} noValidate>
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
              <h2 id={headingId} className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {headingText}
              </h2>
              <button
                type="button"
                aria-label="Close item form"
                onClick={onClose}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="item-id" className="text-xs font-semibold text-slate-700 dark:text-slate-300">ID *</label>
                <input ref={firstInputRef} id="item-id" aria-label="Item ID" value={values.id} onChange={(e) => setField('id', e.target.value)} className={fieldClass('id')} readOnly={mode === 'edit'} aria-invalid={Boolean(errors.id)} />
                {errors.id && <p className="text-xs text-red-600">{errors.id}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-code" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Code</label>
                <input id="item-code" aria-label="Item code" value={values.code} onChange={(e) => setField('code', e.target.value)} className={fieldClass('code')} aria-invalid={Boolean(errors.code)} />
                {errors.code && <p className="text-xs text-red-600">{errors.code}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-barcode" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Barcode</label>
                <input id="item-barcode" aria-label="Item barcode" value={values.barcode} onChange={(e) => setField('barcode', e.target.value)} className={fieldClass('barcode')} aria-invalid={Boolean(errors.barcode)} />
                {errors.barcode && <p className="text-xs text-red-600">{errors.barcode}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-name" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Name *</label>
                <input id="item-name" aria-label="Item name" value={values.name} onChange={(e) => setField('name', e.target.value)} className={fieldClass('name')} aria-invalid={Boolean(errors.name)} required />
                {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-english-name" className="text-xs font-semibold text-slate-700 dark:text-slate-300">English Name</label>
                <input id="item-english-name" aria-label="Item english name" value={values.englishName} onChange={(e) => setField('englishName', e.target.value)} className={fieldClass('englishName')} aria-invalid={Boolean(errors.englishName)} />
                {errors.englishName && <p className="text-xs text-red-600">{errors.englishName}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-category" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                <input id="item-category" aria-label="Item category" value={values.category} onChange={(e) => setField('category', e.target.value)} className={fieldClass('category')} aria-invalid={Boolean(errors.category)} required />
                {errors.category && <p className="text-xs text-red-600">{errors.category}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-unit" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Unit *</label>
                <input id="item-unit" aria-label="Item unit" value={values.unit} onChange={(e) => setField('unit', e.target.value)} className={fieldClass('unit')} aria-invalid={Boolean(errors.unit)} required />
                {errors.unit && <p className="text-xs text-red-600">{errors.unit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-zone" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Zone</label>
                <input id="item-zone" aria-label="Item zone" value={values.zone} onChange={(e) => setField('zone', e.target.value)} className={fieldClass('zone')} aria-invalid={Boolean(errors.zone)} />
                {errors.zone && <p className="text-xs text-red-600">{errors.zone}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-warehouse" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Warehouse Scope</label>
                <select id="item-warehouse" aria-label="Item warehouse scope" value={values.warehouseId} onChange={(e) => setField('warehouseId', e.target.value as ItemFormValues['warehouseId'])} className={fieldClass('warehouseId')} aria-invalid={Boolean(errors.warehouseId)}>
                  <option value="">None</option>
                  <option value="all">all</option>
                  <option value="warehouse_a">warehouse_a</option>
                  <option value="warehouse_b">warehouse_b</option>
                </select>
                {errors.warehouseId && <p className="text-xs text-red-600">{errors.warehouseId}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-min" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Min Limit *</label>
                <input id="item-min" type="number" min={0} step="0.001" aria-label="Item minimum limit" value={values.minLimit} onChange={(e) => setField('minLimit', e.target.value)} className={fieldClass('minLimit')} aria-invalid={Boolean(errors.minLimit)} />
                {errors.minLimit && <p className="text-xs text-red-600">{errors.minLimit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-max" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Max Limit *</label>
                <input id="item-max" type="number" min={0} step="0.001" aria-label="Item maximum limit" value={values.maxLimit} onChange={(e) => setField('maxLimit', e.target.value)} className={fieldClass('maxLimit')} aria-invalid={Boolean(errors.maxLimit)} />
                {errors.maxLimit && <p className="text-xs text-red-600">{errors.maxLimit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-order-limit" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Order Limit</label>
                <input id="item-order-limit" type="number" min={0} step="0.001" aria-label="Item order limit" value={values.orderLimit} onChange={(e) => setField('orderLimit', e.target.value)} className={fieldClass('orderLimit')} aria-invalid={Boolean(errors.orderLimit)} />
                {errors.orderLimit && <p className="text-xs text-red-600">{errors.orderLimit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-stock" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Current Stock *</label>
                <input id="item-stock" type="number" min={0} step="0.001" aria-label="Item current stock" value={values.currentStock} onChange={(e) => setField('currentStock', e.target.value)} className={fieldClass('currentStock')} aria-invalid={Boolean(errors.currentStock)} />
                {errors.currentStock && <p className="text-xs text-red-600">{errors.currentStock}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-package-weight" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Package Weight</label>
                <input id="item-package-weight" type="number" min={0} step="0.001" aria-label="Item package weight" value={values.packageWeight} onChange={(e) => setField('packageWeight', e.target.value)} className={fieldClass('packageWeight')} aria-invalid={Boolean(errors.packageWeight)} />
                {errors.packageWeight && <p className="text-xs text-red-600">{errors.packageWeight}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-cost-price" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cost Price</label>
                <input id="item-cost-price" type="number" min={0} step="0.001" aria-label="Item cost price" value={values.costPrice} onChange={(e) => setField('costPrice', e.target.value)} className={fieldClass('costPrice')} aria-invalid={Boolean(errors.costPrice)} />
                {errors.costPrice && <p className="text-xs text-red-600">{errors.costPrice}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-co2" className="text-xs font-semibold text-slate-700 dark:text-slate-300">CO2 Per Unit</label>
                <input id="item-co2" type="number" min={0} step="0.001" aria-label="Item CO2 per unit" value={values.co2PerUnit} onChange={(e) => setField('co2PerUnit', e.target.value)} className={fieldClass('co2PerUnit')} aria-invalid={Boolean(errors.co2PerUnit)} />
                {errors.co2PerUnit && <p className="text-xs text-red-600">{errors.co2PerUnit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-water" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Water Usage Per Unit</label>
                <input id="item-water" type="number" min={0} step="0.001" aria-label="Item water usage per unit" value={values.waterUsagePerUnit} onChange={(e) => setField('waterUsagePerUnit', e.target.value)} className={fieldClass('waterUsagePerUnit')} aria-invalid={Boolean(errors.waterUsagePerUnit)} />
                {errors.waterUsagePerUnit && <p className="text-xs text-red-600">{errors.waterUsagePerUnit}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="item-rating" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sustainability Rating</label>
                <select id="item-rating" aria-label="Item sustainability rating" value={values.sustainabilityRating} onChange={(e) => setField('sustainabilityRating', e.target.value as ItemFormValues['sustainabilityRating'])} className={fieldClass('sustainabilityRating')} aria-invalid={Boolean(errors.sustainabilityRating)}>
                  <option value="">None</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
                {errors.sustainabilityRating && <p className="text-xs text-red-600">{errors.sustainabilityRating}</p>}
              </div>

              <div className="space-y-1 md:col-span-2 lg:col-span-3">
                <label htmlFor="item-tags" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Tags (comma separated)</label>
                <input id="item-tags" aria-label="Item tags" value={values.tagsText} onChange={(e) => setField('tagsText', e.target.value)} className={fieldClass('tagsText')} aria-invalid={Boolean(errors.tagsText)} />
                {errors.tagsText && <p className="text-xs text-red-600">{errors.tagsText}</p>}
              </div>
            </div>

            <div className="sticky bottom-0 z-20 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
              <button
                type="button"
                aria-label="Cancel item form"
                onClick={onClose}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                aria-label={mode === 'create' ? 'Create item' : 'Save item changes'}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {mode === 'create' ? 'Create Item' : 'Save Changes'}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ItemForm;


