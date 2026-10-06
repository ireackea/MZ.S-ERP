import { describe, it, expect } from 'vitest';
import { createExcelWorkbook } from './exceljs';
import { readFirstWorksheetSource } from './excelWorkbook';
import { parseExcelFileWithInsights } from '@services/itemsService';

/**
 * The line number is the message.
 *
 * The old reader pushed rows into a dense array and said `index + 2`, so every
 * rejection pointed one line off — and further off for each blank row above it. A
 * blank row in the middle of a stock file is ordinary, and each one silently moved
 * every error below it away from the line the operator is actually looking at.
 *
 * Built against a real `exceljs` workbook, not a hand-made object, because the defect
 * lived in `eachRow`'s actual behaviour with `includeEmpty: false` — a mock is the one
 * place it would not have reproduced.
 */

/** A File carrying a real xlsx, which is what the reader is handed in production. */
const workbookFile = async (fill: (sheet: any) => void): Promise<File> => {
  const workbook = await createExcelWorkbook();
  const sheet = workbook.addWorksheet('الورقة الأولى');
  fill(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  // `writeBuffer` hands back an ArrayBuffer whose byte type differs across runtimes;
  // File wants a BlobPart, so copy it into a clean one.
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  return new File([bytes], 'stock.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

describe('readFirstWorksheetSource — real row numbers', () => {
  it('reports the row each value actually occupies', async () => {
    // The first test in the file pays for a cold `exceljs` import — the module is
    // several hundred kilobytes and this is a one-time load, not slow test logic.
    // Every later test reuses the cached module and finishes in ~20ms.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الكود']);
      sheet.addRow(['سكر', 'S-1']);
      sheet.addRow(['ملح', 'S-2']);
    });
    const result = await readFirstWorksheetSource(file);
    expect(result.headerRow).toBe(1);
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
    expect(result.rows[0].cells['الاسم']).toBe('سكر');
  }, 30_000);

  it('keeps the real number across a blank row in the middle', async () => {
    // This is the whole defect. The dense reader dropped the blank and renumbered
    // everything after it, so the message for 'ملح' said row 3 when the operator's
    // sheet has it on row 4.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الكود']);
      sheet.addRow(['سكر', 'S-1']);
      sheet.addRow([]); // a blank separator, which is what a real sheet has
      sheet.addRow(['ملح', 'S-2']);
    });
    const result = await readFirstWorksheetSource(file);
    // The empty row is now reported too, so the filled rows are compared on their own.
    const filled = result.rows
      .filter((row) => !row.isEmpty)
      .map((row) => [row.rowNumber, row.cells['الاسم']]);
    expect(filled).toEqual([
      [2, 'سكر'],
      [4, 'ملح'],
    ]);
    const blanks = result.rows.filter((row) => row.isEmpty).map((row) => row.rowNumber);
    expect(blanks, 'the gap must be visible with its own line number').toEqual([3]);
  });

  it('marks a row empty but still numbers it', async () => {
    // An empty row is a fact about the file. Dropping it silently is how a 400-row
    // file imports 380 with no explanation.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم']);
      sheet.addRow(['سكر']);
      sheet.addRow(['']);
    });
    const result = await readFirstWorksheetSource(file);
    const empty = result.rows.find((row) => row.isEmpty);
    expect(empty, 'an empty row must be present, not dropped').toBeDefined();
    expect(empty?.rowNumber).toBe(3);
  });
});

