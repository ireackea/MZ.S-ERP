import React from 'react';
import type { MonthlyAuditRow } from '../../services/monthlyStocktakingService';
import {
  formatNumber,
  getPrintPageMetrics,
  SIGNATURE_TITLES,
  type AuditCategoryCard,
  type StocktakingPrintConfig,
} from './shared';

type StocktakingPrintPreviewProps = {
  start: Date;
  companyLogoUrl: string;
  printConfig: StocktakingPrintConfig;
  visibleReportCards: AuditCategoryCard[];
};

const StocktakingPrintPreview: React.FC<StocktakingPrintPreviewProps> = ({
  start,
  companyLogoUrl,
  printConfig,
  visibleReportCards,
}) => {
  const pageMetrics = getPrintPageMetrics(printConfig);
  const availableContentHeightMm = Math.max(10, pageMetrics.contentHeightMm - printConfig.topPageMarginMm - printConfig.bottomPageMarginMm);

  const mergeRatio = printConfig.mergeColumns ? Math.min(1, Math.max(0, printConfig.mergeStrength / 100)) : 0;
  const effectiveColumnSpacing = printConfig.mergeColumns
    ? Math.max(0, printConfig.columnSpacing * (1 - mergeRatio))
    : printConfig.columnSpacing;

  const estimateTextMinWidth = (value: string) => {
    const length = String(value || '').trim().length;
    return Math.max(28, Math.ceil(length * printConfig.tableFontSize * 0.62) + 18);
  };

  const allVisibleRows = visibleReportCards.flatMap((card) => card.rows);
  const maxIndexDigits = Math.max(2, String(allVisibleRows.length || 1).length);
  const maxItemNameLen = allVisibleRows.reduce((max, row) => Math.max(max, String(row.itemName || '').length), 4);
  const maxNotesLen = allVisibleRows.reduce((max, row) => Math.max(max, String(row.notes || '').length), 4);

  const numberColumns = [
    ...allVisibleRows.map((row) => formatNumber(row.openingBalance)),
    ...allVisibleRows.map((row) => formatNumber(row.totalInbound)),
    ...allVisibleRows.map((row) => formatNumber(row.totalReturns)),
    ...allVisibleRows.map((row) => formatNumber(row.totalProduction)),
    ...allVisibleRows.map((row) => formatNumber(row.totalOutbound)),
    ...allVisibleRows.map((row) => formatNumber(row.totalWaste)),
    ...allVisibleRows.map((row) => formatNumber(row.theoreticalBalance)),
    ...allVisibleRows.map((row) => formatNumber(row.actualCount)),
    ...allVisibleRows.map((row) => formatNumber(row.difference)),
  ];
  const maxNumberLen = numberColumns.reduce((max, value) => Math.max(max, String(value || '').length), 3);

  const baseColumnWidths = [56, 230, 96, 96, 96, 96, 96, 96, 102, 102, 96, 190];
  const minColumnWidths = [
    Math.max(34, estimateTextMinWidth('م'.repeat(maxIndexDigits))),
    Math.max(88, estimateTextMinWidth('اسم الصنف'), estimateTextMinWidth('م'.repeat(Math.min(maxItemNameLen, 24)))),
    Math.max(58, estimateTextMinWidth('الإفتتاحي'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(58, estimateTextMinWidth('الوارد'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(58, estimateTextMinWidth('المرتجع'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(58, estimateTextMinWidth('الإنتاج'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(58, estimateTextMinWidth('المنصرف'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(58, estimateTextMinWidth('الهالك'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(62, estimateTextMinWidth('الرصيد الدفتري'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(62, estimateTextMinWidth('الجرد الفعلي'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(62, estimateTextMinWidth('الفارق'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
    Math.max(90, estimateTextMinWidth('ملاحظات الجرد'), estimateTextMinWidth('م'.repeat(Math.min(maxNotesLen, 18)))),
  ];

  const baseTotalWidth = baseColumnWidths.reduce((sum, value) => sum + value, 0);
  const minTotalWidth = minColumnWidths.reduce((sum, value) => sum + value, 0);
  const targetTotalWidth = baseTotalWidth - mergeRatio * (baseTotalWidth - minTotalWidth);

  const smartColumnWidths = [...baseColumnWidths];
  let remainingReduction = Math.max(0, baseTotalWidth - targetTotalWidth);

  for (let iteration = 0; iteration < 6 && remainingReduction > 0.1; iteration += 1) {
    const shrinkableIndexes = smartColumnWidths
      .map((width, index) => ({ index, capacity: Math.max(0, width - minColumnWidths[index]) }))
      .filter((item) => item.capacity > 0.1);

    if (!shrinkableIndexes.length) break;

    const totalCapacity = shrinkableIndexes.reduce((sum, item) => sum + item.capacity, 0);
    if (totalCapacity <= 0) break;

    let reducedThisPass = 0;
    shrinkableIndexes.forEach(({ index, capacity }) => {
      const planned = (remainingReduction * capacity) / totalCapacity;
      const applied = Math.min(capacity, planned);
      smartColumnWidths[index] -= applied;
      reducedThisPass += applied;
    });

    if (reducedThisPass <= 0.01) break;
    remainingReduction -= reducedThisPass;
  }

  const effectiveTableMinWidth = smartColumnWidths.reduce((sum, value) => sum + value, 0);

  const verticalPosition = Math.min(100, Math.max(0, printConfig.cellTextVerticalPosition));
  const verticalRatio = verticalPosition / 100;
  const totalVerticalPadding = Math.max(0, printConfig.rowVerticalPaddingPx * 2);
  const dynamicPaddingTop = Math.round(totalVerticalPadding * verticalRatio);
  const dynamicPaddingBottom = Math.max(0, totalVerticalPadding - dynamicPaddingTop);

  const headerCellStyle: React.CSSProperties = {
    border: printConfig.showBorders ? '1px solid #e2e8f0' : 'none',
    paddingLeft: `${effectiveColumnSpacing}px`,
    paddingRight: `${effectiveColumnSpacing}px`,
    paddingTop: `${dynamicPaddingTop}px`,
    paddingBottom: `${dynamicPaddingBottom}px`,
    verticalAlign: 'top',
    ...(printConfig.tableRowHeightMode === 'fixed'
      ? { height: `${printConfig.headerRowHeightPx}px` }
      : { minHeight: `${printConfig.headerRowHeightPx}px` }),
  };

  const bodyCellStyle: React.CSSProperties = {
    border: printConfig.showBorders ? '1px solid #f1f5f9' : 'none',
    paddingLeft: `${effectiveColumnSpacing}px`,
    paddingRight: `${effectiveColumnSpacing}px`,
    paddingTop: `${dynamicPaddingTop}px`,
    paddingBottom: `${dynamicPaddingBottom}px`,
    verticalAlign: 'top',
    ...(printConfig.tableRowHeightMode === 'fixed'
      ? { height: `${printConfig.bodyRowHeightPx}px` }
      : { minHeight: `${printConfig.bodyRowHeightPx}px` }),
  };

  const tableHeadClassName = `${printConfig.colorHeaderRow ? 'bg-slate-50' : 'bg-white'} border-b border-slate-200 text-slate-700`;
  const stocktakingMonthYearLabel = `${String(start.getMonth() + 1).padStart(2, '0')}/${start.getFullYear()}`;

  const headerBlock = (
    <div className="report-head mb-3 border-b border-slate-200 pb-4 text-center">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-[150px] flex items-center gap-2 text-[11px] text-slate-600 leading-tight">
          <span className="font-bold text-slate-700">تقرير الجرد</span>
          <span className="mx-1">|</span>
          <span>{stocktakingMonthYearLabel}</span>
        </div>

        <div className="flex-1 text-center">
          <h3 className="report-main-title text-lg md:text-xl font-bold text-slate-700">{printConfig.reportTitle}</h3>
        </div>

        <div className="w-24 flex justify-end">
          {companyLogoUrl ? <img src={companyLogoUrl} alt="logo" className="h-12 w-auto object-contain" /> : null}
        </div>
      </div>
    </div>
  );

  const renderCardSection = (card: AuditCategoryCard, rows: MonthlyAuditRow[], rowStartIndex: number, isContinued: boolean, key: string) => (
    <section key={key} className={`card-container report-card break-inside-avoid ${isContinued ? 'p-0' : 'p-0.5'}`}>
      <div
        className={`border-l-4 ${card.accentClass} pl-2`}
        style={{
          transform: `translateY(-${printConfig.tableTitleLiftPx}px)`,
          marginBottom: `${Math.max(1, 2 + printConfig.tableTitleLiftPx)}px`,
        }}
      >
        <h4
          className="report-card-title text-center font-black tracking-normal leading-normal text-slate-900"
          style={{ fontSize: `${printConfig.fontSize}px` }}
        >
          {card.title}
          {isContinued ? <span className="text-slate-500 mr-2" style={{ fontSize: `${Math.max(10, printConfig.fontSize - 3)}px` }}>(تابع)</span> : null}
        </h4>
      </div>

      <div className="overflow-auto">
        <table
          className="w-full"
          style={{
            fontSize: `${printConfig.tableFontSize}px`,
            minWidth: `${effectiveTableMinWidth}px`,
            tableLayout: 'fixed',
          }}
        >
          <colgroup>
            {smartColumnWidths.map((width, index) => (
              <col key={`${key}-col-${index}`} style={{ width: `${width}px` }} />
            ))}
          </colgroup>
          <thead className={tableHeadClassName}>
            <tr>
              <th className="text-center" style={headerCellStyle}>م</th>
              <th className="text-center" style={headerCellStyle}>الصنف</th>
              <th className="text-center" style={headerCellStyle}>الإفتتاحي</th>
              <th className="text-center" style={headerCellStyle}>الوارد</th>
              <th className="text-center" style={headerCellStyle}>المرتجع</th>
              <th className="text-center" style={headerCellStyle}>الإنتاج</th>
              <th className="text-center" style={headerCellStyle}>المنصرف</th>
              <th className="text-center" style={headerCellStyle}>الهالك</th>
              <th className="text-center" style={headerCellStyle}>الدفتري</th>
              <th className="text-center" style={headerCellStyle}>الفعلي</th>
              <th className="text-center" style={headerCellStyle}>الفارق</th>
              <th className="text-center" style={headerCellStyle}>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <tr
                  key={`${row.itemId}-${rowStartIndex + rowIndex}`}
                  className={printConfig.zebraStriping && rowIndex % 2 === 1 ? 'bg-slate-50/70' : ''}
                  style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                >
                  <td className="text-center" style={bodyCellStyle}>{rowStartIndex + rowIndex + 1}</td>
                  <td className="font-bold text-center" style={bodyCellStyle}>{row.itemName}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.openingBalance)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.totalInbound)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.totalReturns)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.totalProduction)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.totalOutbound)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.totalWaste)}</td>
                  <td className="font-bold text-slate-800 text-center" style={bodyCellStyle}>{formatNumber(row.theoreticalBalance)}</td>
                  <td className="text-center" style={bodyCellStyle}>{formatNumber(row.actualCount)}</td>
                  <td className={`font-bold text-center ${row.difference === undefined ? 'text-slate-400' : row.difference > 0 ? 'text-red-700' : row.difference < 0 ? 'text-emerald-700' : 'text-slate-700'}`} style={bodyCellStyle}>{formatNumber(row.difference)}</td>
                  <td className="text-center" style={bodyCellStyle}>{row.notes || ''}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="p-4 text-center text-slate-500">لا توجد أصناف تحت تصنيف {card.title} خلال هذه الفترة.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  if (!printConfig.smartPaginationEnabled) {
    return (
      <div
        className="report-page bg-white overflow-hidden p-4 relative stocktaking-print-page"
        style={{
          width: '100%',
          minHeight: `${availableContentHeightMm}mm`,
          paddingTop: `${printConfig.topPageMarginMm}mm`,
          paddingBottom: `${printConfig.bottomPageMarginMm}mm`,
        }}
      >
        {printConfig.watermarkText.trim() && (
          <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center" style={{ opacity: 0.08 }}>
            <div className="font-bold" style={{ fontSize: '72px', transform: 'rotate(-24deg)' }}>
              {printConfig.watermarkText}
            </div>
          </div>
        )}

        <div className="relative z-10">
          {headerBlock}
          <div className="space-y-0">
            {visibleReportCards.map((card) => renderCardSection(card, card.rows, 0, false, `${card.key}-full`))}
          </div>

          {printConfig.showSignatures && (
            <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-xs">
              {SIGNATURE_TITLES.map((title) => (
                <div key={title} className="border border-dashed border-slate-300 rounded-lg p-2 flex items-end justify-center text-slate-700 font-bold" style={{ height: `${printConfig.printSignatureBoxHeight || 96}px` }}>
                  {title}
                </div>
              ))}
            </div>
          )}

          {printConfig.generalNote.trim() && (
            <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-600 whitespace-pre-wrap">
              <div className="font-bold text-slate-700 mb-1">ملاحظة عامة</div>
              <div>{printConfig.generalNote}</div>
            </div>
          )}

          {printConfig.showQrCode && printConfig.reportUrl.trim() && (
            <div className="mt-3 text-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(printConfig.reportUrl)}`}
                alt="QR Verification"
                className="w-20 h-20 border border-slate-200 rounded mx-auto"
              />
              <div className="text-[10px] text-slate-500 mt-1">امسح الرمز للوصول عبر الهاتف</div>
            </div>
          )}

          {printConfig.bottomPageMarginMm > 0 && <div style={{ height: `${printConfig.bottomPageMarginMm}mm` }} aria-hidden="true" />}
        </div>
      </div>
    );
  }

  const fillRatio = Math.min(0.99, Math.max(0.8, printConfig.pageFillPercent / 100));
  const targetPageHeightMm = availableContentHeightMm * fillRatio;
  const firstPageHeaderMm = 18;
  const repeatedHeaderMm = 10;
  const sectionFixedMm = 6;
  const estimatedRowHeightMm = printConfig.tableRowHeightMode === 'fixed'
    ? Math.max(5, printConfig.bodyRowHeightPx * 0.264583)
    : Math.max(6, (printConfig.tableFontSize * 0.52) + (printConfig.rowVerticalPaddingPx * 0.529166) + 1.4);

  type PaginatedSegment = {
    card: AuditCategoryCard;
    rows: MonthlyAuditRow[];
    rowStartIndex: number;
    isContinued: boolean;
  };

  type PaginatedPage = {
    segments: PaginatedSegment[];
    usedHeightMm: number;
  };

  const pages: PaginatedPage[] = [{ segments: [], usedHeightMm: firstPageHeaderMm }];

  const ensureSpaceForNextPage = () => {
    pages.push({
      segments: [],
      usedHeightMm: printConfig.repeatHeaderEachPage ? repeatedHeaderMm : 6,
    });
  };

  visibleReportCards.forEach((card) => {
    const rows = card.rows.length ? card.rows : [];
    if (!rows.length) {
      const lastPage = pages[pages.length - 1];
      const neededMm = sectionFixedMm + estimatedRowHeightMm;
      if (lastPage.usedHeightMm + neededMm > targetPageHeightMm && lastPage.segments.length) {
        ensureSpaceForNextPage();
      }
      pages[pages.length - 1].segments.push({ card, rows: [], rowStartIndex: 0, isContinued: false });
      pages[pages.length - 1].usedHeightMm += neededMm;
      return;
    }

    let rowIndex = 0;
    while (rowIndex < rows.length) {
      let page = pages[pages.length - 1];
      const segmentFixedMm = rowIndex > 0 ? 2 : sectionFixedMm;
      const remainingMm = targetPageHeightMm - page.usedHeightMm;
      const minNeededMm = segmentFixedMm + estimatedRowHeightMm;

      if (remainingMm < minNeededMm && page.segments.length) {
        ensureSpaceForNextPage();
        page = pages[pages.length - 1];
      }

      const rawRowsCapacity = Math.max(1, Math.floor((targetPageHeightMm - page.usedHeightMm - segmentFixedMm) / estimatedRowHeightMm));
      let rowsCapacity = rawRowsCapacity;
      const remainingRows = rows.length - rowIndex;
      if (remainingRows > rawRowsCapacity) {
        rowsCapacity = Math.max(1, rawRowsCapacity - Math.max(0, printConfig.pageSafetyRows));
      }

      const takeCount = Math.min(rowsCapacity, remainingRows);
      const chunk = rows.slice(rowIndex, rowIndex + takeCount);

      page.segments.push({
        card,
        rows: chunk,
        rowStartIndex: rowIndex,
        isContinued: rowIndex > 0,
      });

      page.usedHeightMm += segmentFixedMm + takeCount * estimatedRowHeightMm;
      rowIndex += takeCount;

      if (rowIndex < rows.length) {
        ensureSpaceForNextPage();
      }
    }
  });

  const estimatedFooterMm =
    (printConfig.showSignatures ? 30 : 0)
    + (printConfig.generalNote.trim() ? 16 : 0)
    + (printConfig.showQrCode && printConfig.reportUrl.trim() ? 20 : 0);

  if (estimatedFooterMm > 0) {
    const lastPage = pages[pages.length - 1];
    if (lastPage.usedHeightMm + estimatedFooterMm > targetPageHeightMm && lastPage.segments.length) {
      ensureSpaceForNextPage();
    }
  }

  return (
    <div className="space-y-0">
      {pages.map((page, pageIndex) => {
        const isLastPage = pageIndex === pages.length - 1;
        const showHeader = pageIndex === 0 || printConfig.repeatHeaderEachPage;

        return (
          <div
            key={`print-page-${pageIndex}`}
            className="report-page bg-white overflow-hidden p-4 relative stocktaking-print-page"
            style={{
              width: '100%',
              minHeight: `${availableContentHeightMm}mm`,
              paddingTop: `${printConfig.topPageMarginMm}mm`,
              paddingBottom: `${printConfig.bottomPageMarginMm}mm`,
              pageBreakAfter: isLastPage ? 'auto' : 'always',
              breakAfter: isLastPage ? 'auto' : 'page',
            }}
          >
            {printConfig.watermarkText.trim() && (
              <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center" style={{ opacity: 0.08 }}>
                <div className="font-bold" style={{ fontSize: '72px', transform: 'rotate(-24deg)' }}>
                  {printConfig.watermarkText}
                </div>
              </div>
            )}

            <div className="relative z-10">
              {showHeader ? headerBlock : null}

              <div className="space-y-0">
                {page.segments.map((segment, segmentIndex) =>
                  renderCardSection(
                    segment.card,
                    segment.rows,
                    segment.rowStartIndex,
                    segment.isContinued,
                    `${segment.card.key}-${pageIndex}-${segment.rowStartIndex}-${segmentIndex}`,
                  )
                )}
              </div>

              {isLastPage && printConfig.showSignatures && (
                <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-xs">
                  {SIGNATURE_TITLES.map((title) => (
                    <div key={title} className="border border-dashed border-slate-300 rounded-lg p-2 flex items-end justify-center text-slate-700 font-bold" style={{ height: `${printConfig.printSignatureBoxHeight || 96}px` }}>
                      {title}
                    </div>
                  ))}
                </div>
              )}

              {isLastPage && printConfig.generalNote.trim() && (
                <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-600 whitespace-pre-wrap">
                  <div className="font-bold text-slate-700 mb-1">ملاحظة عامة</div>
                  <div>{printConfig.generalNote}</div>
                </div>
              )}

              {isLastPage && printConfig.showQrCode && printConfig.reportUrl.trim() && (
                <div className="mt-3 text-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(printConfig.reportUrl)}`}
                    alt="QR Verification"
                    className="w-20 h-20 border border-slate-200 rounded mx-auto"
                  />
                  <div className="text-[10px] text-slate-500 mt-1">امسح الرمز للوصول عبر الهاتف</div>
                </div>
              )}

              {printConfig.bottomPageMarginMm > 0 && <div style={{ height: `${printConfig.bottomPageMarginMm}mm` }} aria-hidden="true" />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StocktakingPrintPreview;