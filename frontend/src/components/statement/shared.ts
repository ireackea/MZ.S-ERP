import type { GridColumnPreference } from '../../types';

export type SortDirection = 'asc' | 'desc';
export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPaperSize = 'a4' | 'a3' | 'letter';
export type PrintMargins = 'narrow' | 'normal' | 'wide';
export type PrintScalingMode = 'fit' | 'actual';
export type PrintRange = 'all' | 'current_page' | 'selected_rows';
export type PrintFlowMode = 'continuous' | 'paged';

export type StatementRow = {
  id: string;
  rowNumber: number;
  date: string;
  type: string;
  warehouseInvoice: string;
  supplierInvoice: string;
  itemName: string;
  itemCode: string;
  unit: string;
  quantity: number;
  price: number;
  total: number;
  grossWeight: number;
  netWeight: number;
  difference: number;
  packageCount: number;
  weightSlip: string;
  supplierOrReceiver: string;
  warehouseId: string;
  truckNumber: string;
  trailerNumber: string;
  driverName: string;
  entryTime: string;
  exitTime: string;
  unloadingRule: string;
  delayMinutes: number;
  delayAmount: number;
  notes: string;
};

export type StatementSummary = {
  gross: number;
  net: number;
  difference: number;
  delayMinutes: number;
  delayAmount: number;
};

export type StatementPrintConfig = {
  printTitle: string;
  orientation: PrintOrientation;
  paperSize: PrintPaperSize;
  margins: PrintMargins;
  flowMode: PrintFlowMode;
  scalingMode: PrintScalingMode;
  zoom: number;
  fontSize: number;
  printGridlines: boolean;
  printBackgroundColors: boolean;
  printSummaryCards: boolean;
  printSignatures: boolean;
  repeatHeaders: boolean;
  autoSizeColumnsByContent: boolean;
  range: PrintRange;
  printColumnKeys: string[];
};

export const PRINT_PRESET_STORAGE_KEY = 'print_presets_statement';
export const PDF_RENDER_ENDPOINT = import.meta.env.VITE_PDF_RENDER_ENDPOINT || '/api/render-pdf';
export const PRINT_FONT_MIN = 8;
export const PRINT_FONT_MAX = 24;
export const DEFAULT_PRINT_TITLE = 'كشف الحساب';
export const STATEMENT_SIGNATURE_TITLES = ['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'] as const;

export const FALLBACK_COLUMNS: GridColumnPreference[] = [
  { key: 'select', label: 'تحديد', visible: true, order: 0, width: 64, frozen: true },
  { key: 'rowNumber', label: '#', visible: true, order: 1, width: 64, frozen: true },
  { key: 'date', label: 'التاريخ', visible: true, order: 2, width: 130, frozen: false },
  { key: 'type', label: 'نوع العملية', visible: true, order: 3, width: 120, frozen: false },
  { key: 'warehouseInvoice', label: 'فاتورة المخزن', visible: true, order: 4, width: 140, frozen: false },
  { key: 'supplierInvoice', label: 'فاتورة المورد', visible: true, order: 5, width: 140, frozen: false },
  { key: 'itemName', label: 'اسم الصنف', visible: true, order: 6, width: 220, frozen: true },
  { key: 'itemCode', label: 'كود الصنف', visible: true, order: 7, width: 120, frozen: false },
  { key: 'unit', label: 'الوحدة', visible: true, order: 8, width: 90, frozen: false },
  { key: 'quantity', label: 'الكمية', visible: true, order: 9, width: 120, frozen: false },
  { key: 'price', label: 'السعر', visible: true, order: 10, width: 120, frozen: false },
  { key: 'total', label: 'الإجمالي', visible: true, order: 11, width: 130, frozen: false },
  { key: 'grossWeight', label: 'الوزن القائم', visible: true, order: 12, width: 140, frozen: false },
  { key: 'netWeight', label: 'الوزن الصافي', visible: true, order: 13, width: 130, frozen: false },
  { key: 'difference', label: 'الفرق', visible: true, order: 14, width: 110, frozen: false },
  { key: 'packageCount', label: 'عدد العبوات', visible: true, order: 15, width: 110, frozen: false },
  { key: 'weightSlip', label: 'رقم الميزان', visible: true, order: 16, width: 130, frozen: false },
  { key: 'supplierOrReceiver', label: 'المورد/العميل', visible: true, order: 17, width: 200, frozen: false },
  { key: 'warehouseId', label: 'رقم المخزن', visible: true, order: 18, width: 130, frozen: false },
  { key: 'truckNumber', label: 'رقم السيارة', visible: true, order: 19, width: 110, frozen: false },
  { key: 'trailerNumber', label: 'رقم المقطورة', visible: true, order: 20, width: 110, frozen: false },
  { key: 'driverName', label: 'اسم السائق', visible: true, order: 21, width: 150, frozen: false },
  { key: 'entryTime', label: 'وقت الدخول', visible: true, order: 22, width: 90, frozen: false },
  { key: 'exitTime', label: 'وقت الخروج', visible: true, order: 23, width: 90, frozen: false },
  { key: 'unloadingRule', label: 'قاعدة التفريغ', visible: true, order: 24, width: 170, frozen: false },
  { key: 'delayMinutes', label: 'دقائق التأخير', visible: true, order: 25, width: 130, frozen: false },
  { key: 'delayAmount', label: 'قيمة التأخير', visible: true, order: 26, width: 130, frozen: false },
  { key: 'notes', label: 'ملاحظات', visible: true, order: 27, width: 220, frozen: false },
  { key: 'actions', label: 'الإجراءات', visible: true, order: 28, width: 110, frozen: false },
];

