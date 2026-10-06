import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORY,
  ITEM_FIELD_LIMITS,
  ITEM_NUMERIC_MAX,
  describeOverlong,
  foldItemKey,
  normalizeItemRow,
  normalizeItemText,
  readItemNumber,
  startsWithFormulaPrefix,
} from './item-normalize';

/**
 * These are the rules four write paths used to carry their own version of, and they
 * had drifted apart: the import trimmed and formula-guarded and refused an inverted
 * limit pair, `create` did none of those, `update` compared only the limits that
 * happened to arrive in the payload, and `syncItems` checked nothing.
 *
 * They live in a pure function on purpose. The per-row rejection messages an
 * operator reads are built from these, and that has to be testable without a
 * database — which is the whole reason this file exists next to a service that has
 * no unit tests at all.
 */
const fieldsWith = (row: Record<string, unknown>) =>
  normalizeItemRow(row).issues.map((issue) => issue.field);

describe('readItemNumber', () => {
  it('distinguishes a blank cell from a value that is not a number', () => {
    // The distinction is the whole point. A blank takes the caller's default; a
    // percentage or a currency-formatted cell is an error the operator must see.
    expect(readItemNumber(null)).toEqual({ present: false });
    expect(readItemNumber(undefined)).toEqual({ present: false });
    expect(readItemNumber('')).toEqual({ present: false });
    expect(readItemNumber('   ')).toEqual({ present: false });
  });

  it('reads the digit shapes a spreadsheet actually produces', () => {
    expect(readItemNumber(25)).toEqual({ present: true, ok: true, value: 25 });
    expect(readItemNumber('25')).toEqual({ present: true, ok: true, value: 25 });
    expect(readItemNumber('1,250')).toEqual({ present: true, ok: true, value: 1250 });
    expect(readItemNumber('1 250')).toEqual({ present: true, ok: true, value: 1250 });
    // Arabic-Indic and Persian digits, because the file was typed in Arabic.
    expect(readItemNumber('٢٥')).toEqual({ present: true, ok: true, value: 25 });
    expect(readItemNumber('۲۵')).toEqual({ present: true, ok: true, value: 25 });
    // The Arabic decimal separator, and the thousands separator.
    expect(readItemNumber('12٫5')).toEqual({ present: true, ok: true, value: 12.5 });
    expect(readItemNumber('١٬٢٥٠')).toEqual({ present: true, ok: true, value: 1250 });
  });

  it('reads a percentage as a scale, not as a magnitude', () => {
    // 25% is 0.25. Importing it as 25 overstates every threshold in the file by a
    // factor of a hundred, and nothing in the report says so.
    expect(readItemNumber('25%')).toEqual({ present: true, ok: true, value: 0.25 });
    expect(readItemNumber('٢٥٪')).toEqual({ present: true, ok: true, value: 0.25 });
  });

  it('reads accounting negatives', () => {
    // (1,234.50) in a spreadsheet means -1234.5.
    expect(readItemNumber('(1,234.50)')).toEqual({ present: true, ok: true, value: -1234.5 });
  });

  it('refuses what it cannot read instead of guessing', () => {
    for (const raw of ['abc', '12abc', '2026-09-29', '١٢٣.meta', 'NaN', 'Infinity']) {
      const result = readItemNumber(raw);
      expect(result, `"${raw}" must not be silently coerced`).toMatchObject({ present: true, ok: false });
    }
  });
});

describe('foldItemKey', () => {
  it('produces the key the unique index is built on', () => {
    // Item_code_folded_key is on lower(btrim(...)). A comparison key that differed
    // from the index would let the pre-check disagree with the constraint.
    expect(foldItemKey('  ITEM-1 ')).toBe('item-1');
    expect(foldItemKey('Item-1')).toBe(foldItemKey('  item-1  '));
    expect(foldItemKey(null)).toBe('');
    expect(foldItemKey('AB')).not.toBe(foldItemKey('A B'));
  });
});

describe('normalizeItemText', () => {
  it('collapses whitespace, including the marks an Arabic spreadsheet inserts', () => {
    expect(normalizeItemText('  ذرة   صفراء  ')).toBe('ذرة صفراء');
    expect(normalizeItemText('a b')).toBe('a b');
  });

  it('returns an empty string for a missing value rather than the string "null"', () => {
    expect(normalizeItemText(null)).toBe('');
    expect(normalizeItemText(undefined)).toBe('');
  });
});

describe('startsWithFormulaPrefix', () => {
  it('covers every prefix a spreadsheet evaluates', () => {
    for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(startsWithFormulaPrefix(value), `"${value}" must be refused`).toBe(true);
    }
  });

  it('does not fire on ordinary values', () => {
    for (const value of ['ITEM-1', 'ذرة', '1.5', null, undefined]) {
      expect(startsWithFormulaPrefix(value), `"${value}" must be allowed`).toBe(false);
    }
  });

  it('refuses a bare hyphen, which is a deliberate false positive', () => {
    // Known and kept on purpose. Excel only evaluates a leading `+` or `-` as a
    // formula when the remainder parses as arithmetic, so a legitimate code like
    // `-STD` is refused for no benefit. Loosening the rule is a security decision
    // with a real trade-off on both sides, and it is not one to make while
    // consolidating four code paths. The conservative rule is the one the import
    // has always applied; loosening it belongs in its own change with its own
    // reasoning, and the audit records it as an open question.
    expect(startsWithFormulaPrefix('-')).toBe(true);
    expect(startsWithFormulaPrefix('-STD')).toBe(true);
  });
});

