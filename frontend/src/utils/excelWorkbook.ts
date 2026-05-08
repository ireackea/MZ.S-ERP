import { createExcelWorkbook } from './exceljs';

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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

  const headerRow = worksheet.addRow(resolvedHeaders);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
  });

  params.rows.forEach((row) => {
    worksheet.addRow(resolvedHeaders.map((header) => normalizeCellValue(row[header])));
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
      worksheet.addRow(row.map((cell) => normalizeCellValue(cell)));
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

export const readFirstWorksheetRows = async (file: File): Promise<ExcelRow[]> => {
  const workbook = await createExcelWorkbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) {
    throw new Error('لا توجد ورقة عمل داخل ملف Excel.');
  }

  const headers: string[] = [];
  const rows: ExcelRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        headers[columnNumber - 1] = String(normalizeCellValue(cell.value)).trim();
      });
      return;
    }

    const entry: ExcelRow = {};
    let hasValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = normalizeCellValue(row.getCell(index + 1).value);
      entry[header] = value;
      if (String(value).trim()) {
        hasValue = true;
      }
    });

    if (hasValue) {
      rows.push(entry);
    }
  });

  return rows;
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