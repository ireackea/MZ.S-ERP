import { describe, expect, it } from 'vitest';
import {
  IMPORTABLE_FIELDS,
  IMPORT_FIELDS,
  buildImportTemplateRow,
  nonImportableFields,
} from './import-fields';
import { EXCEL_TEMPLATE_ROWS } from '../shared';

/**
 * The import offered the operator a column the server refuses, scored a row higher
 * for filling it in, then rendered it permanently in red as "missing".
 *
 * `currentStock` was in the download template. The server has no such field and
 * `forbidNonWhitelisted` turns the whole request into a 400, so an operator who
 * filled in their stock figures got a green preview and every item landed at zero.
 * The alias table gave that field nine spellings at 99% confidence, the quality
 * score counted it as one of ten passing checks, and the sidebar showed it as a
 * red "غير مطابق" for as long as the studio was open — because no file could ever
 * satisfy it.
 *
 * The export went the other way: it had no `packageWeight` column at all, so the
 * export-then-import round trip a spreadsheet-shaped product invites zeroed every
 * package weight on the way back in.
 *
 * Four hand-written lists that disagreed. This file pins the one list they are now
 * projections of.
 */
describe('the single import field list', () => {
  it('declares currentStock as real but not importable, and says why', () => {
    const stock = IMPORT_FIELDS.find((field) => field.field === 'currentStock');
    expect(stock, 'the field must be declared, not merely deleted').toBeDefined();
    expect(stock?.importable, 'the import must not accept it. The ledger owns stock.').toBe(false);
    expect(
      stock?.notImportableReason,
      'a field the operator will meet in their file must carry the reason it is refused.',
    ).toMatch(/الرصيد|الحركات/);
    expect(IMPORTABLE_FIELDS.map((field) => field.field)).not.toContain('currentStock');
  });

  it('keeps the fields the server does accept', () => {
    const accepted = IMPORTABLE_FIELDS.map((field) => field.field);
    for (const field of ['name', 'code', 'barcode', 'category', 'unit', 'packageWeight', 'description']) {
      expect(accepted, `${field} is in BulkImportItemDto and must stay importable`).toContain(field);
    }
  });

  it('omits the stock column from the download template', () => {
    const row = buildImportTemplateRow();
    expect(row, 'the template must not offer a column the payload cannot carry').not.toHaveProperty('currentStock');
    for (const definition of IMPORTABLE_FIELDS) {
      if (definition.template === undefined) continue;
      expect(row, `${definition.field} is importable so the template must offer it`).toHaveProperty(definition.field);
    }
  });

  it('keeps packageWeight in the export, which is how it was lost before', () => {
    const weight = IMPORT_FIELDS.find((field) => field.field === 'packageWeight');
    expect(weight?.exported, 'an importable field must survive the round trip').toBe(true);
  });

  it('gives every field a label and at least two header spellings', () => {
    for (const field of IMPORT_FIELDS) {
      expect(field.label, `${field.field} needs a label`).toBeTruthy();
      expect(
        field.aliases.length,
        `${field.field} needs at least one English and one Arabic spelling or a header matcher will miss it`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('never repeats a field', () => {
    const keys = IMPORT_FIELDS.map((field) => field.field);
    expect(new Set(keys).size, 'a repeated field makes the matcher and the payload ambiguous').toBe(keys.length);
  });

  it('reports the refused fields for the studio to explain', () => {
    const refused = nonImportableFields();
    expect(refused.length).toBeGreaterThan(0);
    for (const field of refused) {
      expect(field.notImportableReason, `${field.field} must explain itself`).toBeTruthy();
    }
  });
});

describe('the exported template row', () => {
  it('is the generated one, not a hand-written literal', () => {
    // This is the assertion that would have caught the original defect: the template
    // was a separate object that nobody re-checked against the payload.
    expect(EXCEL_TEMPLATE_ROWS).toHaveLength(1);
    expect(EXCEL_TEMPLATE_ROWS[0]).toEqual(buildImportTemplateRow());
    expect(EXCEL_TEMPLATE_ROWS[0]).not.toHaveProperty('currentStock');
  });

  it('sends an operator a template with no stock column, which is the whole fix', () => {
    // Before: the template asked for a column whose only possible outcome was a 400
    // or a silent zero. Now it asks for columns the server will accept.
    const keys = Object.keys(EXCEL_TEMPLATE_ROWS[0]);
    expect(keys).toContain('code');
    expect(keys).toContain('name');
    expect(keys).toContain('packageWeight');
    expect(keys).not.toContain('currentStock');
  });
});
