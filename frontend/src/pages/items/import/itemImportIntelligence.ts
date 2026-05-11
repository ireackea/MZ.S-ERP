import type { ExcelImportRow, ExcelImportColumnMatch } from '@services/itemsService';
import type { Item } from '../../../types';

export type ImportDecision = 'create' | 'skip';
export type ImportRowStatus = 'ready' | 'warning' | 'error' | 'duplicate';
export type ImportIssueSeverity = 'error' | 'warning' | 'info';

export type ImportRowIssue = {
  severity: ImportIssueSeverity;
  field: keyof ExcelImportRow | 'row' | 'duplicate';
  message: string;
  value?: unknown;
};

export type ImportDuplicateMatch = {
  type: 'existing-code' | 'existing-barcode' | 'file-code' | 'file-barcode' | 'fuzzy-name';
  label: string;
  confidence: number;
  itemId?: string;
};

export type ImportPreviewRow = {
  id: string;
  sourceRow: number;
  row: ExcelImportRow;
  issues: ImportRowIssue[];
  duplicates: ImportDuplicateMatch[];
  status: ImportRowStatus;
  decision: ImportDecision;
  qualityScore: number;
};

export type ImportAnalysisSummary = {
  total: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  creatable: number;
  skipped: number;
  averageQuality: number;
  mappedColumns: number;
  lowConfidenceColumns: number;
};

export type ImportAnalysisResult = {
  rows: ImportPreviewRow[];
  summary: ImportAnalysisSummary;
};

const normalizeArabicDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const normalizeComparable = (value: unknown) => normalizeArabicDigits(String(value || ''))
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .toLowerCase();

const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

const hasFormulaPrefix = (value: unknown) => /^[=+\-@]/.test(String(value || '').trim());

const numberOrUndefined = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const scoreSimilarity = (left: string, right: string) => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.82;

  const leftTokens = new Set(left.match(/[\p{L}\p{N}]+/gu) || [left]);
  const rightTokens = new Set(right.match(/[\p{L}\p{N}]+/gu) || [right]);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return intersection / union;
};

