import { createExcelWorkbook } from './exceljs';

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * How many rows to look at when hunting for the header.
 *
 * Five, not "row 1", because stock files routinely carry a title, a date, or a
 * store's logo above the real column names, and a file where the first row is a
 * merged title cell matches nothing at all. Five is enough for a banner block and
 * short enough that it cannot wander into the data and pick a data row as the
 * header — which is why this is a bounded scan and not a guess over the whole sheet.
 */
const HEADER_SCAN_ROWS = 5;

export type ExcelPrimitive = string | number | boolean | Date | '';
export type ExcelRow = Record<string, ExcelPrimitive>;
type ExcelRowInput = Record<string, unknown>;
export type ExcelSheetRow = ExcelPrimitive[];
type ExcelSheetRowInput = unknown[];
type ExcelSheetColumn = number | { wch?: number } | { width?: number };
export type ExcelWorkbookSheet = {
  name: string;
  rows: ExcelSheetRow[];
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const normalizeCellValue = (value: unknown): ExcelPrimitive => {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'object') {
    const candidate = value as {
      result?: unknown;
      text?: unknown;
      hyperlink?: unknown;
      richText?: Array<{ text?: unknown }>;
    };

    if (candidate.result != null) {
      return normalizeCellValue(candidate.result);
    }

    if (Array.isArray(candidate.richText)) {
      return candidate.richText.map((entry) => String(entry?.text || '')).join('');
    }

    if (candidate.text != null) {
      return String(candidate.text);
    }

    if (candidate.hyperlink != null) {
      return String(candidate.hyperlink);
    }
  }

  return String(value);
};

/**
 * Neutralises a value Excel would otherwise evaluate.
 *
 * A cell whose text begins with `=`, `+`, `-` or `@` is a formula to Excel, not a
 * string. Since the catalogue is shared and every export writes item names straight
 * through, a name of `=HYPERLINK("http://x","click")` becomes a live link in every
 * file produced from it — executed by whoever opens the export, which is not the person
 * who typed it. No malice is required: a product name copied from a supplier's system
 * can begin with `-` by accident.
 *
 * The fix is an apostrophe, which Excel treats as "the rest of this is text" and does
 * not display. Nothing is stripped: silently deleting a character from someone's
 * product name to satisfy an export path would be a worse bug than the one being fixed,
 * and the operator has no way to notice it happened.
 *
 * Guarded on the *write*, because a formula is parsed on the way in. A check at the
 * reader is too late — by then the cell is already a formula.
 *
 * Numbers are returned untouched: quoting a number turns a quantity column into text
 * and silently breaks every total and threshold computed from it, which is a worse
 * outcome than a formula that only ever came from a name.
 */
export const escapeSpreadsheetFormula = (value: ExcelPrimitive): ExcelPrimitive => {
  if (typeof value !== 'string' || value === '') return value;
  // Leading whitespace does not stop Excel from deciding the cell is a formula, so the
  // check looks through it. Guarding only character zero is the usual way this misses.
  const leading = value.match(/^[\s]*/)?.[0] ?? '';
  const rest = value.slice(leading.length);
  if (rest === '') {
    // Whitespace only, or a bare "-": nothing to evaluate, but escaping keeps the
    // check and the value in agreement, and the apostrophe is invisible.
    return /^-/.test(value) ? `'${value}` : value;
  }
  return '=+-@'.includes(rest[0]) ? `'${value}` : value;
};

/** The first row of a worksheet as plain values. For tests and previews. */
export const readSheetCells = (worksheet: any): ExcelSheetRow[] => worksheetToMatrix(worksheet);

const worksheetToMatrix = (worksheet: any): ExcelSheetRow[] => {
  const rows: ExcelSheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row: any) => {
    const maxColumnCount = Math.max(row.cellCount, row.actualCellCount);
    const values: ExcelSheetRow = [];
    for (let columnIndex = 1; columnIndex <= maxColumnCount; columnIndex += 1) {
      values.push(normalizeCellValue(row.getCell(columnIndex).value));
    }
    rows.push(values);
  });
  return rows;
};

export const exportRowsToExcel = async (params: {
  rows: ExcelRowInput[];
  sheetName: string;
  fileName: string;
  headerOrder?: string[];
  columnWidths?: number[];
}) => {
  const workbook = await createExcelWorkbook();
  const worksheet = workbook.addWorksheet(params.sheetName);
  const resolvedHeaders = params.headerOrder?.length
    ? params.headerOrder
    : Array.from(
        params.rows.reduce((headers, row) => {
          Object.keys(row).forEach((key) => headers.add(key));
          return headers;
        }, new Set<string>()),
      );

  if (!resolvedHeaders.length) {
    throw new Error('لا توجد بيانات قابلة للتصدير إلى Excel.');
  }

  const headerRow = worksheet.addRow(resolvedHeaders.map((header) => escapeSpreadsheetFormula(header)));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
  });

  // Every value here is operator-supplied text — item names, notes, descriptions — and
  // goes through the formula guard. The header row too, because a field label is
  // itself a string that could start with `=` if it were ever built from data.
  params.rows.forEach((row) => {
    worksheet.addRow(
      resolvedHeaders.map((header) => escapeSpreadsheetFormula(normalizeCellValue(row[header]))),
    );
  });

  params.columnWidths?.forEach((width, index) => {
    if (!Number.isFinite(width) || width <= 0) return;
    worksheet.getColumn(index + 1).width = width;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: EXCEL_MIME_TYPE }), params.fileName);
};

