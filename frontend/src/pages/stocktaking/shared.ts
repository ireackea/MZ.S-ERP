import type { Item } from '../../types';
import type { MonthlyAuditRow } from '../../services/monthlyStocktakingService';

export type ReportCardKey = 'concentrates' | 'rawMaterials' | 'bags' | 'bagThread' | 'cards';
export type StocktakingPrintTab = 'layout' | 'content' | 'branding';

export interface StocktakingPrintConfig {
  reportTitle: string;
  orientation: 'portrait' | 'landscape';
  paperSize: 'a4' | 'a3' | 'legal';
  margins: 'narrow' | 'normal' | 'wide';
  topPageMarginMm: number;
  bottomPageMarginMm: number;
  smartPaginationEnabled: boolean;
  pageFillPercent: number;
  pageSafetyRows: number;
  repeatHeaderEachPage: boolean;
  tableRowHeightMode: 'auto' | 'fixed';
  headerRowHeightPx: number;
  bodyRowHeightPx: number;
  rowVerticalPaddingPx: number;
  cellTextVerticalPosition: number;
  tableTitleLiftPx: number;
  columnSpacing: number;
  mergeColumns: boolean;
  mergeStrength: number;
  fontSize: number;
  printSignatureBoxHeight?: number;
  tableFontSize: number;
  showBorders: boolean;
  zebraStriping: boolean;
  colorHeaderRow: boolean;
  selectedCards: ReportCardKey[];
  showSignatures: boolean;
  watermarkText: string;
  showQrCode: boolean;
  reportUrl: string;
  generalNote: string;
}

export interface StocktakingPrintTemplate {
  id: string;
  name: string;
  config: StocktakingPrintConfig;
  updatedAt: number;
}

export interface AuditCategoryCard {
  key: ReportCardKey;
  title: string;
  accentClass: string;
  rows: MonthlyAuditRow[];
}

export interface PrintPageMetrics {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
}

export const REPORT_CARD_CONFIG: Array<Omit<AuditCategoryCard, 'rows'>> = [
  { key: 'concentrates', title: 'مركّزات', accentClass: 'border-blue-500' },
  { key: 'rawMaterials', title: 'مواد أولية', accentClass: 'border-emerald-500' },
  { key: 'bags', title: 'أكياس', accentClass: 'border-amber-500' },
  { key: 'bagThread', title: 'خيط الخياطة', accentClass: 'border-cyan-500' },
  { key: 'cards', title: 'كروت', accentClass: 'border-violet-500' },
];

export const STOCKTAKING_PRINT_DEFAULT_CONFIG: StocktakingPrintConfig = {
  reportTitle: 'تقرير الجرد الشهري',
  orientation: 'portrait',
  paperSize: 'a4',
  margins: 'normal',
  topPageMarginMm: 0,
  bottomPageMarginMm: 3,
  smartPaginationEnabled: true,
  pageFillPercent: 95,
  pageSafetyRows: 1,
  repeatHeaderEachPage: false,
  tableRowHeightMode: 'auto',
  headerRowHeightPx: 34,
  bodyRowHeightPx: 32,
  rowVerticalPaddingPx: 8,
  cellTextVerticalPosition: 50,
  tableTitleLiftPx: 0,
  columnSpacing: 12,
  mergeColumns: false,
  mergeStrength: 60,
  fontSize: 11,
  tableFontSize: 12,
  showBorders: true,
  zebraStriping: true,
  colorHeaderRow: true,
  selectedCards: REPORT_CARD_CONFIG.map((card) => card.key),
  showSignatures: true,
  watermarkText: '',
  showQrCode: false,
  reportUrl: typeof window !== 'undefined' ? window.location.href : '',
  generalNote: '',
  printSignatureBoxHeight: 96,
};

export const SIGNATURE_TITLES = ['أمين المستودع', 'مدير المستودع', 'مدير الإنتاج', 'مدير الإدارة', 'مدير الجودة', 'المدير العام / المفوض'];

export const buildNormalizedPrintConfig = (
  source: Partial<StocktakingPrintConfig> & { cellTextVerticalAlign?: 'top' | 'middle' | 'bottom' },
  fallback: StocktakingPrintConfig = STOCKTAKING_PRINT_DEFAULT_CONFIG,
): StocktakingPrintConfig => {
  const legacyVerticalAlign = source.cellTextVerticalAlign;
  const normalizedVerticalPosition = typeof source.cellTextVerticalPosition === 'number'
    ? Math.min(100, Math.max(0, source.cellTextVerticalPosition))
    : legacyVerticalAlign === 'top'
      ? 0
      : legacyVerticalAlign === 'bottom'
        ? 100
        : fallback.cellTextVerticalPosition;

  return {
    ...fallback,
    ...source,
    reportUrl: source.reportUrl || fallback.reportUrl,
    cellTextVerticalPosition: normalizedVerticalPosition,
    selectedCards: Array.isArray(source.selectedCards)
      ? source.selectedCards.filter((key): key is ReportCardKey => REPORT_CARD_CONFIG.some((card) => card.key === key))
      : fallback.selectedCards,
  };
};

