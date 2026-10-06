import { AlertCircle, AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react';
import { getInventoryStatus } from '@services/inventoryStatus';
import type { Item, ItemSortMode } from '../../types';
import type { ExcelImportRow, ItemDto } from '@services/itemsService';
import { buildImportTemplateRow } from './import/import-fields';

export type ViewMode = 'list' | 'grid';
export type StatusFilter = 'all' | 'good' | 'warning' | 'critical';
export type PendingActionMode = 'archive' | 'restore' | 'purge';

export type ItemEditorForm = {
  id?: string;
  name: string;
  code: string;
  barcode: string;
  englishName: string;
  category: string;
  unit: string;
  packageWeight: string;
  minLimit: string;
  maxLimit: string;
  orderLimit: string;
  currentStock: string;
};

export type BulkEditorForm = {
  category: string;
  unit: string;
  packageWeight: string;
  minLimit: string;
  maxLimit: string;
  orderLimit: string;
};

export type PendingActionState = {
  mode: PendingActionMode;
  ids: string[];
  title: string;
  description: string;
  confirmLabel: string;
  confirmClassName: string;
};

export type ItemStatusMeta = {
  key: Exclude<StatusFilter, 'all'>;
  label: string;
  chipClassName: string;
  barClassName: string;
  cardClassName: string;
  icon: LucideIcon;
};

export const SORTS: Array<{ value: ItemSortMode; label: string }> = [
  { value: 'manual_locked', label: 'ترتيب يدوي مخصص' },
  { value: 'name_asc', label: 'الاسم أ-ي' },
  { value: 'name_desc', label: 'الاسم ي-أ' },
  { value: 'code_asc', label: 'الكود تصاعدي' },
  { value: 'category_then_name', label: 'حسب التصنيف ثم الاسم' },
];

export const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'good', label: 'متوفر' },
  { value: 'warning', label: 'منخفض' },
  { value: 'critical', label: 'حرج' },
];

export const EMPTY_FORM: ItemEditorForm = {
  name: '',
  code: '',
  barcode: '',
  englishName: '',
  category: '',
  unit: '',
  packageWeight: '',
  minLimit: '0',
  maxLimit: '1000',
  orderLimit: '',
  currentStock: '0',
};

export const EMPTY_BULK_FORM: BulkEditorForm = {
  category: '',
  unit: '',
  packageWeight: '',
  minLimit: '',
  maxLimit: '',
  orderLimit: '',
};

/**
 * The download template, generated from the single field list.
 *
 * It used to be a hand-written row that contained `currentStock` — a column the
 * server has no field for, which `forbidNonWhitelisted` turns into a 400 for the
 * whole request. An operator filled in their stock figures, saw a green preview,
 * and every item landed at zero. The column matcher separately gave that field
 * nine aliases at 99% confidence and counted it in the quality score, so the
 * interface worked actively against them.
 *
 * Deriving the row from `IMPORT_FIELDS` removes the possibility rather than the
 * instance: a field the payload cannot carry cannot be offered for download,
 * because the template and the payload are now the same list.
 */
export const EXCEL_TEMPLATE_ROWS: Array<Record<string, string | number>> = [buildImportTemplateRow()];

const quantityFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export const n = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
export const formatQuantity = (value: number | undefined) => quantityFormatter.format(n(value, 0));

export const mapItemDtoToItem = (row: ItemDto): Item => ({
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
  packageWeight: row.packageWeight == null ? undefined : n(row.packageWeight, 0),
  currentStock: n(row.currentStock, 0),
  lastUpdated: row.updatedAt || new Date().toISOString(),
});

export const getItemStatusMeta = (item: Item): ItemStatusMeta => {
  const currentStock = n(item.currentStock, 0);
  const minLimit = n(item.minLimit, 0);
  const orderLimit = item.orderLimit == null ? undefined : n(item.orderLimit, 0);
  const inventoryStatus = getInventoryStatus({ balance: currentStock, minLimit, orderLimit });

  if (inventoryStatus.key === 'critical') {
    return {
      key: 'critical',
      label: 'حرج',
      chipClassName: 'bg-red-50 text-red-700 border-red-200',
      barClassName: 'bg-red-500',
      cardClassName: 'border-red-200 ring-red-500/10',
      icon: AlertCircle,
    };
  }

  if (inventoryStatus.key === 'warning') {
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

export const getProgressPercent = (item: Item) => {
  const maxLimit = n(item.maxLimit, 0);
  if (maxLimit <= 0) return 0;
  return Math.min(100, Math.max(0, (n(item.currentStock, 0) / maxLimit) * 100));
};

export type ImportPreviewRow = ExcelImportRow;