/**
 * FC-ITEM-IMPORT — one description of an importable item field.
 *
 * This list is the answer to a question the import studio kept getting wrong in
 * four different places, each with its own copy:
 *
 *   The download template listed `currentStock`, a column the server refuses —
 *   `forbidNonWhitelisted` rejects the whole request — so an operator filled in
 *   their stock figures, watched the preview go green, and every item landed at
 *   zero with no message. The column matcher gave `currentStock` nine aliases at
 *   99% confidence and counted it in the quality score, so the studio actively
 *   encouraged the mistake, and then rendered it permanently as a red
 *   "الرصيد الحالي — غير مطابق" because no file could ever satisfy it.
 *
 *   The catalogue export omitted `packageWeight` entirely, so export-then-import
 *   — the round trip a spreadsheet-shaped product invites — zeroed every package
 *   weight on the way back in.
 *
 *   `toImportPayload` folded `englishName` into `description` and dropped it,
 *   while `BulkImportItemDto` still declared the field and the service still had a
 *   fallback for it.
 *
 * Four copies of one list, and the copies disagreed. So there is one list now, and
 * the template, the alias table, the export and the studio's summary are all
 * projections of it. A field cannot appear in one and be missing from another
 * because there is nothing to keep in step.
 *
 * `importable: false` is a real answer, not a missing value. Stock is not
 * something an import may set — the ledger owns it — so it is declared here and
 * then deliberately excluded from the template, from the payload and from the
 * matcher's scoring, while still being *recognised* so a file containing it gets
 * "this column is not imported" instead of "this column is missing".
 */
import type { ExcelImportFieldKey, ExcelImportRowField } from '@services/itemsService';

export type ImportFieldKind = 'text' | 'number';

export type ImportFieldDefinition = {
  /**
   * The wider union, not the importable one.
   *
   * `currentStock` is in this list precisely so it can be declared as *not*
   * importable, with a reason. A type that made it unnameable would push that
   * explanation into a cast, and the one field the studio most needs to refuse out
   * loud is the one it could not mention.
   */
  field: ExcelImportRowField;
  /** The Arabic name shown in the studio and used in the template header. */
  label: string;
  kind: ImportFieldKind;
  /**
   * Whether `POST /items/import-excel` accepts this field.
   *
   * Stock is false, and the reason is the ledger: `Item.currentStock` is a derived
   * position maintained by movements and opening balances, and a bulk write to it
   * is a correctness hole that `stock-write-boundary.test.mjs` exists to keep shut.
   */
  importable: boolean;
  /** Why it is not importable, shown to the operator rather than left implied. */
  notImportableReason?: string;
  /** Header spellings, English and Arabic, matched exactly then fuzzily. */
  aliases: string[];
  /** The sample value written into the download template, when there is one. */
  template?: string | number;
  /**
   * Whether the catalogue export includes it.
   *
   * Separate from `importable` because the two answer different questions, and
   * conflating them is what dropped `packageWeight` from the export: it was
   * importable, and the export was written by hand from a different list.
   */
  exported: boolean;
};