export const normalizeStoredPrintTemplates = (templates: Array<Record<string, unknown>> | undefined): StocktakingPrintTemplate[] => {
  if (!Array.isArray(templates) || templates.length === 0) return [];

  return templates.reduce<StocktakingPrintTemplate[]>((acc, row) => {
    const normalized = buildNormalizedPrintConfig((row.config || {}) as Partial<StocktakingPrintConfig> & { cellTextVerticalAlign?: 'top' | 'middle' | 'bottom' });
    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name : '';
    if (!id || !name) return acc;

    acc.push({
      id,
      name,
      config: normalized,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    });
    return acc;
  }, []);
};

export const serializePrintConfig = (config: StocktakingPrintConfig) => JSON.stringify(config);
export const serializePrintTemplates = (templates: StocktakingPrintTemplate[]) => JSON.stringify(templates);

const normalizeText = (value: string | undefined) => String(value || '').trim().toLowerCase();

const getCardKeyForRow = (row: MonthlyAuditRow, categoryRaw: string | undefined): ReportCardKey | null => {
  const category = normalizeText(categoryRaw);
  const itemName = normalizeText(row.itemName);

  if (category === 'مركّزات' || category === 'مركزات') return 'concentrates';
  if (category === 'مواد أولية' || category === 'مواد خام' || category === 'خام') return 'rawMaterials';
  if (category === 'أكياس' || category === 'أجولة' || category === 'كيس') return 'bags';
  if (category === 'خيط خياة' || category === 'خيط الخياطة' || category === 'خيط خياطة') return 'bagThread';
  if (category === 'كروت بيانات' || category === 'كروت بلاستيك' || category === 'كروت' || category === 'كارت') return 'cards';

  if (category.includes('خيط') && category.includes('خياة')) return 'bagThread';

  if (category.includes('كروت') || category.includes('باق') || category.includes('كرت')) {
    if (itemName.includes('بلاستيك') || itemName.includes('بيانات')) return 'cards';
    return 'cards';
  }

  return null;
};

export const buildReportCards = (auditRows: MonthlyAuditRow[], itemById: Map<string, Item>): AuditCategoryCard[] => {
  const buckets: Record<ReportCardKey, MonthlyAuditRow[]> = {
    concentrates: [],
    rawMaterials: [],
    bags: [],
    bagThread: [],
    cards: [],
  };

  auditRows.forEach((row) => {
    const item = itemById.get(row.itemId);
    const cardKey = getCardKeyForRow(row, item?.category);
    if (!cardKey) return;
    buckets[cardKey].push(row);
  });

  return REPORT_CARD_CONFIG.map((config) => ({
    ...config,
    rows: buckets[config.key],
  }));
};

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

export const formatNumber = (value: number | undefined) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return numberFormatter.format(value);
};

export const getAuditEntryStatus = (actualCount: number | undefined, conflict: boolean) => {
  if (actualCount === undefined) {
    return {
      label: 'غير مجرود',
      className: 'bg-slate-100 text-slate-600',
    };
  }

  if (conflict) {
    return {
      label: 'متضارب',
      className: 'bg-red-100 text-red-700',
    };
  }

  return {
    label: 'معتمد',
    className: 'bg-emerald-100 text-emerald-700',
  };
};

const getPrintMarginInches = (printConfig: StocktakingPrintConfig) => {
  if (printConfig.margins === 'narrow') return 0.2;
  if (printConfig.margins === 'wide') return 0.6;
  return 0.35;
};

const getPaperSizeMm = (printConfig: StocktakingPrintConfig) => {
  switch (printConfig.paperSize) {
    case 'a3':
      return { width: 297, height: 420 };
    case 'legal':
      return { width: 216, height: 356 };
    case 'a4':
    default:
      return { width: 210, height: 297 };
  }
};

export const getPrintPageMetrics = (printConfig: StocktakingPrintConfig): PrintPageMetrics => {
  const paper = getPaperSizeMm(printConfig);
  const isLandscape = printConfig.orientation === 'landscape';
  const pageWidthMm = isLandscape ? paper.height : paper.width;
  const pageHeightMm = isLandscape ? paper.width : paper.height;
  const marginMm = getPrintMarginInches(printConfig) * 25.4;

  return {
    pageWidthMm,
    pageHeightMm,
    marginMm,
    contentWidthMm: Math.max(10, pageWidthMm - marginMm * 2),
    contentHeightMm: Math.max(10, pageHeightMm - marginMm * 2),
  };
};