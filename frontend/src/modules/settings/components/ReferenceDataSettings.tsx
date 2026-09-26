import React, { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Info, Package, Plus, Ruler, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { toast } from '@services/toastService';
import { exportSheetsToExcel, readWorkbookSheets, type ExcelPrimitive, type ExcelWorkbookSheet } from '../../../utils/excelWorkbook';
import { useInventoryStore } from '../../../store/useInventoryStore';
import type { UnloadingRuleDraft } from '../../../types';
import UnloadingRulesPanel from './UnloadingRulesPanel';

interface ReferenceDataSettingsProps {
}

type ImportSection = 'categories' | 'units' | 'unloadingRules';
type ExcelBusyAction = 'template' | 'export' | 'import' | null;
type ImportCounts = {
  created: number;
  skipped: number;
  failed: number;
};
type ImportIssue = {
  section: ImportSection;
  row: number;
  value: string;
  message: string;
  severity: 'skipped' | 'failed';
};
type ImportSummary = Record<ImportSection, ImportCounts> & {
  fileName: string;
  issues: ImportIssue[];
};
type ParsedExcelRow = {
  sheetName: string;
  rowNumber: number;
  headers: string[];
  cells: ExcelPrimitive[];
};

const SECTION_LABELS: Record<ImportSection, string> = {
  categories: 'الأقسام',
  units: 'وحدات القياس',
  unloadingRules: 'قواعد التفريغ',
};

const SHEET_MATCHERS: Record<ImportSection, string[]> = {
  categories: ['الأقسام', 'الاقسام', 'اقسام', 'categories', 'category'],
  units: ['وحدات القياس', 'الوحدات', 'units', 'unit'],
  unloadingRules: ['قواعد التفريغ', 'التفريغ', 'unloading rules', 'unloadingrules', 'rules'],
};

const CATEGORY_HEADERS = ['القسم', 'التصنيف', 'الفئة', 'category', 'categories', 'value', 'name'];
const UNIT_HEADERS = ['وحدة القياس', 'الوحدة', 'unit', 'units', 'value', 'name'];
const RULE_NAME_HEADERS = ['اسم القاعدة', 'قاعدة التفريغ', 'rule_name', 'rulename', 'name'];
const RULE_ALLOWED_HEADERS = ['مدة السماح بالدقائق', 'مدة السماح', 'allowed_duration_minutes', 'alloweddurationminutes', 'duration'];
const RULE_PENALTY_HEADERS = ['معدل الغرامة لكل دقيقة', 'معدل الغرامة', 'الغرامة', 'penalty_rate_per_minute', 'penaltyrateperminute', 'fine'];
const RULE_ACTIVE_HEADERS = ['نشطة', 'الحالة', 'is_active', 'isactive', 'active'];

const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeKey = (value: unknown) => normalize(value).toLowerCase();
const normalizeLookup = (value: unknown) => normalize(value)
  .replace(/[أإآ]/g, 'ا')
  .replace(/[ة]/g, 'ه')
  .replace(/[ى]/g, 'ي')
  .replace(/[\s_\-./\\]+/g, '')
  .toLowerCase();

const createCounts = (): ImportCounts => ({ created: 0, skipped: 0, failed: 0 });

const createImportSummary = (fileName: string): ImportSummary => ({
  fileName,
  categories: createCounts(),
  units: createCounts(),
  unloadingRules: createCounts(),
  issues: [],
});

const toWesternDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = toWesternDigits(normalize(value)).replace(/[،٫]/g, '.').replace(/,/g, '.');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value: unknown, fallback = true) => {
  const text = normalizeLookup(value);
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'نعم', 'نشطه', 'نشط', 'active', 'enabled', 'فعال', 'مفعل'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'لا', 'معطله', 'غيرنشطه', 'inactive', 'disabled', 'غيرفعال'].includes(text)) return false;
  return fallback;
};

const findSheet = (sheets: ExcelWorkbookSheet[], section: ImportSection) => {
  const matchers = SHEET_MATCHERS[section].map(normalizeLookup);
  return sheets.find((sheet) => {
    const sheetName = normalizeLookup(sheet.name);
    return matchers.some((matcher) => sheetName === matcher || sheetName.includes(matcher) || matcher.includes(sheetName));
  });
};

