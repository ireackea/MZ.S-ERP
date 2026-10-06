/**
 * FC-ITEM-IMPORT — one place that knows what an item row may contain.
 *
 * Four write paths used to carry their own version of these rules, and they had
 * drifted: the Excel import trimmed and checked a formula prefix and refused an
 * inverted limit pair, `create` did not check the formula prefix, `update` checked
 * the limit pair against only the fields that happened to arrive in the payload,
 * and `syncItems` checked nothing at all. Two of the rules were also written twice
 * in the same file, which is how a length limit could exist for one path and be
 * missing from another.
 *
 * Everything here is a pure function over plain data. No Prisma, no Nest, no
 * clock. That is deliberate: these are the rules the import's per-row rejection
 * messages are built from, and they have to be testable without a database, which
 * is why `item.service.test.ts` does not exist and this file's sibling does.
 *
 * The database remains the authority. This layer exists so that an operator gets
 * told which row is wrong and why, before the write is attempted, instead of
 * discovering it as a batch rollback.
 */

/** Column lengths, in characters, as the catalogue presents them. */
export const ITEM_FIELD_LIMITS = {
  name: 120,
  code: 64,
  barcode: 64,
  category: 80,
  unit: 32,
  englishName: 1000,
  description: 1000,
} as const;

/** The largest value any numeric item field accepts, matching the DTO's bound. */
export const ITEM_NUMERIC_MAX = 999999999.999;

/**
 * The value a blank limit is stored as.
 *
 * Exported because the import, `create` and `syncItems` all fall back to it, and
 * a limit pair is only meaningful relative to both halves.
 */
export const DEFAULT_MIN_LIMIT = 0;
export const DEFAULT_MAX_LIMIT = 1000;

/** The column default, used when a category is supplied as an empty string. */
export const DEFAULT_CATEGORY = 'غير مصنف';

/**
 * Excel, Sheets and LibreOffice all evaluate a leading `=`, `+`, `-` or `@` in a
 * cell. An item name that starts with one is stored happily here and then becomes
 * a live formula in every export, report and barcode label that renders it.
 *
 * The import already refused these; the single-item routes did not, so a name typed
 * into the edit dialog was a way in.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export const startsWithFormulaPrefix = (value: unknown): boolean => {
  if (value == null) return false;
  return FORMULA_PREFIX.test(String(value).trimStart());
};

const ARABIC_INDIC = /[٠-٩۰-۹]/g;
// One character per digit, in order. An earlier version of this table repeated
// each digit, which made `indexOf` return 4 for "2" and turned ٢٥ into 49 — a
// number that is silently wrong rather than loudly rejected, which is the worst
// kind. A test now pins both digit shapes.
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const ARABIC_DECIMAL_SEPARATOR = '٫';
const ARABIC_THOUSANDS_SEPARATOR = '٬';
const PERCENT_SIGN = '٪';

/**
 * A cell that is blank, a cell that reads as a number, and a cell that does not.
 *
 * The explicit return type is load-bearing. Without it TypeScript widens the `ok`
 * literal to `boolean`, the union stops being a discriminated one, and every
 * `if (!read.ok)` downstream stops narrowing — which is how `read.raw` became a
 * type error three call sites later.
 */
export type ReadNumberResult =
  | { present: false }
  | { present: true; ok: true; value: number }
  | { present: true; ok: false; raw: string };

/**
 * Read a number out of a cell that may hold anything.
 *
 * `null` and an empty string mean "the operator left it blank", which is different
 * from "the operator typed something that is not a number". The first takes the
 * caller's default; the second is an error the operator has to see, because a
 * percentage, a currency-formatted value or a date silently becoming `0` is how a
 * minimum stock of 25 becomes 0 without a word in the report.
 *
 * The client's own parser shares these rules; see `import-fields.ts` on the
 * frontend, which is the same list expressed for the browser.
 */
export const readItemNumber = (value: unknown): ReadNumberResult => {
  if (value == null || value === '') return { present: false };
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { present: true, ok: true, value }
      : { present: true, ok: false, raw: String(value) };
  }

  const raw = String(value);
  let text = raw.replace(ARABIC_INDIC, (digit) => {
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    const persianIndex = PERSIAN_INDIC_DIGITS.indexOf(digit);
    return persianIndex >= 0 ? String(persianIndex) : digit;
  });
  text = text.trim();

  // Accounting negatives: (1,234.50) means -1234.5 in a spreadsheet.
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) {
    text = `-${parenthesised[1]}`;
  }

  text = text
    .replace(new RegExp(ARABIC_THOUSANDS_SEPARATOR, 'g'), '')
    .replace(new RegExp(ARABIC_DECIMAL_SEPARATOR, 'g'), '.')
    .replace(/[,\s]/g, '')
    .replace(new RegExp(PERCENT_SIGN, 'g'), '');

  // A percent is a scale, not a magnitude. 25% is 0.25, and importing it as 25
  // overstates every threshold in the file by a factor of a hundred.
  const isPercent = raw.includes(PERCENT_SIGN) || /%\s*$/.test(text);
  if (isPercent) {
    text = text.replace(/%\s*$/, '');
  }

  if (text === '' || text === '-') return { present: false };

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { present: true, ok: false, raw };
  return { present: true, ok: true, value: isPercent ? parsed / 100 : parsed };
};