export const exportSheetsToExcel = async (params: {
  fileName: string;
  sheets: Array<{
    name: string;
    rows: ExcelSheetRowInput[];
    columns?: ExcelSheetColumn[];
  }>;
}) => {
  const workbook = await createExcelWorkbook();

  params.sheets.forEach((sheet, index) => {
    const worksheet = workbook.addWorksheet((sheet.name || `Sheet${index + 1}`).slice(0, 31));
    sheet.rows.forEach((row) => {
      // Guarded for the same reason as `exportRowsToExcel`: this is the multi-sheet
      // export path, used for the larger reports, and it writes the same operator text.
      worksheet.addRow(row.map((cell) => escapeSpreadsheetFormula(normalizeCellValue(cell))));
    });

    sheet.columns?.forEach((column, columnIndex) => {
      const width =
        typeof column === 'number'
          ? column
          : 'wch' in column
            ? column.wch
            : 'width' in column
              ? column.width
              : undefined;
      if (!Number.isFinite(width) || Number(width) <= 0) return;
      worksheet.getColumn(columnIndex + 1).width = Number(width);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: EXCEL_MIME_TYPE }), params.fileName);
};

export type ExcelSourceRow = {
  /**
   * The 1-based row number this data occupies in the sheet.
   *
   * The old reader pushed rows into a dense array and the parser then said
   * `index + 2`, so every message about a rejected row pointed at a line that had
   * drifted by one — or by however many blank rows sat above it. A blank row in the
   * middle of a stock file is normal, and each one silently moved every message
   * below it further from the truth. This is the number the operator is looking at.
   */
  rowNumber: number;
  /** The row's cells, keyed by the resolved header text. */
  cells: ExcelRow;
  /**
   * True when the row holds no value in any mapped column.
   *
   * Kept rather than dropped. An operator who has one reason to wonder is "why did my
   * 400-row file import 380?", and the honest answer is a visible count of the rows
   * that were skipped as empty — not a silent 20.
   */
  isEmpty: boolean;
};

export type ExcelHeaderRowResult = {
  /** The 1-based row the headers were read from. */
  headerRow: number;
  /** Header text per column, positionally, with gaps preserved as empty strings. */
  headers: string[];
  rows: ExcelSourceRow[];
  /**
   * Header labels that appear more than once in the header row.
   *
   * A duplicated header is a real spreadsheet outcome — copy-pasting a column, or a
   * merge that resolves to the same text twice — and it is *not* self-correcting: both
   * copies collapse onto one key, so one of the two columns is read as absent and its
   * values land in whichever column survived. Silently. Surfacing the collision is
   * the difference between "this file is wrong" and "why is this column empty".
   */
  duplicateHeaders: string[];
};

/**
 * Picks the header row: the first row that has a usable number of non-empty labels.
 *
 * A stock file often carries a title, a date, or a logo row above the real header, so
 * assuming row 1 read those as column names and matched nothing. Scanning the first
 * few rows for the densest labelled one is a guess, but a bounded and honest one — and
 * the caller can see which row was chosen.
 */
const detectHeaderRow = (
  worksheet: any,
  maxScan: number,
): { rowNumber: number; headers: string[] } => {
  let best: { rowNumber: number; headers: string[]; score: number } = {
    rowNumber: 1,
    headers: [],
    score: -1,
  };

  worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
    if (rowNumber > maxScan) return false; // stop scanning
    const headers: string[] = [];
    let score = 0;
    row.eachCell({ includeEmpty: true }, (cell: any, columnNumber: number) => {
      const text = String(normalizeCellValue(cell.value)).trim();
      headers[columnNumber - 1] = text;
      if (text) score += 1;
    });
    if (score > best.score) {
      best = { rowNumber, headers, score };
    }
    return true;
  });

  return { rowNumber: best.rowNumber, headers: best.headers };
};

/**
 * Reads the first worksheet into rows that keep their real line numbers.
 *
 * `headerRow` is not assumed to be 1; see `detectHeaderRow`. Duplicate headers are
 * reported rather than resolved, because resolving them means picking a winner and
 * there is no correct winner — the operator has to say which column they meant.
 */
