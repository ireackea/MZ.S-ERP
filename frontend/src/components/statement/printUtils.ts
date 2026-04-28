import type { GridColumnPreference } from '../../types';
import { createExcelWorkbook } from '../../utils/exceljs';
import { saveElementPdfDocument } from '../../utils/elementPdf';
import {
  DEFAULT_PRINT_TITLE,
  PDF_RENDER_ENDPOINT,
  STATEMENT_SIGNATURE_TITLES,
  downloadBlob,
  escapeHtml,
  formatNumber,
  getPdfMarginsMm,
  getPdfPaperLabel,
  isNumericColumn,
  parsePdfServiceError,
  type StatementPrintConfig,
  type StatementRow,
  type StatementSummary,
} from './shared';

type EnsureStatementPrintRangeParams = {
  printColumns: GridColumnPreference[];
  range: StatementPrintConfig['range'];
  selectedRowsLength: number;
};

export const ensureStatementPrintRange = ({ printColumns, range, selectedRowsLength }: EnsureStatementPrintRangeParams) => {
  if (printColumns.length === 0) {
    return 'يجب اختيار عمود واحد على الأقل قبل الطباعة.';
  }
  if (range === 'selected_rows' && selectedRowsLength === 0) {
    return 'يجب تحديد صف واحد على الأقل عند اختيار نطاق الصفوف المحددة.';
  }
  return null;
};

type ExportStatementExcelParams = {
  printColumns: GridColumnPreference[];
  printConfig: StatementPrintConfig;
  rowsForOutput: StatementRow[];
  summary: StatementSummary;
  onExport?: (rowCount: number) => void;
};