const sheetRows = (sheet: ExcelWorkbookSheet | undefined): ParsedExcelRow[] => {
  if (!sheet || sheet.rows.length < 2) return [];
  const headers = sheet.rows[0].map(normalizeLookup);
  return sheet.rows.slice(1).map((cells, index) => ({
    sheetName: sheet.name,
    rowNumber: index + 2,
    headers,
    cells,
  })).filter((row) => row.cells.some((cell) => normalize(cell)));
};

const readCell = (row: ParsedExcelRow, headerCandidates: string[], fallbackIndex: number) => {
  const candidateKeys = headerCandidates.map(normalizeLookup);
  const headerIndex = row.headers.findIndex((header) => candidateKeys.includes(header));
  if (headerIndex >= 0) {
    const value = row.cells[headerIndex];
    if (normalize(value)) return value;
  }
  return row.cells[fallbackIndex];
};

const duplicateError = (message: string) => /موجود|مكرر|duplicate|already/i.test(message);

const addIssue = (summary: ImportSummary, issue: ImportIssue) => {
  summary.issues.push(issue);
};

const importTotal = (summary: ImportSummary, field: keyof ImportCounts) => (
  summary.categories[field] + summary.units[field] + summary.unloadingRules[field]
);

const ReferenceDataSettings: React.FC<ReferenceDataSettingsProps> = ({ }) => {
  const { hasPermission } = usePermissions();
  const items = useInventoryStore((state) => state.items);
  const categories = useInventoryStore((state) => state.categories);
  const units = useInventoryStore((state) => state.units);
  const unloadingRules = useInventoryStore((state) => state.unloadingRules);
  const addCategory = useInventoryStore((state) => state.addCategory);
  const deleteCategory = useInventoryStore((state) => state.deleteCategory);
  const addUnit = useInventoryStore((state) => state.addUnit);
  const deleteUnit = useInventoryStore((state) => state.deleteUnit);
  const createUnloadingRule = useInventoryStore((state) => state.createUnloadingRule);

  const canView = hasPermission('settings.view.general');
  const canEdit = hasPermission('settings.update.system');
  const [newCategory, setNewCategory] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState<ExcelBusyAction>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const categoryInputRef = useRef<HTMLInputElement | null>(null);
  const unitInputRef = useRef<HTMLInputElement | null>(null);
  const excelFileInputRef = useRef<HTMLInputElement | null>(null);

  const categoryUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = normalizeKey(item.category);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [items]);

  const unitUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = normalizeKey(item.unit);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [items]);

  const sortedCategories = useMemo(() => [...categories].sort((left, right) => left.localeCompare(right, 'ar')), [categories]);
  const sortedUnits = useMemo(() => [...units].sort((left, right) => left.localeCompare(right, 'ar')), [units]);
  const isBusy = pendingAction !== null || excelBusy !== null;

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض الأقسام ووحدات القياس</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.general</code>.</div>
      </div>
    );
  }

  const handleAddCategory = async () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const value = normalize(newCategory);
    if (!value) {
      toast.error('أدخل اسم القسم أولاً.');
      return;
    }

    const exists = categories.some((entry) => normalizeKey(entry) === normalizeKey(value));
    if (exists) {
      toast.warning('هذا القسم موجود بالفعل.');
      return;
    }

    setPendingAction('category:add');
    try {
      await addCategory(value);
      setNewCategory('');
      toast.success('تمت إضافة القسم بنجاح.');
      window.requestAnimationFrame(() => {
        categoryInputRef.current?.focus();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ القسم.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleAddUnit = async () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const value = normalize(newUnit);
    if (!value) {
      toast.error('أدخل اسم وحدة القياس أولاً.');
      return;
    }

    const exists = units.some((entry) => normalizeKey(entry) === normalizeKey(value));
    if (exists) {
      toast.warning('وحدة القياس موجودة بالفعل.');
      return;
    }

    setPendingAction('unit:add');
    try {
      await addUnit(value);
      setNewUnit('');
      toast.success('تمت إضافة وحدة القياس بنجاح.');
      window.requestAnimationFrame(() => {
        unitInputRef.current?.focus();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ وحدة القياس.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleCategoryKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleAddCategory();
  };

  const handleUnitKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    handleAddUnit();
  };

  const handleDeleteCategory = async (category: string) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const count = categoryUsage.get(normalizeKey(category)) || 0;
    if (count > 0) {
      toast.error(`لا يمكن حذف قسم مستخدم في ${count} صنف.`);
      return;
    }

    if (!window.confirm(`هل تريد حذف القسم "${category}"؟`)) return;
    setPendingAction(`category:delete:${category}`);
    try {
      await deleteCategory(category);
      toast.success('تم حذف القسم بنجاح.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حذف القسم.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeleteUnit = async (unit: string) => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
      return;
    }

    const count = unitUsage.get(normalizeKey(unit)) || 0;
    if (count > 0) {
      toast.error(`لا يمكن حذف وحدة مستخدمة في ${count} صنف.`);
      return;
    }

    if (!window.confirm(`هل تريد حذف وحدة القياس "${unit}"؟`)) return;
    setPendingAction(`unit:delete:${unit}`);
    try {
      await deleteUnit(unit);
      toast.success('تم حذف وحدة القياس بنجاح.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حذف وحدة القياس.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleTemplateExport = async () => {
    setExcelBusy('template');
    try {
      await exportSheetsToExcel({
        fileName: 'settings-reference-data-template.xlsx',
        sheets: [
          { name: 'الأقسام', rows: [['القسم']], columns: [{ width: 28 }] },
          { name: 'وحدات القياس', rows: [['وحدة القياس']], columns: [{ width: 28 }] },
          {
            name: 'قواعد التفريغ',
            rows: [['اسم القاعدة', 'مدة السماح بالدقائق', 'معدل الغرامة لكل دقيقة', 'نشطة']],
            columns: [{ width: 28 }, { width: 22 }, { width: 24 }, { width: 14 }],
          },
        ],
      });
      toast.success('تم تجهيز قالب Excel.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تجهيز قالب Excel.');
    } finally {
      setExcelBusy(null);
    }
  };

  const handleExcelExport = async () => {
    setExcelBusy('export');
    try {
      await exportSheetsToExcel({
        fileName: `settings-reference-data-${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheets: [
          { name: 'الأقسام', rows: [['القسم'], ...sortedCategories.map((category) => [category])], columns: [{ width: 28 }] },
          { name: 'وحدات القياس', rows: [['وحدة القياس'], ...sortedUnits.map((unit) => [unit])], columns: [{ width: 28 }] },
          {
            name: 'قواعد التفريغ',
            rows: [
              ['اسم القاعدة', 'مدة السماح بالدقائق', 'معدل الغرامة لكل دقيقة', 'نشطة'],
              ...unloadingRules.map((rule) => [
                rule.rule_name || rule.name || '',
                Number(rule.allowed_duration_minutes ?? rule.durationMinutes ?? 0),
                Number(rule.penalty_rate_per_minute ?? rule.delayPenaltyPerMinute ?? 0),
                rule.is_active === false ? 'لا' : 'نعم',
              ]),
            ],
            columns: [{ width: 28 }, { width: 22 }, { width: 24 }, { width: 14 }],
          },
        ],
      });
      toast.success('تم تصدير إعدادات Excel.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تصدير Excel.');
    } finally {
      setExcelBusy(null);
    }
  };

  const handleImportClick = () => {
    if (!canEdit) {
      toast.error('لا تملك صلاحية استيراد إعدادات Excel.');
      return;
    }
    excelFileInputRef.current?.click();
  };

  const importCategories = async (summary: ImportSummary, rows: ParsedExcelRow[], categoryKeys: Set<string>) => {
    for (const row of rows) {
      const value = normalize(readCell(row, CATEGORY_HEADERS, 0));
      if (!value) {
        summary.categories.failed += 1;
        addIssue(summary, { section: 'categories', row: row.rowNumber, value: '', message: 'اسم القسم فارغ.', severity: 'failed' });
        continue;
      }

      const key = normalizeKey(value);
      if (categoryKeys.has(key)) {
        summary.categories.skipped += 1;
        addIssue(summary, { section: 'categories', row: row.rowNumber, value, message: 'قسم مكرر وتم تخطيه.', severity: 'skipped' });
        continue;
      }

      try {
        await addCategory(value);
        categoryKeys.add(key);
        summary.categories.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ القسم.';
        if (duplicateError(message)) {
          categoryKeys.add(key);
          summary.categories.skipped += 1;
          addIssue(summary, { section: 'categories', row: row.rowNumber, value, message: 'قسم مكرر وتم تخطيه.', severity: 'skipped' });
        } else {
          summary.categories.failed += 1;
          addIssue(summary, { section: 'categories', row: row.rowNumber, value, message, severity: 'failed' });
        }
      }
    }
  };

  const importUnits = async (summary: ImportSummary, rows: ParsedExcelRow[], unitKeys: Set<string>) => {
    for (const row of rows) {
      const value = normalize(readCell(row, UNIT_HEADERS, 0));
      if (!value) {
        summary.units.failed += 1;
        addIssue(summary, { section: 'units', row: row.rowNumber, value: '', message: 'اسم وحدة القياس فارغ.', severity: 'failed' });
        continue;
      }

      const key = normalizeKey(value);
      if (unitKeys.has(key)) {
        summary.units.skipped += 1;
        addIssue(summary, { section: 'units', row: row.rowNumber, value, message: 'وحدة قياس مكررة وتم تخطيها.', severity: 'skipped' });
        continue;
      }

      try {
        await addUnit(value);
        unitKeys.add(key);
        summary.units.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ وحدة القياس.';
        if (duplicateError(message)) {
          unitKeys.add(key);
          summary.units.skipped += 1;
          addIssue(summary, { section: 'units', row: row.rowNumber, value, message: 'وحدة قياس مكررة وتم تخطيها.', severity: 'skipped' });
        } else {
          summary.units.failed += 1;
          addIssue(summary, { section: 'units', row: row.rowNumber, value, message, severity: 'failed' });
        }
      }
    }
  };

  const importUnloadingRules = async (summary: ImportSummary, rows: ParsedExcelRow[], ruleKeys: Set<string>) => {
    for (const row of rows) {
      const ruleName = normalize(readCell(row, RULE_NAME_HEADERS, 0));
      const allowedDuration = parseNumber(readCell(row, RULE_ALLOWED_HEADERS, 1));
      const penaltyRate = parseNumber(readCell(row, RULE_PENALTY_HEADERS, 2));
      const isActive = parseBoolean(readCell(row, RULE_ACTIVE_HEADERS, 3), true);

      if (!ruleName) {
        summary.unloadingRules.failed += 1;
        addIssue(summary, { section: 'unloadingRules', row: row.rowNumber, value: '', message: 'اسم قاعدة التفريغ فارغ.', severity: 'failed' });
        continue;
      }

      const key = normalizeKey(ruleName);
      if (ruleKeys.has(key)) {
        summary.unloadingRules.skipped += 1;
        addIssue(summary, { section: 'unloadingRules', row: row.rowNumber, value: ruleName, message: 'قاعدة تفريغ مكررة وتم تخطيها.', severity: 'skipped' });
        continue;
      }

      if (allowedDuration == null || allowedDuration <= 0 || penaltyRate == null || penaltyRate < 0) {
        summary.unloadingRules.failed += 1;
        addIssue(summary, { section: 'unloadingRules', row: row.rowNumber, value: ruleName, message: 'مدة السماح أو معدل الغرامة غير صالح.', severity: 'failed' });
        continue;
      }

      const payload: UnloadingRuleDraft = {
        rule_name: ruleName,
        allowed_duration_minutes: Math.trunc(allowedDuration),
        penalty_rate_per_minute: penaltyRate,
        is_active: isActive,
      };

      try {
        await createUnloadingRule(payload);
        ruleKeys.add(key);
        summary.unloadingRules.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر حفظ قاعدة التفريغ.';
        if (duplicateError(message)) {
          ruleKeys.add(key);
          summary.unloadingRules.skipped += 1;
          addIssue(summary, { section: 'unloadingRules', row: row.rowNumber, value: ruleName, message: 'قاعدة تفريغ مكررة وتم تخطيها.', severity: 'skipped' });
        } else {
          summary.unloadingRules.failed += 1;
          addIssue(summary, { section: 'unloadingRules', row: row.rowNumber, value: ruleName, message, severity: 'failed' });
        }
      }
    }
  };

  const handleExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!canEdit) {
      toast.error('لا تملك صلاحية استيراد إعدادات Excel.');
      return;
    }

    setExcelBusy('import');
    try {
      const sheets = await readWorkbookSheets(file);
      const categoryRows = sheetRows(findSheet(sheets, 'categories'));
      const unitRows = sheetRows(findSheet(sheets, 'units'));
      const ruleRows = sheetRows(findSheet(sheets, 'unloadingRules'));

      if (categoryRows.length + unitRows.length + ruleRows.length === 0) {
        throw new Error('لم يتم العثور على بيانات قابلة للاستيراد في أوراق الأقسام أو وحدات القياس أو قواعد التفريغ.');
      }

      const summary = createImportSummary(file.name);
      const categoryKeys = new Set(categories.map(normalizeKey));
      const unitKeys = new Set(units.map(normalizeKey));
      const ruleKeys = new Set(unloadingRules.map((rule) => normalizeKey(rule.rule_name || rule.name || '')));

      await importCategories(summary, categoryRows, categoryKeys);
      await importUnits(summary, unitRows, unitKeys);
      await importUnloadingRules(summary, ruleRows, ruleKeys);

      setImportSummary(summary);
      const created = importTotal(summary, 'created');
      const skipped = importTotal(summary, 'skipped');
      const failed = importTotal(summary, 'failed');
      if (failed > 0) {
        toast.warning(`اكتمل الاستيراد مع ${failed} خطأ. تمت إضافة ${created} وتخطي ${skipped}.`);
      } else {
        toast.success(`تم الاستيراد: ${created} إضافة، ${skipped} مكرر متخطى.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة ملف Excel.');
    } finally {
      setExcelBusy(null);
    }
  };

  const summaryCards = importSummary ? ([
    { key: 'categories' as const, label: SECTION_LABELS.categories, counts: importSummary.categories },
    { key: 'units' as const, label: SECTION_LABELS.units, counts: importSummary.units },
    { key: 'unloadingRules' as const, label: SECTION_LABELS.unloadingRules, counts: importSummary.unloadingRules },
  ]) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <Package size={22} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">الأقسام ووحدات القياس وقواعد التفريغ</h2>
              <p className="mt-2 text-sm text-slate-500">مرجع موحد للقيم المستخدمة في شاشة الأصناف والعمليات والتقارير.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void handleTemplateExport(); }}
              disabled={excelBusy !== null}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-60"
            >
              <FileSpreadsheet size={16} /> {excelBusy === 'template' ? 'جار التجهيز' : 'قالب Excel'}
            </button>
            <button
              type="button"
              onClick={() => { void handleExcelExport(); }}
              disabled={excelBusy !== null}
              className="inline-flex items-center gap-2 rounded-2xl border border-blue-300 px-4 py-3 text-sm font-bold text-blue-700 disabled:opacity-60"
            >
              <Download size={16} /> {excelBusy === 'export' ? 'جار التصدير' : 'تصدير Excel'}
            </button>
            <button
              type="button"
              onClick={handleImportClick}
              disabled={!canEdit || isBusy}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <Upload size={16} /> {excelBusy === 'import' ? 'جار الاستيراد' : 'استيراد Excel'}
            </button>
            <input
              ref={excelFileInputRef}
              type="file"
              accept=".xlsx"
              onChange={(event) => { void handleExcelImport(event); }}
              className="hidden"
            />
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0" /><span>لا يمكن حذف أي قيمة مستخدمة فعليًا داخل الأصناف الحالية، حتى لا تتكسر المراجع المستخدمة في النظام.</span></div>
        </div>
      </div>

      {importSummary ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <FileSpreadsheet size={18} className="text-emerald-600" />
            <h3 className="text-lg font-black">تقرير استيراد Excel</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">{importSummary.fileName}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {summaryCards.map((card) => (
              <div key={card.key} className="rounded-2xl border border-slate-200 px-4 py-3">
                <div className="font-bold text-slate-900">{card.label}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-bold">
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-center text-emerald-700">{card.counts.created} مضاف</span>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-center text-amber-700">{card.counts.skipped} متخطى</span>
                  <span className="rounded-full bg-red-100 px-2 py-1 text-center text-red-700">{card.counts.failed} خطأ</span>
                </div>
              </div>
            ))}
          </div>
          {importSummary.issues.length > 0 ? (
            <div className="mt-4 space-y-2">
              {importSummary.issues.slice(0, 12).map((issue, index) => (
                <div key={`${issue.section}-${issue.row}-${index}`} className={`rounded-2xl border px-4 py-3 text-sm ${issue.severity === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  <span className="font-bold">{SECTION_LABELS[issue.section]} - صف {issue.row}</span>
                  {issue.value ? <span> - {issue.value}</span> : null}
                  <span> - {issue.message}</span>
                </div>
              ))}
              {importSummary.issues.length > 12 ? (
                <div className="text-sm text-slate-500">و {importSummary.issues.length - 12} نتيجة إضافية.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-900">
            <Package size={18} className="text-emerald-600" />
            <h3 className="text-lg font-black">الأقسام</h3>
          </div>
          <div className="mb-4 flex gap-2">
            <input
              ref={categoryInputRef}
              type="text"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={handleCategoryKeyDown}
              placeholder="أدخل اسم القسم"
              disabled={!canEdit || isBusy}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              disabled={!canEdit || isBusy}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <Plus size={16} /> {pendingAction === 'category:add' ? 'جار الحفظ' : 'إضافة'}
            </button>
          </div>
          <div className="space-y-3">
            {sortedCategories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">لا توجد أقسام مسجلة حاليًا.</div>
            ) : (
              sortedCategories.map((category) => {
                const usage = categoryUsage.get(normalizeKey(category)) || 0;
                return (
                  <div key={category} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-bold text-slate-800">{category}</div>
                      <div className="mt-1 text-xs text-slate-500">{usage > 0 ? `مستخدم في ${usage} صنف` : 'غير مستخدم حاليًا'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category)}
                      disabled={!canEdit || usage > 0 || isBusy}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={14} /> {pendingAction === `category:delete:${category}` ? 'جار الحذف' : 'حذف'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-900">
            <Ruler size={18} className="text-blue-600" />
            <h3 className="text-lg font-black">وحدات القياس</h3>
          </div>
          <div className="mb-4 flex gap-2">
            <input
              ref={unitInputRef}
              type="text"
              value={newUnit}
              onChange={(event) => setNewUnit(event.target.value)}
              onKeyDown={handleUnitKeyDown}
              placeholder="أدخل اسم وحدة القياس"
              disabled={!canEdit || isBusy}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddUnit}
              disabled={!canEdit || isBusy}
              className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              <Plus size={16} /> {pendingAction === 'unit:add' ? 'جار الحفظ' : 'إضافة'}
            </button>
          </div>
          <div className="space-y-3">
            {sortedUnits.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">لا توجد وحدات قياس مسجلة حاليًا.</div>
            ) : (
              sortedUnits.map((unit) => {
                const usage = unitUsage.get(normalizeKey(unit)) || 0;
                return (
                  <div key={unit} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                    <div>
                      <div className="font-bold text-slate-800">{unit}</div>
                      <div className="mt-1 text-xs text-slate-500">{usage > 0 ? `مستخدمة في ${usage} صنف` : 'غير مستخدمة حاليًا'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteUnit(unit)}
                      disabled={!canEdit || usage > 0 || isBusy}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={14} /> {pendingAction === `unit:delete:${unit}` ? 'جار الحذف' : 'حذف'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <UnloadingRulesPanel />
    </div>
  );
};

export default ReferenceDataSettings;