export const readFirstWorksheetSource = async (file: File): Promise<ExcelHeaderRowResult> => {
  const workbook = await createExcelWorkbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) {
    throw new Error('لا توجد ورقة عمل داخل ملف Excel.');
  }

  const { rowNumber: headerRow, headers } = detectHeaderRow(worksheet, HEADER_SCAN_ROWS);
  const mappedHeaders = headers.filter(Boolean);

  // Position of each distinct header label, so a duplicate can be reported and the
  // *last* one skipped rather than the first (keeping the first means a later column
  // silently overwrites the earlier value in the object).
  const firstColumnByHeader = new Map<string, number>();
  const duplicateHeaders: string[] = [];
  headers.forEach((header, index) => {
    if (!header) return;
    if (firstColumnByHeader.has(header)) {
      if (!duplicateHeaders.includes(header)) duplicateHeaders.push(header);
      return;
    }
    firstColumnByHeader.set(header, index);
  });

  // Two different kinds of blank line, and both have to be reported.
  //
  // One is a row that exists in the sheet with nothing in it — a spacer between two
  // sections, or a row whose cells were cleared. `includeEmpty: true` yields it, and
  // the reader has to include it, because an operator looking at a gap in their file
  // is looking at exactly that.
  //
  // The other is a line that is not a row at all, which is what a blank line in a
  // file saved by Excel usually is. Nothing yields those, so they are derived by
  // arithmetic between the rows that do exist.
  //
  // Bounded by `rowCount`, the highest row index the sheet actually has. Iterating
  // `includeEmpty: true` to that bound walks only the rows that exist, so a file
  // somebody once formatted down to row 1,048,576 costs nothing extra: the counter
  // says the sheet ends at row 12 and iteration ends at row 12.
  //
  // `actualRowCount` was tried here and is the wrong bound. It counts rows *with
  // data*, so a sheet with a blank above its last real row gets truncated at exactly
  // the row the caller is about to ask about.
  const lastRow = Math.max(worksheet.rowCount ?? 0, headerRow);
  const existing: Array<{ rowNumber: number; cells: ExcelRow; isEmpty: boolean }> = [];
  worksheet.eachRow({ includeEmpty: true }, (row: any, rowNumber: number) => {
    if (rowNumber <= headerRow) return;
    if (rowNumber > lastRow) return false;

    const cells: ExcelRow = {};
    let hasValue = false;
    firstColumnByHeader.forEach((index, header) => {
      const value = normalizeCellValue(row.getCell(index + 1).value);
      cells[header] = value;
      if (String(value).trim()) hasValue = true;
    });

    existing.push({ rowNumber, cells, isEmpty: !hasValue });
  });

  const blankCells = (): ExcelRow => {
    const blank: ExcelRow = {};
    firstColumnByHeader.forEach((_index, header) => {
      blank[header] = '';
    });
    return blank;
  };

  const rows: ExcelSourceRow[] = [];
  let lastSeen = 0;
  for (const entry of existing) {
    // `existing` arrives in ascending order, so everything between the last row seen
    // and this one is a line the sheet does not contain a row for. One pass, no search.
    if (lastSeen > 0) {
      for (let gap = lastSeen + 1; gap < entry.rowNumber; gap += 1) {
        rows.push({ rowNumber: gap, cells: blankCells(), isEmpty: true });
      }
    }
    rows.push({ rowNumber: entry.rowNumber, cells: entry.cells, isEmpty: entry.isEmpty });
    lastSeen = entry.rowNumber;
  }

  return { headerRow, headers: mappedHeaders, rows, duplicateHeaders };
};

export const readFirstWorksheetRows = async (file: File): Promise<ExcelRow[]> => {
  const result = await readFirstWorksheetSource(file);
  // Drop the empty rows again, because this is the shape its other callers were
  // written against. The source reader keeps them so the import studio can count and
  // number them; a plain list of rows has no place to put a blank.
  return result.rows.filter((row) => !row.isEmpty).map((row) => row.cells);
};

export const readFirstWorksheetMatrix = async (file: File): Promise<ExcelSheetRow[]> => {
  const workbook = await createExcelWorkbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) {
    throw new Error('لا توجد ورقة عمل داخل ملف Excel.');
  }

  return worksheetToMatrix(worksheet);
};

export const readWorkbookSheets = async (file: File): Promise<ExcelWorkbookSheet[]> => {
  const workbook = await createExcelWorkbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);

  const sheets: ExcelWorkbookSheet[] = [];
  workbook.eachSheet((worksheet) => {
    sheets.push({
      name: worksheet.name,
      rows: worksheetToMatrix(worksheet),
    });
  });

  if (!sheets.length) {
    throw new Error('لا توجد أوراق عمل داخل ملف Excel.');
  }

  return sheets;
};