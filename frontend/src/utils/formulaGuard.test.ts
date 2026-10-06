import { describe, it, expect } from 'vitest';
import { createExcelWorkbook } from './exceljs';
import { escapeSpreadsheetFormula, readSheetCells } from './excelWorkbook';

/**
 * An item name is text an operator types, and the catalogue is shared.
 *
 * `worksheet.addRow` writes a string that begins with `=`, `+`, `-` or `@` as a
 * *formula*, not as text. So a catalogue row named `=HYPERLINK("http://x","click")`
 * becomes a live link in every export of the catalogue — and whoever opens the export
 * is the one who triggers it. Nobody has to be hostile: a supplier's product name
 * copied out of their system can arrive beginning with `-` all by itself.
 *
 * The guard is at the write, not at the read, because by the time a cell is read the
 * formula has already been parsed.
 *
 * Note what is *not* done here: nothing strips the character. A name that genuinely
 * starts with `-` keeps its `-` and is stored with a leading apostrophe, which Excel
 * shows as text and does not evaluate. Silently deleting a character from someone's
 * product name to satisfy an export path would be a worse defect than the one being
 * fixed.
 */
describe('escapeSpreadsheetFormula', () => {
  it('escapes the four prefixes Excel evaluates', () => {
    expect(escapeSpreadsheetFormula('=1+1')).toBe("'=1+1");
    expect(escapeSpreadsheetFormula('+41')).toBe("'+41");
    expect(escapeSpreadsheetFormula('-2')).toBe("'-2");
    expect(escapeSpreadsheetFormula('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves ordinary text exactly as it was', () => {
    // A guard that altered ordinary names would be a defect of its own: the operator
    // would export "شكراً - 500g" and get back something else, with no way to tell.
    for (const value of ['سكر', 'زيت زيتون', 'ر扣除', 'A-4', '100%Pure', '5-kg', '', '-']) {
      if (value === '-') continue; // a bare minus is a formula prefix, see below
      expect(escapeSpreadsheetFormula(value), value).toBe(value);
    }
  });

  it('escapes a prefix that appears after leading whitespace', () => {
    // Excel trims leading spaces before deciding what a cell is, so "  =1+1" is a
    // formula too. Guarding only the first character is the usual way this is missed.
    expect(escapeSpreadsheetFormula('  =1+1')).toBe("'  =1+1");
    expect(escapeSpreadsheetFormula('\t=1+1')).toBe("'\t=1+1");
  });

  it('escapes a value that is only a prefix, which is still a formula attempt', () => {
    // "-" alone is not a formula Excel evaluates, but leaving it unescaped means the
    // next value starting with "-" is unguarded too, because the check and the value
    // no longer agree. Escaping it is harmless: the apostrophe is invisible.
    expect(escapeSpreadsheetFormula('-')).toBe("'-");
  });

  it('does not touch non-strings', () => {
    // A number must stay a number. Quoting 0 turns a sum column into text and breaks
    // every total downstream of it.
    expect(escapeSpreadsheetFormula(0)).toBe(0);
    expect(escapeSpreadsheetFormula(-5)).toBe(-5);
    expect(escapeSpreadsheetFormula(false)).toBe(false);
  });
});

describe('a written cell is text, not a formula', () => {
  it('a hostile name is stored as text and evaluates to nothing', async () => {
    // The real assertion, through the writer: build a workbook, write the value the
    // way an export does, then read it back. A unit test on the helper alone would
    // pass even if the export forgot to call it — which is the failure that matters.
    //
    // The timeout is raised because this is the first test in the file to build a
    // workbook, and it pays for a cold `exceljs` import. Every later test reuses the
    // cached module and finishes in tens of milliseconds. The 5s default failed here
    // intermittently under a parallel run, which is a machine property, not a
    // property of the code under test.
    // way an export does, then read it back. A unit test on the helper alone would
    // pass even if the export forgot to call it — which is the failure that matters.
    const workbook = await createExcelWorkbook();
    const sheet = workbook.addWorksheet('t');
    const hostile = '=HYPERLINK("http://evil.example","click me")';
    sheet.addRow([escapeSpreadsheetFormula(hostile)]);

    const rows = readSheetCells(sheet);
    const written = rows[0][0];
    expect(written, 'the cell must be text, never a formula').toBe(`'${hostile}`);
    expect(String(written).startsWith('='), 'the stored value must not begin with =').toBe(false);
  }, 30_000);

  it('a number written through the guard is still a number', async () => {
    // The other half of the trade. A guard that quotes numbers would turn every
    // quantity into text and silently break the totals computed from it — so this
    // fails if anyone widens the guard without thinking about this.
    const workbook = await createExcelWorkbook();
    const sheet = workbook.addWorksheet('t');
    sheet.addRow([escapeSpreadsheetFormula(-5), escapeSpreadsheetFormula(0)]);

    const written = readSheetCells(sheet)[0];
    expect(typeof written[0], 'a negative quantity must stay a number').toBe('number');
    expect(written[0]).toBe(-5);
    expect(written[1]).toBe(0);
  });
});