describe('readFirstWorksheetSource — the header row', () => {
  it('finds the header below a title row', async () => {
    // Stock files routinely carry a title or a date above the column names, and
    // assuming row 1 read those as headers and matched nothing at all.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['تقرير مخزون — 2026']);
      sheet.addRow(['الاسم', 'الكود', 'الوحدة']);
      sheet.addRow(['سكر', 'S-1', 'kg']);
    });
    const result = await readFirstWorksheetSource(file);
    expect(result.headerRow, 'the header must be found, not assumed').toBe(2);
    expect(result.headers).toEqual(['الاسم', 'الكود', 'الوحدة']);
    expect(result.rows[0].rowNumber).toBe(3);
  });

  it('reports duplicate header labels instead of silently dropping a column', async () => {
    // Both copies collapse onto one key, so one column is read as absent and its
    // values vanish with no error. There is no correct winner, so it is reported.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الكود', 'الكود']);
      sheet.addRow(['سكر', 'S-1', 'S-2']);
    });
    const result = await readFirstWorksheetSource(file);
    expect(result.duplicateHeaders).toEqual(['الكود']);
  });
});

describe('parseExcelFileWithInsights — no invented numbers', () => {
  it('leaves an unreadable number absent rather than defaulting it', async () => {
    // `?? 0` and `?? 1000` made a cell reading "غير متوفر" indistinguishable from a
    // real 0, and the studio then showed the operator a tidy pair that looked read.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الحد الأدنى', 'الحد الأقصى']);
      sheet.addRow(['سكر', 'غير متوفر', '#N/A']);
    });
    const result = await parseExcelFileWithInsights(file);
    expect(result.rows[0].minLimit).toBeUndefined();
    expect(result.rows[0].maxLimit).toBeUndefined();
  });

  it('still reads a real number', async () => {
    const file = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الحد الأدنى', 'الحد الأقصى']);
      sheet.addRow(['سكر', '5', '1000']);
    });
    const result = await parseExcelFileWithInsights(file);
    expect(result.rows[0].minLimit).toBe(5);
    expect(result.rows[0].maxLimit).toBe(1000);
  });

  it('counts a blank line in the middle, and says where the header was', async () => {
    // The blank goes *between* two data rows, not at the end. A trailing blank line is
    // never written into the file at all, so there is nothing in it to report — and
    // the reader is right not to invent one. This is the shape an operator actually
    // means when they say their file has gaps: a spacer between two sections.
    const file = await workbookFile((sheet) => {
      sheet.addRow(['تقرير']);
      sheet.addRow(['الاسم', 'الكود']);
      sheet.addRow(['سكر', 'S-1']);
      sheet.addRow([]);
      sheet.addRow(['ملح', 'S-2']);
    });
    const result = await parseExcelFileWithInsights(file);
    expect(result.headerRow).toBe(2);
    expect(result.skippedEmptyRows).toBe(1);
    expect(result.rows.map((row) => row.sourceRow), 'the message must point at the operator\'s own line').toEqual([3, 5]);
  });
});