export const IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    field: 'name',
    label: 'اسم الصنف',
    kind: 'text',
    importable: true,
    exported: true,
    // `الاسم` first, and deliberately: it is the plainest possible Arabic for "name"
    // and it was missing. Without it the header fell through to the *fuzzy* matcher,
    // where `الاسم الانجلي` (the `englishName` alias) is a close enough string that
    // the English-name column won it — so a file whose name column is labelled `الاسم`,
    // the obvious spelling, had every item's Arabic name written into `englishName`
    // while `name` stayed empty. The import reported success and produced a catalogue
    // of nameless items.
    //
    // The exact match in `resolveImportColumnMatches` beats any fuzzy one, so adding
    // the alias is what fixes it; the fuzzy path cannot be relied on to prefer the
    // shorter, more specific field.
    aliases: ['name', 'item name', 'itemname', 'product name', 'الاسم', 'اسم الصنف', 'الصنف', 'المادة', 'اسم المادة', 'اسم المنتج', 'الوصف العربي'],
    template: 'ذرة صفراء',
  },
  {
    field: 'code',
    label: 'كود الصنف',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['code', 'item code', 'itemcode', 'sku', 'كود', 'الكود', 'كود الصنف', 'رقم الصنف', 'رمز الصنف'],
    template: 'ITEM-001',
  },
  {
    field: 'barcode',
    label: 'الباركود',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['barcode', 'bar code', 'ean', 'upc', 'الباركود', 'باركود', 'رقم الباركود'],
    template: '629000000001',
  },
  {
    field: 'englishName',
    label: 'الاسم الإنجليزي',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['english name', 'englishname', 'english', 'description en', 'الاسم الانجليزي', 'الاسم الإنجليزي', 'الاسم الانجليزى'],
    template: 'Yellow Corn',
  },
  {
    field: 'description',
    label: 'الوصف',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['description', 'desc', 'notes', 'الوصف', 'ملاحظات', 'بيان'],
    template: 'حبوب ذرة صفراء',
  },
  {
    field: 'category',
    label: 'القسم',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['category', 'group', 'department', 'section', 'الفئة', 'التصنيف', 'القسم', 'المجموعة', 'البند'],
    template: 'مواد خام',
  },
  {
    field: 'unit',
    label: 'الوحدة',
    kind: 'text',
    importable: true,
    exported: true,
    aliases: ['unit', 'uom', 'unit of measure', 'الوحدة', 'وحدة', 'وحدة القياس'],
    template: 'كيلو',
  },
  {
    field: 'packageWeight',
    label: 'وزن العبوة',
    kind: 'number',
    importable: true,
    exported: true,
    aliases: ['package weight', 'packageweight', 'pack weight', 'weight', 'وزن العبوة', 'وزن العبوه', 'وزن', 'وزن الشكارة'],
    template: 0,
  },
  {
    field: 'minLimit',
    label: 'الحد الأدنى',
    kind: 'number',
    importable: true,
    exported: true,
    aliases: ['min limit', 'minlimit', 'minimum', 'min', 'الحد الأدنى', 'الحد الادنى', 'حد ادنى', 'حد أدنى'],
    template: 10,
  },
  {
    field: 'maxLimit',
    label: 'الحد الأعلى',
    kind: 'number',
    importable: true,
    exported: true,
    aliases: ['max limit', 'maxlimit', 'maximum', 'max', 'الحد الأعلى', 'الحد الاعلى', 'الحد الأقصى', 'الحد الاقصى'],
    template: 1000,
  },
  {
    field: 'orderLimit',
    label: 'حد إعادة الطلب',
    kind: 'number',
    importable: true,
    exported: true,
    aliases: ['order limit', 'orderlimit', 'reorder limit', 'reorder', 'حد الطلب', 'حد إعادة الطلب', 'حد اعادة الطلب'],
    template: 50,
  },
  {
    field: 'currentStock',
    label: 'الرصيد الحالي',
    kind: 'number',
    // Declared, recognised, and refused. The server has no such field and the
    // ValidationPipe's `forbidNonWhitelisted` turns the whole request into a 400,
    // so sending it was never an option — but the template asked for it, the
    // matcher gave it nine aliases at 99%, and the quality score rewarded filling
    // it in. The figures went nowhere.
    importable: false,
    notImportableReason:
      'الرصيد الحالي يحدّده سجل الحركات والرصيد الافتتاحي، ولا يقبله الاستيراد. حدّده من شاشة الجرد أو الرصيد الافتتاحي.',
    exported: true,
    aliases: ['current stock', 'currentstock', 'stock', 'quantity', 'qty', 'balance', 'الكمية', 'الكمية الحالية', 'الرصيد', 'الرصيد الحالي'],
  },
];

/**
 * The fields the import payload may carry. The single definition of that set.
 *
 * The predicate is typed rather than written as `filter(f => f.importable)`, because
 * a bare boolean filter leaves the element type wide: every consumer of this list
 * would still see `currentStock` in the union, and the one type that is supposed to
 * stop a caller building a payload with a balance would be decorative. Narrowing here
 * means the exclusion holds everywhere below this line without a single cast.
 */
export const IMPORTABLE_FIELDS = IMPORT_FIELDS.filter(
  (field): field is ImportFieldDefinition & { field: ExcelImportFieldKey; importable: true } =>
    field.importable,
);

/** Alias rows for the fuzzy matcher, derived from the list above. */
export const IMPORT_FIELD_ALIASES = IMPORTABLE_FIELDS.flatMap((definition) =>
  definition.aliases.map((alias) => ({
    field: definition.field,
    label: definition.label,
    alias,
  })),
);

/**
 * The download template, generated rather than written.
 *
 * Built from the same list the matcher uses, so a column can never be offered for
 * download and then be unusable — which is how the template came to contain a
 * `currentStock` column that the server refuses. The row is empty apart from
 * samples: an operator should be typing their own catalogue into it, and shipping a
 * pre-filled `ITEM-001` invites them to keep a code that is already taken.
 */
export const buildImportTemplateRow = (): Record<string, string | number> => {
  const row: Record<string, string | number> = {};
  for (const definition of IMPORTABLE_FIELDS) {
    if (definition.template === undefined) continue;
    row[definition.field] = definition.template;
  }
  return row;
};

/** The Arabic header row, for a template that documents itself. */
export const buildImportTemplateHeaders = (): string[] =>
  IMPORTABLE_FIELDS.filter((field) => field.template !== undefined).map((field) => field.label);

/** Fields an operator may mistake for the one they actually want. */
export const nonImportableFields = () => IMPORT_FIELDS.filter((field) => !field.importable);