/**
 * Fold a value for comparison: trim, collapse internal runs of whitespace, and
 * lowercase.
 *
 * The unique index is on `lower(btrim(...))` (migration 20260929050000), so this
 * must produce the same key. Whitespace inside a string is *not* collapsed for
 * storage — a code of `A B` is a different code from `AB` — only for comparison
 * purposes where the caller has already decided they mean the same thing.
 */
export const foldItemKey = (value: unknown): string => {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
};

export const normalizeItemText = (value: unknown): string => {
  if (value == null) return '';
  return String(value)
    .replace(/[ ‏‎‫‬]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export type NormalizedItemRow = {
  name: string;
  code: string | null;
  barcode: string | null;
  englishName: string | null;
  description: string | null;
  category: string;
  unit: string | null;
  minLimit: number;
  maxLimit: number;
  orderLimit: number | null;
  packageWeight: number | null;
};

export type ItemRowInput = Record<string, unknown> | null | undefined;

const optionalText = (value: unknown, limit: number): { value: string | null; tooLong: boolean } => {
  if (value == null) return { value: null, tooLong: false };
  const text = normalizeItemText(value);
  if (text === '') return { value: null, tooLong: false };
  return { value: text, tooLong: text.length > limit };
};

const boundedNumber = (
  value: unknown,
  fallback: number | null,
): { value: number | null; error: 'unreadable' | 'negative' | 'too-large' | null; raw: unknown } => {
  const read = readItemNumber(value);
  if (!read.present) return { value: fallback, error: null, raw: undefined };
  // Compared explicitly rather than as `!read.ok`. Both are the same test, but only
  // the explicit form narrows this union reliably, and the looser one left
  // `read.raw` a type error on the line below.
  if (read.ok === false) return { value: null, error: 'unreadable', raw: read.raw };
  // `raw` is the offending value the operator typed, and after the `!read.ok`
  // branch the read result no longer carries the original text — only the number it
  // parsed to. Reporting the number is also the more useful thing to put in the
  // message, so the two branches do not need the same shape.
  if (read.value < 0) return { value: null, error: 'negative', raw: read.value };
  if (read.value > ITEM_NUMERIC_MAX) return { value: null, error: 'too-large', raw: read.value };
  return { value: read.value, error: null, raw: undefined };
};

export type ItemValidationIssue = {
  field: string;
  message: string;
  value?: unknown;
};

export type NormalizeOptions = {
  /**
   * Require a category rather than falling back to the column default.
   *
   * The two callers genuinely differ, and the difference is real rather than
   * accidental. A single item created by hand with no category is a row the
   * operator will fill in; a fifteen-thousand-row import with no category produces
   * a catalogue that the status filter, the dashboard grouping and the stocktake
   * print all sort by a column holding one repeated default. So the import asks
   * for it and the single-item routes do not.
   *
   * Making this an option is the point of this file: two callers, one
   * implementation, and the difference written down where it can be argued about
   * instead of discovered as two code paths that disagree.
   */
  requireCategory?: boolean;
};

export type NormalizeResult = {
  row: NormalizedItemRow;
  issues: ItemValidationIssue[];
  /** Folded keys, for the duplicate checks that need the catalogue in front of them. */
  codeKey: string;
  barcodeKey: string;
  /** Field names whose stored length exceeds the catalogue's limit. */
  overlong: string[];
};

/**
 * Normalise one row and report everything wrong with it.
 *
 * Every problem is collected, not just the first. The import reported one error
 * per row and stopped, so a row missing both a unit and carrying a negative limit
 * produced a single message about the first one, the operator fixed it, and the
 * second problem appeared on the next attempt.
 */
export const normalizeItemRow = (
  input: ItemRowInput,
  options: NormalizeOptions = {},
): NormalizeResult => {
  const requireCategory = options.requireCategory === true;
  const raw = (input || {}) as Record<string, unknown>;
  const issues: ItemValidationIssue[] = [];
  const overlong: string[] = [];

  const name = normalizeItemText(raw.name);
  const code = optionalText(raw.code, ITEM_FIELD_LIMITS.code);
  const barcode = optionalText(raw.barcode, ITEM_FIELD_LIMITS.barcode);
  const categoryInput = optionalText(raw.category, ITEM_FIELD_LIMITS.category);
  const unit = optionalText(raw.unit, ITEM_FIELD_LIMITS.unit);
  const englishName = optionalText(raw.englishName, ITEM_FIELD_LIMITS.englishName);
  const description = optionalText(raw.description, ITEM_FIELD_LIMITS.description);

  if (code.tooLong) overlong.push('code');
  if (barcode.tooLong) overlong.push('barcode');
  if (categoryInput.tooLong) overlong.push('category');
  if (unit.tooLong) overlong.push('unit');
  if (englishName.tooLong) overlong.push('englishName');
  if (description.tooLong) overlong.push('description');

  const minLimit = boundedNumber(raw.minLimit, DEFAULT_MIN_LIMIT);
  const maxLimit = boundedNumber(raw.maxLimit, DEFAULT_MAX_LIMIT);
  const orderLimit = boundedNumber(raw.orderLimit, null);
  const packageWeight = boundedNumber(raw.packageWeight, null);

  const describeNumberError = (field: string, label: string, outcome: ReturnType<typeof boundedNumber>) => {
    if (outcome.error === 'unreadable') {
      issues.push({ field, message: `${label} غير صالح للقراءة: ${String(outcome.raw)}`, value: outcome.raw });
    } else if (outcome.error === 'negative') {
      issues.push({ field, message: `${label} لا يمكن أن يكون سالبًا.`, value: outcome.raw });
    } else if (outcome.error === 'too-large') {
      issues.push({ field, message: `${label} أكبر من الحد المسموح.`, value: outcome.raw });
    }
  };
  describeNumberError('minLimit', 'الحد الأدنى', minLimit);
  describeNumberError('maxLimit', 'الحد الأعلى', maxLimit);
  describeNumberError('orderLimit', 'حد إعادة الطلب', orderLimit);
  describeNumberError('packageWeight', 'وزن العبوة', packageWeight);

  // Required, and named individually. The import collapsed all three into one
  // sentence, so a row missing only its unit was indistinguishable from one
  // missing its name.
  if (!name) issues.push({ field: 'name', message: 'اسم الصنف مطلوب.' });
  const category = categoryInput.value || DEFAULT_CATEGORY;
  if (requireCategory && !categoryInput.value) {
    issues.push({ field: 'category', message: 'القسم مطلوب.' });
  }
  if (!unit.value) issues.push({ field: 'unit', message: 'وحدة القياس مطلوبة.' });

  if (minLimit.error === null && maxLimit.error === null) {
    const low = minLimit.value ?? DEFAULT_MIN_LIMIT;
    const high = maxLimit.value ?? DEFAULT_MAX_LIMIT;
    if (low > high) {
      issues.push({ field: 'minLimit', message: 'الحد الأدنى أكبر من الحد الأعلى.', value: low });
    }
  }

  // The formula guard, applied to every text field an operator can type. A tab or
  // carriage return is included because Excel treats a leading one the same way.
  const formulaCandidates: Array<[string, string | null, string]> = [
    ['name', name || null, 'اسم الصنف'],
    ['code', code.value, 'كود الصنف'],
    ['barcode', barcode.value, 'الباركود'],
    ['category', categoryInput.value, 'القسم'],
    ['unit', unit.value, 'وحدة القياس'],
    ['englishName', englishName.value, 'الاسم الإنجليزي'],
    ['description', description.value, 'الوصف'],
  ];
  for (const [field, value, label] of formulaCandidates) {
    if (startsWithFormulaPrefix(value)) {
      issues.push({
        field,
        message: `${label} يبدأ برمز صيغة Excel غير آمن.`,
        value,
      });
    }
  }

  return {
    row: {
      name,
      code: code.value,
      barcode: barcode.value,
      englishName: englishName.value,
      description: description.value,
      category,
      unit: unit.value,
      minLimit: minLimit.value ?? DEFAULT_MIN_LIMIT,
      maxLimit: maxLimit.value ?? DEFAULT_MAX_LIMIT,
      orderLimit: orderLimit.value,
      packageWeight: packageWeight.value,
    },
    issues,
    codeKey: foldItemKey(code.value),
    barcodeKey: foldItemKey(barcode.value),
    overlong,
  };
};

/** The length issue message, kept beside the limits that produced it. */
export const describeOverlong = (field: string): string => {
  const labels: Record<string, string> = {
    name: 'اسم الصنف',
    code: 'كود الصنف',
    barcode: 'الباركود',
    category: 'القسم',
    unit: 'وحدة القياس',
    englishName: 'الاسم الإنجليزي',
    description: 'الوصف',
  };
  const label = labels[field] || field;
  return `${label} أطول من الحد المسموح (${ITEM_FIELD_LIMITS[field as keyof typeof ITEM_FIELD_LIMITS] ?? '—'} حرفًا).`;
};