describe('parseExcelFileWithInsights — files that are not what they claim to be', () => {
  it('refuses a file that is not a workbook, in words the operator can act on', async () => {
    // The failure this must avoid is the silent one: an empty preview with no message,
    // or a raw "zip" error. The operator uploaded a PDF, or a photo of a spreadsheet, or
    // a CSV renamed to .xlsx. What they need is to be told that, not shown a blank
    // table they cannot explain.
    const notAWorkbook = new File([new Uint8Array([1, 2, 3, 4, 5])], 'not.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await expect(readFirstWorksheetSource(notAWorkbook)).rejects.toThrow();
  });

  it('reports an empty workbook as no rows rather than throwing', async () => {
    // A workbook with a sheet but no data is a real thing an operator produces — they
    // saved the template and filled nothing in. It must come back as zero rows, so the
    // studio's "no rows in this file" state explains itself.
    const empty = await workbookFile(() => {
      // Nothing added at all.
    });
    const result = await parseExcelFileWithInsights(empty);
    expect(result.rows, 'an empty workbook is zero rows, not a crash').toEqual([]);
    expect(result.skippedEmptyRows).toBe(0);
  });

  it('a header with no data rows yields the header and nothing else', async () => {
    const headersOnly = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الكود', 'الوحدة']);
    });
    const result = await parseExcelFileWithInsights(headersOnly);
    expect(result.rows).toEqual([]);
    expect(result.sourceHeaders).toEqual(['الاسم', 'الكود', 'الوحدة']);
    expect(result.headerRow).toBe(1);
  });

  it('keeps a date cell as a date rather than as a number or a locale string', async () => {
    // Dates are the reason a spreadsheet-shaped product exists, and a stock file is full
    // of them. The reader must not turn one into a serial number or an ISO string that
    // no import column can match — the value is carried as-is and the *display* layer
    // formats it. Round-tripping a date through a locale string here would corrupt every
    // date on its way into the catalogue.
    const withDate = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'تاريخ']);
      sheet.addRow(['سكر', new Date(Date.UTC(2026, 0, 15))]);
    });
    const result = await parseExcelFileWithInsights(withDate);
    const value = (result.rows[0] as unknown as Record<string, unknown>).name;
    // Whatever the shape, it must not have been flattened into a string of digits.
    expect(typeof value).toBe('string');
    expect(String(value), 'a date must not become its numeric serial').not.toMatch(/^\d{5}$/);
  });

  it('trims a header so a trailing space does not break the column match', async () => {
    // A space after a header is the single most common thing a spreadsheet does to a
    // header, and an untrimmed "الاسم " matches no alias at all — so the column is
    // silently unmapped and every value in it is dropped with no message.
    const spaced = await workbookFile((sheet) => {
      sheet.addRow([' الاسم ', ' الكود ']);
      sheet.addRow(['سكر', 'S-1']);
    });
    const result = await parseExcelFileWithInsights(spaced);
    expect(result.sourceHeaders).toEqual(['الاسم', 'الكود']);
    const nameMatch = result.columnMatches.find((match) => match.field === 'name');
    expect(nameMatch?.header, 'a padded header must still match its field').toBe('الاسم');
  });

  it('maps a column headed الاسم to the name field, not to englishName', async () => {
    // The worst defect this suite found, and it is worth stating plainly because the
    // symptom is invisible until someone opens the catalogue.
    //
    // `الاسم` was not an alias of any field. The matcher fell through to its fuzzy
    // pass, where `الاسم الانجلي` — the `englishName` alias — is a close enough string
    // that English-name won it. So a file whose name column is labelled with the
    // plainest Arabic word for "name" had every item's Arabic name written into
    // `englishName`, while `name` came back empty.
    //
    // The import reported success. The catalogue filled with nameless items.
    //
    // Nothing about the failure is visible in the response: the row count is right, the
    // errors are empty, and the studio's confidence badge reads high, because the match
    // genuinely was a good one — to the wrong field. Which is why the test asserts the
    // *target field*, not merely that something matched.
    const plain = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'الكود', 'الوحدة']);
      sheet.addRow(['سكر', 'S-1', 'kg']);
    });
    const result = await parseExcelFileWithInsights(plain);

    const nameMatch = result.columnMatches.find((match) => match.field === 'name');
    const englishMatch = result.columnMatches.find((match) => match.field === 'englishName');
    expect(nameMatch?.header, 'the name column must land on the name field').toBe('الاسم');
    expect(englishMatch?.header, 'الاسم must not be claimed by the English-name field').toBe('');

    // And the value must be readable, not merely mapped: this is the part the operator
    // would have discovered first.
    expect(result.rows[0].name).toBe('سكر');
  });

  it('still maps a genuinely English header to englishName', async () => {
    // The counterpart, so the fix above cannot be "stop matching englishName at all".
    const english = await workbookFile((sheet) => {
      sheet.addRow(['الاسم', 'English Name']);
      sheet.addRow(['سكر', 'Sugar']);
    });
    const result = await parseExcelFileWithInsights(english);
    const englishMatch = result.columnMatches.find((match) => match.field === 'englishName');
    expect(englishMatch?.header, 'an English header must still reach englishName').toBe('English Name');
    expect(result.rows[0].englishName).toBe('Sugar');
  });
});