export const DEFAULT_PRINT_CONFIG: StatementPrintConfig = {
  printTitle: DEFAULT_PRINT_TITLE,
  orientation: 'portrait',
  paperSize: 'a4',
  margins: 'normal',
  flowMode: 'continuous',
  scalingMode: 'fit',
  zoom: 100,
  fontSize: 10,
  printGridlines: true,
  printBackgroundColors: true,
  printSummaryCards: true,
  printSignatures: true,
  repeatHeaders: true,
  autoSizeColumnsByContent: false,
  range: 'all',
  printColumnKeys: [],
};

export const isNumericColumn = (key: string) =>
  ['rowNumber', 'quantity', 'price', 'total', 'grossWeight', 'netWeight', 'difference', 'packageCount', 'delayMinutes', 'delayAmount'].includes(key);

export const formatNumber = (value: number, digits = 3) =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const chunkRows = <T,>(rows: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [rows];
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks.length ? chunks : [[]];
};

export const getPaperDimensions = (size: PrintPaperSize, orientation: PrintOrientation) => {
  const table: Record<PrintPaperSize, { width: number; height: number }> = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
  };
  const base = table[size];
  return orientation === 'portrait' ? base : { width: base.height, height: base.width };
};

export const getMarginPixels = (margins: PrintMargins) => {
  if (margins === 'narrow') return 20;
  if (margins === 'wide') return 56;
  return 36;
};

export const getPdfMarginsMm = (margins: PrintMargins): [number, number, number, number] => {
  if (margins === 'narrow') return [5, 5, 5, 5];
  if (margins === 'wide') return [15, 15, 15, 15];
  return [10, 10, 10, 10];
};

export const getPdfPaperLabel = (paperSize: PrintPaperSize) => {
  if (paperSize === 'a3') return 'A3';
  if (paperSize === 'letter') return 'Letter';
  return 'A4';
};

export const parsePdfServiceError = (value: string) => {
  const raw = (value || '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as { error?: string; details?: string };
    const parts = [parsed.error, parsed.details].filter(Boolean);
    return parts.join(' - ');
  } catch {
    return raw.slice(0, 220);
  }
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const normalizeStatementColumnLabels = (columns: GridColumnPreference[]) =>
  columns.map((column) => {
    if (column.key === 'grossWeight') {
      return { ...column, label: 'الوزن القائم' };
    }
    if (column.key === 'netWeight') {
      return { ...column, label: 'الوزن الصافي' };
    }
    return column;
  });