describe('normalizeItemRow', () => {
  const validRow = {
    name: 'ذرة صفراء',
    code: 'ITEM-1',
    barcode: '629000000001',
    category: 'مواد خام',
    unit: 'كيلو',
    minLimit: 10,
    maxLimit: 1000,
    orderLimit: 50,
    packageWeight: 1.5,
    description: 'Yellow Corn',
  };

  it('accepts a well-formed row and reports nothing', () => {
    const result = normalizeItemRow(validRow);
    expect(result.issues).toEqual([]);
    expect(result.row).toMatchObject({
      name: 'ذرة صفراء',
      code: 'ITEM-1',
      category: 'مواد خام',
      unit: 'كيلو',
      minLimit: 10,
      maxLimit: 1000,
      orderLimit: 50,
      // A fractional weight is legitimate. The item form offers it with
      // step="0.001", and `@IsInt()` in the DTO used to fail the whole import.
      packageWeight: 1.5,
    });
  });

  it('reports every problem with the row, not only the first', () => {
    // The import stopped at the first problem, so a row missing its unit and
    // carrying a negative limit produced one message; the operator fixed it, and
    // the second problem appeared on the next attempt.
    const result = normalizeItemRow(
      { name: '', category: '', unit: '', minLimit: -5, packageWeight: 'abc' },
      { requireCategory: true },
    );
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).toContain('name');
    expect(fields).toContain('category');
    expect(fields).toContain('unit');
    expect(fields).toContain('minLimit');
    expect(fields).toContain('packageWeight');
  });

  it('names each required field individually', () => {
    const messages = normalizeItemRow({ name: 'x', category: 'y', unit: 'z' }).issues;
    const missingUnit = normalizeItemRow({ name: 'x', category: 'y' }).issues;
    expect(missingUnit.some((issue) => issue.field === 'unit' && issue.message.includes('وحدة'))).toBe(true);
    expect(messages).toEqual([]);
  });

  it('refuses an inverted limit pair and does not compare against a default it cannot see', () => {
    // minLimit 5000 with no maxLimit used to be accepted by create, and produced
    // the exact pair the import rejects.
    const result = normalizeItemRow({ ...validRow, minLimit: 5000, maxLimit: undefined });
    expect(result.issues.map((issue) => issue.field)).toContain('minLimit');
  });

  it('treats a blank limit as the default and a bad one as an error', () => {
    expect(normalizeItemRow({ ...validRow, minLimit: undefined }).row.minLimit).toBe(0);
    expect(normalizeItemRow({ ...validRow, maxLimit: undefined }).row.maxLimit).toBe(1000);
    expect(normalizeItemRow({ ...validRow, maxLimit: 'غير رقم' }).issues.map((i) => i.field)).toContain('maxLimit');
  });

  it('refuses a value above the catalogue maximum', () => {
    const result = normalizeItemRow({ ...validRow, maxLimit: ITEM_NUMERIC_MAX + 1 });
    expect(result.issues.map((issue) => issue.field)).toContain('maxLimit');
  });

  it('flags overlong text and names the field and the limit', () => {
    const result = normalizeItemRow({ ...validRow, code: 'C'.repeat(ITEM_FIELD_LIMITS.code + 1) });
    expect(result.overlong).toContain('code');
    expect(describeOverlong('code')).toContain(String(ITEM_FIELD_LIMITS.code));
  });

  it('refuses a formula prefix in any text field', () => {
    const fields = ['name', 'code', 'barcode', 'category', 'unit', 'description'] as const;
    for (const field of fields) {
      const result = normalizeItemRow({ ...validRow, [field]: '=cmd|\'/C calc\'!A0' });
      expect(result.issues.map((issue) => issue.field), `${field} must be guarded`).toContain(field);
    }
  });

  it('falls back to the column default for a blank category', () => {
    // An empty string is a deliberate "use the default", the same thing create does.
    expect(normalizeItemRow({ ...validRow, category: '   ' }).row.category).toBe(DEFAULT_CATEGORY);
    expect(normalizeItemRow({ ...validRow, category: '   ' }).issues.map((i) => i.field)).not.toContain('category');
  });

  it('requires a category only when the caller asks for it', () => {
    // Two callers, two policies, one implementation. A hand-created item with no
    // category gets the default; a bulk import without one produces a catalogue
    // that every grouping in the product sorts by a single repeated value.
    expect(normalizeItemRow({ name: 'x', unit: 'kg' }).issues.map((i) => i.field)).not.toContain('category');
    expect(
      normalizeItemRow({ name: 'x', unit: 'kg' }, { requireCategory: true }).issues.map((i) => i.field),
    ).toContain('category');
  });

  it('exposes the folded keys the duplicate check needs', () => {
    const result = normalizeItemRow({ ...validRow, code: '  ITEM-1 ', barcode: ' ABC ' });
    expect(result.codeKey).toBe('item-1');
    expect(result.barcodeKey).toBe('abc');
  });

  it('survives a row that is missing entirely', () => {
    // The import validated a header, an operator hit send, and the payload was
    // `{}`. This must produce issues, not a crash.
    const result = normalizeItemRow(null);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.row.name).toBe('');
  });
});