export const exportStatementExcel = async ({ printColumns, printConfig, rowsForOutput, summary, onExport }: ExportStatementExcelParams) => {
  const workbook = await createExcelWorkbook();
  const worksheet = workbook.addWorksheet('Statement');
  worksheet.views = [{ rightToLeft: true }];

  const headers = printColumns.map((column) => column.label);
  const headerRow = worksheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: printConfig.fontSize, color: { argb: 'FFFFFFFF' } };
    if (printConfig.printBackgroundColors) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF334155' },
      };
    }
    if (printConfig.printGridlines) {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    }
  });

  rowsForOutput.forEach((row, index) => {
    const rowData = printColumns.map((column) => (row as Record<string, unknown>)[column.key] ?? '');
    const excelRow = worksheet.addRow(rowData);
    excelRow.eachCell((cell) => {
      cell.font = { size: printConfig.fontSize };
      if (printConfig.printGridlines) {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      }
      if (printConfig.printBackgroundColors && index % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
    });
  });

  const totalColumns = Math.max(1, printColumns.length);

  const setRangeBorder = (rowNumber: number, startColumn: number, endColumn: number, border: Record<string, unknown>) => {
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const cell = worksheet.getCell(rowNumber, columnIndex);
      cell.border = {
        ...(cell.border || {}),
        ...border,
      };
    }
  };

  const styleCardRegion = (labelRow: number, valueRow: number, startColumn: number, endColumn: number, label: string, value: string) => {
    worksheet.mergeCells(labelRow, startColumn, labelRow, endColumn);
    worksheet.mergeCells(valueRow, startColumn, valueRow, endColumn);

    const labelCell = worksheet.getCell(labelRow, startColumn);
    labelCell.value = label;
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.font = { bold: true, size: Math.max(9, printConfig.fontSize - 1), color: { argb: 'FF64748B' } };
    labelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8FAFC' },
    };

    const valueCell = worksheet.getCell(valueRow, startColumn);
    valueCell.value = value;
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.font = { bold: true, size: printConfig.fontSize + 1, color: { argb: 'FF0F172A' } };

    const border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    setRangeBorder(labelRow, startColumn, endColumn, border);
    setRangeBorder(valueRow, startColumn, endColumn, border);
  };

  if (printConfig.printSummaryCards) {
    worksheet.addRow([]);
    const summaryCards = [
      { label: 'إجمالي الوزن القائم', value: `${formatNumber(summary.gross)} كجم` },
      { label: 'إجمالي الوزن الصافي', value: `${formatNumber(summary.net)} كجم` },
      { label: 'الفرق بين القائم والصافي', value: `${formatNumber(summary.difference)} كجم` },
      { label: 'إجمالي قيمة التأخير', value: `${formatNumber(summary.delayAmount)} ج.م` },
    ];

    const splitAt = Math.max(1, Math.floor(totalColumns / 2));
    const hasRightRegion = splitAt < totalColumns;

    for (let index = 0; index < summaryCards.length; index += 2) {
      const leftCard = summaryCards[index];
      const rightCard = summaryCards[index + 1];

      const labelRow = worksheet.addRow(new Array(totalColumns).fill('')).number;
      const valueRow = worksheet.addRow(new Array(totalColumns).fill('')).number;

      styleCardRegion(labelRow, valueRow, 1, hasRightRegion ? splitAt : totalColumns, leftCard.label, leftCard.value);
      if (rightCard && hasRightRegion) {
        styleCardRegion(labelRow, valueRow, splitAt + 1, totalColumns, rightCard.label, rightCard.value);
      }
    }
  }

  if (printConfig.printSignatures) {
    worksheet.addRow([]);

    if (totalColumns >= 3) {
      const lineRow = worksheet.addRow(new Array(totalColumns).fill('')).number;
      const nameRow = worksheet.addRow(new Array(totalColumns).fill('')).number;

      STATEMENT_SIGNATURE_TITLES.forEach((title, index) => {
        const startColumn = Math.floor((index * totalColumns) / STATEMENT_SIGNATURE_TITLES.length) + 1;
        const endColumn = Math.max(startColumn, Math.floor(((index + 1) * totalColumns) / STATEMENT_SIGNATURE_TITLES.length));

        worksheet.mergeCells(lineRow, startColumn, lineRow, endColumn);
        worksheet.mergeCells(nameRow, startColumn, nameRow, endColumn);

        const lineCell = worksheet.getCell(lineRow, startColumn);
        lineCell.value = '';
        lineCell.alignment = { horizontal: 'center', vertical: 'middle' };
        lineCell.border = { bottom: { style: 'thin', color: { argb: 'FF0F172A' } } };

        const nameCell = worksheet.getCell(nameRow, startColumn);
        nameCell.value = title;
        nameCell.alignment = { horizontal: 'center', vertical: 'middle' };
        nameCell.font = { bold: true, size: Math.max(10, printConfig.fontSize) };
      });
    } else {
      STATEMENT_SIGNATURE_TITLES.forEach((title) => {
        const lineRow = worksheet.addRow(['']).number;
        worksheet.mergeCells(lineRow, 1, lineRow, totalColumns);
        const lineCell = worksheet.getCell(lineRow, 1);
        lineCell.border = { bottom: { style: 'thin', color: { argb: 'FF0F172A' } } };

        const nameRow = worksheet.addRow([title]).number;
        worksheet.mergeCells(nameRow, 1, nameRow, totalColumns);
        const nameCell = worksheet.getCell(nameRow, 1);
        nameCell.alignment = { horizontal: 'center', vertical: 'middle' };
        nameCell.font = { bold: true, size: Math.max(10, printConfig.fontSize) };
      });
    }
  }

  printColumns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = Math.max(14, Math.floor((column.width ?? 120) / 10));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Statement_${new Date().toISOString().slice(0, 10)}.xlsx`);
  onExport?.(rowsForOutput.length);
};

type RunStatementPdfActionParams = {
  mode: 'save' | 'preview';
  printPreviewElement: HTMLDivElement | null;
  printConfig: StatementPrintConfig;
  printColumns: GridColumnPreference[];
  previewPages: StatementRow[][];
  rowsForOutput: StatementRow[];
  summary: StatementSummary;
  onExport?: (rowCount: number) => void;
};

export const runStatementPdfAction = async ({ mode, printPreviewElement, printConfig, printColumns, previewPages, rowsForOutput, summary, onExport }: RunStatementPdfActionParams) => {
  const exportWithClientFallback = async () => {
    if (!printPreviewElement) {
      throw new Error('تعذر العثور على محتوى صالح لإنشاء ملف PDF.');
    }

    await saveElementPdfDocument({
      element: printPreviewElement,
      fileName: `Statement_${new Date().toISOString().slice(0, 10)}.pdf`,
      paperSize: printConfig.paperSize,
      orientation: printConfig.orientation,
      marginMm: getPdfMarginsMm(printConfig.margins),
      scale: 2,
      backgroundColor: '#ffffff',
    });
  };

  try {
    const resolvedPrintTitle = (printConfig.printTitle || '').trim() || DEFAULT_PRINT_TITLE;
    const pageTables = printConfig.flowMode === 'paged' ? (printConfig.range === 'current_page' ? [rowsForOutput] : previewPages) : [rowsForOutput];

    const styleBlock = `
      <style>
        @page { size: ${getPdfPaperLabel(printConfig.paperSize)} ${printConfig.orientation}; margin: ${printConfig.margins === 'narrow' ? '5mm' : printConfig.margins === 'wide' ? '15mm' : '10mm'}; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #ffffff; font-size: ${printConfig.fontSize}px; }
        .doc-wrap { width: 100%; }
        .doc-page { width: 100%; ${printConfig.flowMode === 'paged' ? 'page-break-after: always; break-after: page;' : ''} margin-bottom: ${printConfig.flowMode === 'paged' ? '0' : '8px'}; }
        .doc-page:last-child { page-break-after: auto; break-after: auto; }
        .title { text-align: center; font-weight: 700; font-size: ${Math.max(14, printConfig.fontSize + 2)}px; margin: 0 0 4px 0; }
        .table-wrap { width: 100%; display: flex; justify-content: center; align-items: flex-start; ${printConfig.scalingMode === 'fit' ? 'overflow: hidden;' : ''} }
        table { border-collapse: collapse; width: ${printConfig.scalingMode === 'fit' ? '100%' : (printConfig.autoSizeColumnsByContent ? 'auto' : '100%')}; max-width: 100%; margin: 0 auto; table-layout: ${printConfig.autoSizeColumnsByContent ? 'auto' : 'fixed'}; }
        thead { ${printConfig.repeatHeaders ? 'display: table-header-group;' : ''} }
        tr { break-inside: avoid; page-break-inside: avoid; }
        th, td { padding: 2px 4px; text-align: center; vertical-align: middle; line-height: 1.3; white-space: ${printConfig.autoSizeColumnsByContent ? 'normal' : 'nowrap'}; overflow: ${printConfig.autoSizeColumnsByContent ? 'visible' : 'hidden'}; text-overflow: ${printConfig.autoSizeColumnsByContent ? 'clip' : 'ellipsis'}; word-break: break-word; overflow-wrap: anywhere; border: ${printConfig.printGridlines ? '1px solid #d1d5db' : 'none'}; }
        th { font-weight: 700; background: ${printConfig.printBackgroundColors ? '#f1f5f9' : 'transparent'}; }
        tbody tr:nth-child(even) td { background: ${printConfig.printBackgroundColors ? '#f8fafc' : 'transparent'}; }
        .summary { display: ${printConfig.printSummaryCards ? 'grid' : 'none'}; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; font-size: ${Math.max(8, printConfig.fontSize - 1)}px; }
        .summary .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; }
        .summary .label { color: #64748b; }
        .summary .value { color: #0f172a; font-weight: 700; margin-top: 2px; }
        .summary-signature-gap { display: ${printConfig.printSummaryCards && printConfig.printSignatures ? 'block' : 'none'}; height: 48px; }
        .signatures { display: ${printConfig.printSignatures ? 'grid' : 'none'}; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; text-align: center; margin-top: 0; font-size: ${printConfig.fontSize}px; }
        .signatures .line { border-bottom: 1px solid #0f172a; height: 28px; }
        .signatures .name { margin-top: 4px; font-weight: 700; color: #334155; }
      </style>
    `;

    const renderCellValue = (row: StatementRow, key: string) => {
      const rawValue = (row as Record<string, unknown>)[key];
      if (isNumericColumn(key)) {
        return formatNumber(Number(rawValue || 0), ['delayMinutes', 'packageCount', 'rowNumber'].includes(key) ? 0 : 3);
      }
      return String(rawValue ?? '');
    };

    const pagesHtml = pageTables
      .map((rows, pageIndex) => {
        const isLast = pageIndex === pageTables.length - 1;
        const headerHtml = printColumns.map((column) => `<th>${column.label}</th>`).join('');
        const rowsHtml = rows.map((row) => `<tr>${printColumns.map((column) => `<td>${renderCellValue(row, column.key)}</td>`).join('')}</tr>`).join('');

        return `
          <section class="doc-page">
            <h3 class="title">${escapeHtml(resolvedPrintTitle)}</h3>
            <div class="table-wrap">
              <table>
                <thead><tr>${headerHtml}</tr></thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
            ${isLast ? `
              <div class="summary">
                <div class="card"><div class="label">إجمالي الوزن القائم</div><div class="value">${formatNumber(summary.gross)} كجم</div></div>
                <div class="card"><div class="label">إجمالي الوزن الصافي</div><div class="value">${formatNumber(summary.net)} كجم</div></div>
                <div class="card"><div class="label">الفرق بين القائم والصافي</div><div class="value">${formatNumber(summary.difference)} كجم</div></div>
                <div class="card"><div class="label">إجمالي قيمة التأخير</div><div class="value">${formatNumber(summary.delayAmount)} ج.م</div></div>
              </div>
              <div class="summary-signature-gap"></div>
              <div class="signatures">
                ${STATEMENT_SIGNATURE_TITLES.map((title) => `<div><div class="line"></div><div class="name">${title}</div></div>`).join('')}
              </div>
            ` : ''}
          </section>
        `;
      })
      .join('');

    const htmlDocument = `
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          ${styleBlock}
        </head>
        <body>
          <main class="doc-wrap">${pagesHtml}</main>
        </body>
      </html>
    `;

    const response = await fetch(PDF_RENDER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: htmlDocument,
        orientation: printConfig.orientation,
        margins: printConfig.margins,
        paperSize: getPdfPaperLabel(printConfig.paperSize),
        scale: 1.0,
        printBackground: true,
        repeatHeaders: printConfig.repeatHeaders,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      const parsedReason = parsePdfServiceError(responseText);
      throw new Error(`PDF service failed: ${response.status}${parsedReason ? ` - ${parsedReason}` : ''}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/pdf')) {
      const errorText = await response.text();
      throw new Error(`Invalid PDF response: ${errorText || contentType}`);
    }

    const pdfArrayBuffer = await response.arrayBuffer();
    const pdfBlob = new Blob([pdfArrayBuffer], { type: 'application/pdf' });

    if (mode === 'preview') {
      const blobUrl = URL.createObjectURL(pdfBlob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      return 'تم فتح معاينة ملف PDF بنجاح.';
    }

    downloadBlob(pdfBlob, `Statement_${new Date().toISOString().slice(0, 10)}.pdf`);
    onExport?.(rowsForOutput.length);
    return 'تم حفظ ملف PDF بنجاح.';
  } catch (error) {
    const details = error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
    const networkHint = details.includes('Failed to fetch')
      ? 'تعذر الاتصال بخدمة إنشاء PDF المدمجة في الخادم. تأكد من أن backend يعمل ويمكنه الوصول إلى مسار /api/render-pdf.'
      : details;

    if (mode === 'save') {
      try {
        await exportWithClientFallback();
        onExport?.(rowsForOutput.length);
        return 'تم حفظ ملف PDF باستخدام المسار البديل بعد تعذر الخادم الأساسي.';
      } catch (fallbackError) {
        const fallbackDetails = fallbackError instanceof Error ? fallbackError.message : 'تعذر تنفيذ المسار البديل';
        throw new Error(`تعذر إنشاء ملف PDF. ${networkHint} | تفاصيل المسار البديل: ${fallbackDetails}`);
      }
    }

    throw new Error(`${mode === 'preview' ? 'تعذر فتح معاينة ملف PDF.' : 'تعذر حفظ ملف PDF.'} ${networkHint}`);
  }
};