import { nonImportableFields } from './import-fields';
import type { ExcelImportRow, ExcelImportColumnMatch } from '@services/itemsService';
import type { Item } from '../../../types';

export type ImportDecision = 'create' | 'skip';
export type ImportRowStatus = 'ready' | 'warning' | 'error' | 'duplicate';
export type ImportIssueSeverity = 'error' | 'warning' | 'info';

export type ImportRowIssue = {
  severity: ImportIssueSeverity;
  /**
   * Which field the issue is about.
   *
   * `'server'` is not a column. It marks a message that came back from the import
   * endpoint after the operator pressed the button — the row passed every local rule
   * and the server still refused it, usually for a reason only the catalogue knows.
   * Without a name for that channel the studio could not tell the operator's own
   * pre-flight warnings apart from the authoritative answer, and would render the
   * second as if the first had been right all along.
   */
  field: keyof ExcelImportRow | 'row' | 'duplicate' | 'server';
  message: string;
  value?: unknown;
};

export type ImportDuplicateMatch = {
  type: 'existing-code' | 'existing-barcode' | 'file-code' | 'file-barcode' | 'fuzzy-name' | 'archived-match';
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

// FC-ITEM-IMPORT — one message, quoted from the field list that declares the field
// un-importable. It used to be a range warning about a value nobody was going to
// store, and a scored check that always passed.
const NON_IMPORTABLE_STOCK_MESSAGE =
  nonImportableFields().find((field) => field.field === 'currentStock')?.notImportableReason ??
  'الرصيد الحالي لا يقبله الاستيراد.';

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
  /**
   * How many catalogue items the duplicate check actually saw.
   *
   * The check is only as good as its input, so the input is reported rather than
   * assumed: a file analysed before the catalogue arrives is checked against nothing
   * and will confidently call duplicates "no match". The studio reads this to say so.
   */
  catalogueSize: number;
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
    // FC-ITEM-IMPORT — `currentStock` used to be one of the ten scored checks, and
    // the check was `!= null` on a value the parser had already defaulted to `0`.
    // So it always passed: the studio scored a row higher for carrying a stock
    // figure the payload then dropped on the floor. Rewarding a field the import
    // refuses teaches the operator to fill it in.
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

  // Indexed separately, like the server does.
  //
  // One index held both, so an archived item was reported to the operator as an
  // "existing code" conflict — the row came back marked as a duplicate against a
  // retired item, and since the studio's own list filters archived rows out by
  // default, there was nothing on screen to match it against. The operator's only
  // options were to skip a row that was actually fine, or to strip the code and
  // create a second item that the server would then refuse anyway.
  const existingByCode = new Map<string, Item>();
  const existingByBarcode = new Map<string, Item>();
  const archivedByCode = new Map<string, Item>();
  const archivedByBarcode = new Map<string, Item>();
  params.existingItems.forEach((item) => {
    const code = normalizeKey(item.code);
    const barcode = normalizeKey(item.barcode);
    if (item.isArchived) {
      if (code) archivedByCode.set(code, item);
      if (barcode) archivedByBarcode.set(barcode, item);
      return;
    }
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
    // No range check for `currentStock`: the import does not accept it, so a figure
    // in that column is not a value anybody is about to store. It is reported once,
    // as information, below.

    const minLimit = numberOrUndefined(row.minLimit) ?? 0;
    const maxLimit = numberOrUndefined(row.maxLimit) ?? 1000;
    const orderLimit = numberOrUndefined(row.orderLimit);
    if (minLimit > maxLimit) {
      issues.push({ severity: 'error', field: 'minLimit', message: 'الحد الأدنى أكبر من الحد الأعلى.' });
    }
    if (orderLimit != null && maxLimit > 0 && orderLimit > maxLimit) {
      issues.push({ severity: 'warning', field: 'orderLimit', message: 'حد إعادة الطلب أعلى من الحد الأعلى.' });
    }
    // FC-ITEM-IMPORT — said once, as information, and only when the operator
    // actually put something in the column. It used to be a range *warning* about a
    // value that was never going to be stored, and it was one of ten scored checks,
    // so a file could be brought to 100% quality by filling in a figure the import
    // would discard.
    if (numberOrUndefined(row.currentStock) != null) {
      issues.push({
        severity: 'info',
        field: 'currentStock',
        message: NON_IMPORTABLE_STOCK_MESSAGE,
      });
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

    // An archived match is a *choice*, not a conflict.
    //
    // The item is out of the catalogue by decision, so the row is not blocked — but the
    // operator has to be told, because the alternative is either reviving an item they
    // meant to retire or creating a second one that shares its code. The row is
    // pre-wired to revive, since the file they just chose is the most recent statement
    // of intent, and the decision dropdown still lets them skip it instead.
    const archivedCode = code ? archivedByCode.get(code) : undefined;
    const archivedBarcode = barcode ? archivedByBarcode.get(barcode) : undefined;
    const archivedMatch = archivedCode ?? archivedBarcode;
    if (!existingCode && !existingBarcode && archivedMatch) {
      duplicates.push({
        type: 'archived-match',
        label: `الكود/الباركود يخص صنفاً مؤرشفاً: ${archivedMatch.name} — سيُعاد تفعيله`,
        confidence: 1,
        itemId: String(archivedMatch.id),
      });
    }

    if (!existingCode && !existingBarcode && name) {
      const candidateName = normalizeComparable(`${name} ${category} ${unit}`);
      // Reduce, not map-then-sort.
      //
      // This used to build a scored array of the whole catalogue for every row and
      // sort it to read the first element — a full sort, per row, for one number. With
      // 400 imported rows against 900 catalogue items that is 400 sorts of 900
      // entries, hundreds of thousands of comparisons, on the main thread, between the
      // operator opening a file and being able to act on it. The sort bought nothing:
      // only the maximum is ever read, and `>` is a valid reduction over the same set
      // in one pass with no allocation.
      //
      // Ties keep the earlier catalogue entry, which is what the sort did too, so the
      // reported match is unchanged.
      let best: { item: Item; confidence: number } | null = null;
      for (const entry of existingNameIndex) {
        const confidence = scoreSimilarity(candidateName, entry.name);
        if (best === null || confidence > best.confidence) {
          best = { item: entry.item, confidence };
        }
      }
      if (best && best.confidence >= 0.72) {
        duplicates.push({ type: 'fuzzy-name', label: `تشابه محتمل مع: ${best.item.name}`, confidence: best.confidence, itemId: String(best.item.id) });
        issues.push({ severity: 'warning', field: 'duplicate', message: 'يوجد صنف مشابه بالاسم أو القسم، راجع القرار قبل الاستيراد.' });
      }
    }

    const hasErrors = issues.some((issue) => issue.severity === 'error');
    // `archived-match` is deliberately excluded from "exact duplicate". It *is* an
    // exact match, but it must not disable the row: an archived code that blocked the
    // import is the defect being fixed, and re-introducing the block on the client
    // would leave the server and the studio disagreeing about the same file.
    const hasExactDuplicate = duplicates.some(
      (duplicate) => duplicate.type !== 'fuzzy-name' && duplicate.type !== 'archived-match',
    );
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
      // The archived item's publicId travels with the row, which is what turns this
      // into a reactivate-on-import rather than a second item wearing the same code.
      row: {
        ...row,
        sourceRow,
        ...(archivedMatch ? { publicId: String(archivedMatch.publicId ?? '') } : {}),
      },
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
      /**
       * How many catalogue items the duplicate check actually saw.
       *
       * Reported rather than assumed, because the check is only as good as its input:
       * a file loaded before the archived list arrives is checked against a partial
       * catalogue and will confidently call items "no duplicate" that are. The studio
       * uses this to say so rather than to look broken.
       */
      catalogueSize: existingNameIndex.length,
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

/**
 * The outcome report: what the server did with each row, once it has answered.
 *
 * The review export answers "what did I decide before pressing the button". This one
 * answers "what happened", which is the question an operator actually has afterwards —
 * and after Wave 4 the studio stays open showing the refusals, so they are on screen
 * for exactly as long as it takes to realise that scrolling back through them and
 * writing them down by hand is the only way to fix the file.
 *
 * One row per refusal, not one per row, because a row with two refusals is two things
 * to fix. A row that landed contributes one line with its outcome and no message, so
 * the report is a complete account of the file rather than only its problems.
 *
 * The server's own message is written verbatim. Rewording it would make the report
 * disagree with the row the operator is looking at, and the two are read side by side.
 */
export const buildImportOutcomeExportRows = (
  rows: ImportPreviewRow[],
  outcome: { results: Array<{ row: number; name: string; status: string }>; errors: Array<{ row: number; field: string; message: string; error?: string }> },
) => {
  const landed = new Map(outcome.results.map((entry) => [entry.row, entry]));
  const serverErrors = new Map<number, Array<{ field: string; message: string }>>();
  for (const error of outcome.errors) {
    const list = serverErrors.get(error.row) ?? [];
    list.push({ field: error.field, message: error.error || error.message });
    serverErrors.set(error.row, list);
  }

  return rows.flatMap((entry) => {
    const errors = serverErrors.get(entry.sourceRow) ?? [];
    const common = {
      row: entry.sourceRow,
      name: entry.row.name || '',
      code: entry.row.code || '',
      barcode: entry.row.barcode || '',
    };

    if (errors.length > 0) {
      return errors.map((error) => ({
        ...common,
        outcome: 'مرفوض',
        field: error.field,
        message: error.message,
      }));
    }

    const result = landed.get(entry.sourceRow);
    if (!result) {
      return [{ ...common, outcome: 'لم يُنفَّذ', field: '', message: 'لم يذكره الخادم في النتيجة.' }];
    }
    return [{
      ...common,
      outcome: result.status === 'updated' ? 'محدَّث' : 'منشأ',
      field: '',
      message: '',
    }];
  });
};