const getQualityScore = (row: ExcelImportRow) => {
  const checks = [
    Boolean(String(row.name || '').trim()),
    Boolean(String(row.category || '').trim()),
    Boolean(String(row.unit || '').trim()),
    Boolean(String(row.code || '').trim()),
    Boolean(String(row.barcode || '').trim()),
    Boolean(String(row.description || row.englishName || '').trim()),
    numberOrUndefined(row.minLimit) != null,
    numberOrUndefined(row.maxLimit) != null,
    numberOrUndefined(row.currentStock) != null,
    row.packageWeight == null || Number(row.packageWeight) > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

const pushRangeIssue = (
  issues: ImportRowIssue[],
  field: keyof ExcelImportRow,
  label: string,
  value: unknown,
) => {
  const parsed = numberOrUndefined(value);
  if (parsed == null) return;
  if (parsed < 0) {
    issues.push({ severity: 'error', field, message: `${label} لا يمكن أن يكون سالباً.`, value });
  }
  if (parsed > 999999999.999) {
    issues.push({ severity: 'error', field, message: `${label} أكبر من الحد المسموح.`, value });
  }
};

export const analyzeItemImportRows = (params: {
  rows: ExcelImportRow[];
  existingItems: Item[];
  columnMatches?: ExcelImportColumnMatch[];
}): ImportAnalysisResult => {
  const codeCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  params.rows.forEach((row) => {
    const code = normalizeKey(row.code);
    const barcode = normalizeKey(row.barcode);
    if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    if (barcode) barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
  });

  const existingByCode = new Map<string, Item>();
  const existingByBarcode = new Map<string, Item>();
  params.existingItems.forEach((item) => {
    const code = normalizeKey(item.code);
    const barcode = normalizeKey(item.barcode);
    if (code) existingByCode.set(code, item);
    if (barcode) existingByBarcode.set(barcode, item);
  });

  const existingNameIndex = params.existingItems.map((item) => ({
    item,
    name: normalizeComparable(`${item.name} ${item.category || ''} ${item.unit || ''}`),
  }));

  const previewRows = params.rows.map<ImportPreviewRow>((row, index) => {
    const sourceRow = Number(row.sourceRow || index + 2);
    const issues: ImportRowIssue[] = [];
    const duplicates: ImportDuplicateMatch[] = [];
    const name = String(row.name || '').trim();
    const category = String(row.category || '').trim();
    const unit = String(row.unit || '').trim();
    const code = normalizeKey(row.code);
    const barcode = normalizeKey(row.barcode);

    if (!name) issues.push({ severity: 'error', field: 'name', message: 'اسم الصنف مطلوب.' });
    if (!category) issues.push({ severity: 'error', field: 'category', message: 'القسم مطلوب.' });
    if (!unit) issues.push({ severity: 'error', field: 'unit', message: 'وحدة القياس مطلوبة.' });

    (['name', 'code', 'barcode', 'category', 'unit', 'description', 'englishName'] as Array<keyof ExcelImportRow>).forEach((field) => {
      if (hasFormulaPrefix(row[field])) {
        issues.push({ severity: 'error', field, message: 'القيمة تبدأ برمز صيغة Excel وقد تكون غير آمنة عند التصدير.', value: row[field] });
      }
    });

    pushRangeIssue(issues, 'minLimit', 'الحد الأدنى', row.minLimit);
    pushRangeIssue(issues, 'maxLimit', 'الحد الأعلى', row.maxLimit);
    pushRangeIssue(issues, 'orderLimit', 'حد إعادة الطلب', row.orderLimit);
    pushRangeIssue(issues, 'packageWeight', 'وزن العبوة', row.packageWeight);
    pushRangeIssue(issues, 'currentStock', 'الرصيد الحالي', row.currentStock);

    const minLimit = numberOrUndefined(row.minLimit) ?? 0;
    const maxLimit = numberOrUndefined(row.maxLimit) ?? 1000;
    const orderLimit = numberOrUndefined(row.orderLimit);
    const currentStock = numberOrUndefined(row.currentStock) ?? 0;
    if (minLimit > maxLimit) {
      issues.push({ severity: 'error', field: 'minLimit', message: 'الحد الأدنى أكبر من الحد الأعلى.' });
    }
    if (orderLimit != null && maxLimit > 0 && orderLimit > maxLimit) {
      issues.push({ severity: 'warning', field: 'orderLimit', message: 'حد إعادة الطلب أعلى من الحد الأعلى.' });
    }
    if (maxLimit > 0 && currentStock > maxLimit * 2) {
      issues.push({ severity: 'warning', field: 'currentStock', message: 'الرصيد الحالي أعلى بكثير من الحد الأعلى.' });
    }
    if (!row.code) issues.push({ severity: 'warning', field: 'code', message: 'الصنف بلا كود، وسيصعب تتبعه لاحقاً.' });
    if (!row.barcode) issues.push({ severity: 'info', field: 'barcode', message: 'يمكن إضافة باركود لتحسين المسح السريع.' });
    if (!row.packageWeight || Number(row.packageWeight) <= 0) {
      issues.push({ severity: 'info', field: 'packageWeight', message: 'وزن العبوة غير محدد.' });
    }

    if (code && (codeCounts.get(code) || 0) > 1) {
      duplicates.push({ type: 'file-code', label: 'كود مكرر داخل الملف', confidence: 1 });
    }
    if (barcode && (barcodeCounts.get(barcode) || 0) > 1) {
      duplicates.push({ type: 'file-barcode', label: 'باركود مكرر داخل الملف', confidence: 1 });
    }
    const existingCode = code ? existingByCode.get(code) : undefined;
    if (existingCode) {
      duplicates.push({ type: 'existing-code', label: `الكود موجود في النظام: ${existingCode.name}`, confidence: 1, itemId: String(existingCode.id) });
    }
    const existingBarcode = barcode ? existingByBarcode.get(barcode) : undefined;
    if (existingBarcode) {
      duplicates.push({ type: 'existing-barcode', label: `الباركود موجود في النظام: ${existingBarcode.name}`, confidence: 1, itemId: String(existingBarcode.id) });
    }

    if (!existingCode && !existingBarcode && name) {
      const candidateName = normalizeComparable(`${name} ${category} ${unit}`);
      const fuzzy = existingNameIndex
        .map((entry) => ({ item: entry.item, confidence: scoreSimilarity(candidateName, entry.name) }))
        .sort((left, right) => right.confidence - left.confidence)[0];
      if (fuzzy && fuzzy.confidence >= 0.72) {
        duplicates.push({ type: 'fuzzy-name', label: `تشابه محتمل مع: ${fuzzy.item.name}`, confidence: fuzzy.confidence, itemId: String(fuzzy.item.id) });
        issues.push({ severity: 'warning', field: 'duplicate', message: 'يوجد صنف مشابه بالاسم أو القسم، راجع القرار قبل الاستيراد.' });
      }
    }

    const hasErrors = issues.some((issue) => issue.severity === 'error');
    const hasExactDuplicate = duplicates.some((duplicate) => duplicate.type !== 'fuzzy-name');
    const hasWarnings = issues.some((issue) => issue.severity === 'warning') || duplicates.length > 0;
    const status: ImportRowStatus = hasErrors
      ? 'error'
      : hasExactDuplicate
        ? 'duplicate'
        : hasWarnings
          ? 'warning'
          : 'ready';

    return {
      id: `${sourceRow}-${index}-${code || barcode || name || 'row'}`,
      sourceRow,
      row: { ...row, sourceRow },
      issues,
      duplicates,
      status,
      decision: status === 'error' || status === 'duplicate' ? 'skip' : 'create',
      qualityScore: getQualityScore(row),
    };
  });

  const mappedColumns = (params.columnMatches || []).filter((match) => match.header).length;
  const lowConfidenceColumns = (params.columnMatches || []).filter((match) => match.header && match.confidence < 0.75).length;
  const creatable = previewRows.filter((row) => row.decision === 'create').length;
  const averageQuality = previewRows.length
    ? Math.round(previewRows.reduce((sum, row) => sum + row.qualityScore, 0) / previewRows.length)
    : 0;

  return {
    rows: previewRows,
    summary: {
      total: previewRows.length,
      ready: previewRows.filter((row) => row.status === 'ready').length,
      warnings: previewRows.filter((row) => row.status === 'warning').length,
      errors: previewRows.filter((row) => row.status === 'error').length,
      duplicates: previewRows.filter((row) => row.status === 'duplicate').length,
      creatable,
      skipped: previewRows.length - creatable,
      averageQuality,
      mappedColumns,
      lowConfidenceColumns,
    },
  };
};

export const buildImportIssueExportRows = (rows: ImportPreviewRow[]) => rows.flatMap((entry) => {
  if (!entry.issues.length && !entry.duplicates.length) {
    return [{
      row: entry.sourceRow,
      status: entry.status,
      decision: entry.decision,
      name: entry.row.name || '',
      code: entry.row.code || '',
      barcode: entry.row.barcode || '',
      issue: '',
      severity: '',
    }];
  }

  return [
    ...entry.issues.map((issue) => ({
      row: entry.sourceRow,
      status: entry.status,
      decision: entry.decision,
      name: entry.row.name || '',
      code: entry.row.code || '',
      barcode: entry.row.barcode || '',
      issue: issue.message,
      severity: issue.severity,
    })),
    ...entry.duplicates.map((duplicate) => ({
      row: entry.sourceRow,
      status: entry.status,
      decision: entry.decision,
      name: entry.row.name || '',
      code: entry.row.code || '',
      barcode: entry.row.barcode || '',
      issue: duplicate.label,
      severity: duplicate.type,
    })),
  ];
});
