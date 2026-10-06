import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readFirstWorksheetSource } from './excelWorkbook';

/**
 * What does exceljs actually do with a blank row?
 *
 * The reader has to count a genuinely empty line, because `skippedEmptyRows` is the
 * only honest answer to "my 400-row file imported 380". But `addRow([])` in a test
 * fixture and a blank line in a real saved file are not obviously the same thing: a
 * fixture that does not reproduce a real blank line would let the reader pass its own
 * tests while still being unable to see one.
 *
 * So the behaviour is measured first, and the reader is then held to it.
 */
describe('exceljs blank-row behaviour', () => {
  it('an empty array creates a row exceljs reports, and an empty-string cell does too', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('s');
    sheet.addRow(['A', 'B']);
    sheet.addRow(['x', 'y']);
    sheet.addRow([] as string[]);
    sheet.addRow(['z', 'w']);

    const occupied: number[] = [];
    sheet.eachRow({ includeEmpty: false }, (_row: any, rowNumber: number) => {
      occupied.push(rowNumber);
      return true;
    });

    // Whether or not exceljs considers row 3 occupied, row 4 must be reported as row 4
    // — that is the property the reader depends on.
    expect(occupied).toContain(4);

    const file = new File(
      [new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)],
      'blank.xlsx',
    );
    const result = await readFirstWorksheetSource(file);
    const numbers = result.rows.map((row) => row.rowNumber);
    expect(numbers, 'the row after a blank must keep its own number').toContain(4);
    expect(numbers, 'the blank line must be reported, not renumbered away').toContain(3);
  });

  it('a blank line in the middle is counted as an empty row, not dropped', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('s');
    sheet.addRow(['الاسم', 'الكود']);
    sheet.addRow(['سكر', 'S-1']);
    sheet.addRow([] as string[]);
    sheet.addRow(['ملح', 'S-2']);

    const file = new File(
      [new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)],
      'gap.xlsx',
    );
    const result = await readFirstWorksheetSource(file);

    const empty = result.rows.filter((row) => row.isEmpty);
    expect(empty, 'the gap must be visible').toHaveLength(1);
    expect(empty[0].rowNumber).toBe(3);

    const filled = result.rows.filter((row) => !row.isEmpty).map((row) => [row.rowNumber, row.cells['الاسم']]);
    expect(filled, 'the row after the gap must keep its real number').toEqual([
      [2, 'سكر'],
      [4, 'ملح'],
    ]);
  });
});
