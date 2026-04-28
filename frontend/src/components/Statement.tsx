// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalizeOperationType } from '../utils/operationTypes';
import type { GridColumnPreference, Item, SystemSettings, Transaction, UnloadingRule } from '../types';
import {
  getGridDisplayPolicy,
  getGridPreferenceForUser,
  resetGridPreferenceForUser,
  upsertGridPreferenceForUser,
} from '../services/storage';
import { getGridModuleDefinition } from '../services/gridModules';
import { toast } from '@services/toastService';
import StatementPrintPanel from './statement/StatementPrintPanel';
import StatementViewContent from './statement/StatementViewContent';
import {
  DEFAULT_PRINT_CONFIG,
  FALLBACK_COLUMNS,
  PRINT_FONT_MAX,
  PRINT_FONT_MIN,
  PRINT_PRESET_STORAGE_KEY,
  chunkRows,
  getMarginPixels,
  getPaperDimensions,
  isNumericColumn,
  normalizeStatementColumnLabels,
  type SortDirection,
  type StatementPrintConfig,
  type StatementRow,
} from './statement/shared';
import { ensureStatementPrintRange, exportStatementExcel, runStatementPdfAction } from './statement/printUtils';

interface StatementProps {
  items: Item[];
  transactions: Transaction[];
  settings: SystemSettings;
  unloadingRules: UnloadingRule[];
  currentUserId?: string;
  canExport?: boolean;
  onExport?: (rowCount: number) => void;
}

const Statement: React.FC<StatementProps> = ({
  items,
  transactions,
  settings,
  unloadingRules,
  currentUserId,
  canExport = false,
  onExport,
}) => {
  const statementGridModule = useMemo(() => getGridModuleDefinition('statement_grid'), []);
  const statementDefaultColumns = useMemo(
    () => statementGridModule?.columns || FALLBACK_COLUMNS,
    [statementGridModule],
  );

  const [columns, setColumns] = useState<GridColumnPreference[]>(statementDefaultColumns);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showActionsOnPrint, setShowActionsOnPrint] = useState(false);
  const [isForceUnified, setIsForceUnified] = useState(false);
  const [isRowsExpanded, setIsRowsExpanded] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [currentPreviewPage, setCurrentPreviewPage] = useState(1);
  const [pdfStatusMessage, setPdfStatusMessage] = useState('');
  const [printConfig, setPrintConfig] = useState<StatementPrintConfig>(DEFAULT_PRINT_CONFIG);
  const [globalSearch, setGlobalSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const printPreviewRef = useRef<HTMLDivElement | null>(null);
  const previewTableMeasureRef = useRef<HTMLTableElement | null>(null);
  const [measuredTableWidth, setMeasuredTableWidth] = useState(0);
  const [activeResizeKey, setActiveResizeKey] = useState<string | null>(null);

  const printableColumnsCatalog = useMemo(
    () => statementDefaultColumns.filter((column) => !['select', 'actions'].includes(column.key)),
    [statementDefaultColumns],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRINT_PRESET_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<StatementPrintConfig>;
      setPrintConfig((prev) => ({
        ...prev,
        printTitle: typeof parsed.printTitle === 'string' ? parsed.printTitle : prev.printTitle,
        orientation: parsed.orientation === 'landscape' ? 'landscape' : prev.orientation,
        paperSize: parsed.paperSize === 'a3' || parsed.paperSize === 'letter' || parsed.paperSize === 'a4' ? parsed.paperSize : prev.paperSize,
        margins: parsed.margins === 'narrow' || parsed.margins === 'wide' || parsed.margins === 'normal' ? parsed.margins : prev.margins,
        flowMode: parsed.flowMode === 'paged' ? 'paged' : prev.flowMode,
        scalingMode: parsed.scalingMode === 'actual' || parsed.scalingMode === 'fit' ? parsed.scalingMode : prev.scalingMode,
        zoom: Number.isFinite(parsed.zoom) ? Math.min(150, Math.max(80, Number(parsed.zoom))) : prev.zoom,
        fontSize: Number.isFinite(parsed.fontSize) ? Math.min(PRINT_FONT_MAX, Math.max(PRINT_FONT_MIN, Number(parsed.fontSize))) : prev.fontSize,
        printGridlines: typeof parsed.printGridlines === 'boolean' ? parsed.printGridlines : prev.printGridlines,
        printBackgroundColors: typeof parsed.printBackgroundColors === 'boolean' ? parsed.printBackgroundColors : prev.printBackgroundColors,
        printSummaryCards: typeof parsed.printSummaryCards === 'boolean' ? parsed.printSummaryCards : prev.printSummaryCards,
        printSignatures: typeof parsed.printSignatures === 'boolean' ? parsed.printSignatures : prev.printSignatures,
        repeatHeaders: typeof parsed.repeatHeaders === 'boolean' ? parsed.repeatHeaders : prev.repeatHeaders,
        autoSizeColumnsByContent: typeof parsed.autoSizeColumnsByContent === 'boolean' ? parsed.autoSizeColumnsByContent : prev.autoSizeColumnsByContent,
        range: parsed.range === 'current_page' || parsed.range === 'selected_rows' || parsed.range === 'all' ? parsed.range : prev.range,
        printColumnKeys: Array.isArray(parsed.printColumnKeys) ? parsed.printColumnKeys.filter((key): key is string => typeof key === 'string') : prev.printColumnKeys,
      }));
    } catch {
      // ignore invalid presets
    }
  }, []);

  useEffect(() => {
    const allKeys = printableColumnsCatalog.map((column) => column.key);
    const allowed = new Set(allKeys);
    setPrintConfig((prev) => {
      const filtered = prev.printColumnKeys.filter((key) => allowed.has(key));
      const nextKeys = filtered.length > 0 ? filtered : allKeys;
      if (nextKeys.length === prev.printColumnKeys.length && nextKeys.every((key, index) => key === prev.printColumnKeys[index])) {
        return prev;
      }
      return { ...prev, printColumnKeys: nextKeys };
    });
  }, [printableColumnsCatalog]);

  useEffect(() => {
    const effectiveUserId = currentUserId || '0';
    const loaded = getGridPreferenceForUser(effectiveUserId, 'statement_grid', statementDefaultColumns);
    const policy = getGridDisplayPolicy('statement_grid');
    setIsForceUnified(Boolean(policy.forceUnified && effectiveUserId !== '0'));
    setColumns(normalizeStatementColumnLabels(loaded));
  }, [currentUserId, statementDefaultColumns]);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const rulesById = useMemo(() => new Map(unloadingRules.map((rule) => [rule.id, rule])), [unloadingRules]);

  const parseTimeToMinutes = (value?: string) => {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return (hours * 60) + minutes;
  };

  const calculateStayMinutes = (entry?: string, exit?: string) => {
    const entryMinutes = parseTimeToMinutes(entry);
    const exitMinutes = parseTimeToMinutes(exit);
    if (entryMinutes === null || exitMinutes === null) return null;
    if (exitMinutes >= entryMinutes) return exitMinutes - entryMinutes;
    return (1440 - entryMinutes) + exitMinutes;
  };

  const rows = useMemo<StatementRow[]>(() => {
    return transactions.map((transaction, index) => {
      const item = itemsById.get(transaction.itemId);
      const price = Number(item?.costPrice || 0);
      const quantity = Number(transaction.quantity || 0);
      const netWeight = Number(transaction.supplierNet ?? quantity);
      const grossWeight = Number(transaction.quantity || 0);
      const total = quantity * price;

      const stayMinutes = calculateStayMinutes(transaction.entryTime, transaction.exitTime);
      const selectedRule = transaction.unloadingRuleId ? rulesById.get(transaction.unloadingRuleId) : undefined;
      const allowedDuration = Number(selectedRule?.allowed_duration_minutes ?? transaction.unloadingDuration ?? settings.defaultUnloadingDuration ?? 60);
      const penaltyRate = Number(selectedRule?.penalty_rate_per_minute ?? settings.defaultDelayPenalty ?? 0);
      const delayMinutes = stayMinutes === null ? 0 : Math.max(0, stayMinutes - allowedDuration);
      const delayAmount = Number(transaction.delayPenalty ?? (delayMinutes * penaltyRate));

      return {
        id: transaction.id,
        rowNumber: index + 1,
        date: transaction.date || '',
        type: transaction.type,
        warehouseInvoice: transaction.warehouseInvoice || '',
        supplierInvoice: transaction.supplierInvoice || '',
        itemName: item?.name || 'صنف غير معروف',
        itemCode: item?.code || '-',
        unit: item?.unit || '-',
        quantity,
        price,
        total,
        grossWeight,
        netWeight,
        difference: Number(transaction.difference ?? (grossWeight - netWeight)),
        packageCount: Number(transaction.packageCount || 0),
        weightSlip: transaction.weightSlip || '',
        supplierOrReceiver: transaction.supplierOrReceiver || '',
        warehouseId: transaction.warehouseId || 'all',
        truckNumber: transaction.truckNumber || '',
        trailerNumber: transaction.trailerNumber || '',
        driverName: transaction.driverName || '',
        entryTime: transaction.entryTime || '',
        exitTime: transaction.exitTime || '',
        unloadingRule: selectedRule?.rule_name || '',
        delayMinutes,
        delayAmount,
        notes: transaction.notes || '',
      };
    });
  }, [itemsById, rulesById, settings.defaultDelayPenalty, settings.defaultUnloadingDuration, transactions]);

  const orderedColumns = useMemo(() => [...columns].sort((left, right) => left.order - right.order), [columns]);
  const visibleColumns = useMemo(() => orderedColumns.filter((column) => column.visible), [orderedColumns]);

  const frozenOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let offset = 0;
    visibleColumns
      .filter((column) => column.frozen)
      .forEach((column) => {
        offsets[column.key] = offset;
        offset += column.width ?? 0;
      });
    return offsets;
  }, [visibleColumns]);

  const getColumnStyle = (column: GridColumnPreference, isHeader = false): React.CSSProperties => {
    const base: React.CSSProperties = {
      width: `${column.width}px`,
      minWidth: `${column.width}px`,
      maxWidth: `${column.width}px`,
    };

    if (column.frozen) {
      return {
        ...base,
        position: 'sticky',
        left: frozenOffsets[column.key] || 0,
        zIndex: isHeader ? 35 : 20,
        background: '#ffffff',
      };
    }

    return base;
  };

  const partnerOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.supplierOrReceiver).filter(Boolean))),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const global = globalSearch.trim().toLowerCase();

    return rows.filter((row) => {
      if (global) {
        const haystack = Object.values(row).join(' ').toLowerCase();
        if (!haystack.includes(global)) return false;
      }

      if (typeFilter !== 'all' && canonicalizeOperationType(row.type) !== typeFilter) return false;
      if (partnerFilter && !row.supplierOrReceiver.toLowerCase().includes(partnerFilter.toLowerCase())) return false;
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;

      for (const [key, value] of Object.entries(columnFilters)) {
        const normalizedFilter = String(value || '').trim().toLowerCase();
        if (!normalizedFilter) continue;
        const rawCellValue = (row as Record<string, unknown>)[key] ?? '';
        const cellValue = key === 'type'
          ? canonicalizeOperationType(rawCellValue).toLowerCase()
          : String(rawCellValue).toLowerCase();
        if (!cellValue.includes(normalizedFilter)) return false;
      }

      return true;
    });
  }, [columnFilters, dateFrom, dateTo, globalSearch, partnerFilter, rows, typeFilter]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];

    sorted.sort((leftRow, rightRow) => {
      const left = (leftRow as Record<string, unknown>)[sortKey];
      const right = (rightRow as Record<string, unknown>)[sortKey];

      if (left === right) return 0;

      if (isNumericColumn(sortKey)) {
        const leftNum = Number(left || 0);
        const rightNum = Number(right || 0);
        return sortDirection === 'asc' ? leftNum - rightNum : rightNum - leftNum;
      }

      const leftString = String(left || '').toLowerCase();
      const rightString = String(right || '').toLowerCase();
      if (leftString < rightString) return sortDirection === 'asc' ? -1 : 1;
      if (leftString > rightString) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredRows, sortDirection, sortKey]);

  const summary = useMemo(
    () => sortedRows.reduce(
      (acc, row) => {
        acc.gross += row.grossWeight;
        acc.net += row.netWeight;
        acc.difference += row.difference;
        acc.delayMinutes += row.delayMinutes;
        acc.delayAmount += row.delayAmount;
        return acc;
      },
      { gross: 0, net: 0, difference: 0, delayMinutes: 0, delayAmount: 0 },
    ),
    [sortedRows],
  );

  const selectedRowsData = useMemo(
    () => sortedRows.filter((row) => selectedIds.has(row.id)),
    [sortedRows, selectedIds],
  );

  const rowsForPagination = useMemo(() => {
    if (printConfig.range === 'selected_rows') {
      return selectedRowsData;
    }
    return sortedRows;
  }, [printConfig.range, selectedRowsData, sortedRows]);

  const previewPaper = getPaperDimensions(printConfig.paperSize, printConfig.orientation);
  const previewMargin = getMarginPixels(printConfig.margins);
  const availablePrintWidth = Math.max(120, previewPaper.width - (previewMargin * 2));

  const estimatedTableWidth = useMemo(() => {
    const selectedSet = new Set(printConfig.printColumnKeys);
    const byConfig = printableColumnsCatalog
      .filter((column) => selectedSet.has(column.key))
      .reduce((sum, column) => sum + (Number(column.width) || 120), 0);
    return Math.max(byConfig, measuredTableWidth);
  }, [measuredTableWidth, printConfig.printColumnKeys, printableColumnsCatalog]);

  const fitScaleRatio = estimatedTableWidth > 0 ? availablePrintWidth / estimatedTableWidth : 1;
  const autoFitScale = Math.min(1, Math.max(0.25, fitScaleRatio));
  const effectivePrintScale = printConfig.scalingMode === 'fit' ? autoFitScale : 1;
  const isScaleVerySmall = printConfig.scalingMode === 'fit' && effectivePrintScale < 0.5;

  useEffect(() => {
    const updateWidth = () => {
      if (!previewTableMeasureRef.current) return;
      setMeasuredTableWidth(Math.ceil(previewTableMeasureRef.current.scrollWidth));
    };

    updateWidth();
    const frameId = window.requestAnimationFrame(updateWidth);
    window.addEventListener('resize', updateWidth);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updateWidth);
    };
  }, [printConfig.printColumnKeys, printConfig.fontSize, printConfig.orientation, printConfig.paperSize, printConfig.margins, printConfig.scalingMode, rowsForPagination.length]);

  const rowsPerPage = useMemo(() => {
    const contentHeight = (previewPaper.height - (previewMargin * 2)) / Math.max(0.45, effectivePrintScale);
    const reservedHeight = 180;
    const rowHeight = 34;
    return Math.max(8, Math.floor((contentHeight - reservedHeight) / rowHeight));
  }, [effectivePrintScale, previewMargin, previewPaper.height]);

  const pagedRows = useMemo(() => chunkRows(rowsForPagination, rowsPerPage), [rowsForPagination, rowsPerPage]);

  useEffect(() => {
    setCurrentPreviewPage((prev) => Math.min(Math.max(1, prev), Math.max(1, pagedRows.length)));
  }, [pagedRows.length]);

  const previewPages = useMemo(() => {
    if (printConfig.flowMode === 'paged') {
      if (printConfig.range === 'current_page') {
        return [pagedRows[currentPreviewPage - 1] || []];
      }
      return pagedRows;
    }
    return [rowsForPagination];
  }, [currentPreviewPage, pagedRows, printConfig.flowMode, printConfig.range, rowsForPagination]);

  const rowsForOutput = useMemo(() => {
    if (printConfig.range === 'current_page') {
      return previewPages[0] || [];
    }
    return rowsForPagination;
  }, [previewPages, printConfig.range, rowsForPagination]);

  const toggleSort = (columnKey: string) => {
    if (sortKey === columnKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(columnKey);
    setSortDirection('asc');
  };

  const toggleRowSelection = (rowId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const selectAllFiltered = () => setSelectedIds(new Set(sortedRows.map((row) => row.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const saveColumns = () => {
    const effectiveUserId = currentUserId || '0';
    if (isForceUnified && effectiveUserId !== '0') {
      toast.error('لا يمكن تعديل إعدادات الأعمدة أثناء تفعيل الوضع الموحد. أوقف التوحيد أولًا ثم أعد المحاولة.');
      setShowColumnSettings(false);
      return;
    }

    upsertGridPreferenceForUser(effectiveUserId, 'statement_grid', columns);
    setShowColumnSettings(false);
  };

  const resetColumns = () => {
    const effectiveUserId = currentUserId || '0';
    resetGridPreferenceForUser(effectiveUserId, 'statement_grid');
    const loaded = getGridPreferenceForUser(effectiveUserId, 'statement_grid', statementDefaultColumns);
    setColumns(normalizeStatementColumnLabels(loaded));
  };

  const startResize = (event: React.MouseEvent, columnKey: string) => {
    event.preventDefault();
    event.stopPropagation();

    const initialX = event.clientX;
    const targetColumn = columns.find((column) => column.key === columnKey);
    if (!targetColumn) return;

    setActiveResizeKey(columnKey);
    const initialWidth = targetColumn.width ?? 120;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - initialX;
      const nextWidth = Math.max(80, initialWidth + delta);
      setColumns((prev) => prev.map((column) => (column.key === columnKey ? { ...column, width: nextWidth } : column)));
    };

    const handleMouseUp = () => {
      setActiveResizeKey(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const printColumns = useMemo(
    () => printableColumnsCatalog.filter((column) => printConfig.printColumnKeys.includes(column.key)),
    [printConfig.printColumnKeys, printableColumnsCatalog],
  );

  const saveCurrentPrintSettings = () => {
    localStorage.setItem(PRINT_PRESET_STORAGE_KEY, JSON.stringify(printConfig));
    toast.success('تم حفظ إعدادات الطباعة الحالية بنجاح.');
  };

  const resetPrintSettings = () => {
    const allKeys = printableColumnsCatalog.map((column) => column.key);
    setPrintConfig({ ...DEFAULT_PRINT_CONFIG, printColumnKeys: allKeys });
    localStorage.removeItem(PRINT_PRESET_STORAGE_KEY);
    toast.success('تمت استعادة الإعدادات الافتراضية للطباعة.');
  };

  const selectAllPrintColumns = () => {
    setPrintConfig((prev) => ({ ...prev, printColumnKeys: printableColumnsCatalog.map((column) => column.key) }));
  };

  const deselectAllPrintColumns = () => {
    setPrintConfig((prev) => ({ ...prev, printColumnKeys: [] }));
  };

  const togglePrintColumnKey = (columnKey: string) => {
    setPrintConfig((prev) => {
      if (prev.printColumnKeys.includes(columnKey)) {
        return { ...prev, printColumnKeys: prev.printColumnKeys.filter((key) => key !== columnKey) };
      }
      return { ...prev, printColumnKeys: [...prev.printColumnKeys, columnKey] };
    });
  };

  const ensureRangeReady = () => {
    const error = ensureStatementPrintRange({
      printColumns,
      range: printConfig.range,
      selectedRowsLength: selectedRowsData.length,
    });

    if (error) {
      toast.error(error);
      return false;
    }
    return true;
  };

  const exportExcel = async () => {
    if (!canExport) {
      toast.error('ليس لديك صلاحية لتصدير التقرير.');
      return;
    }
    if (!ensureRangeReady()) return;

    try {
      await exportStatementExcel({ printColumns, printConfig, rowsForOutput, summary, onExport });
    } catch {
      toast.error('تعذر تصدير الملف بصيغة Excel.');
    }
  };

  const runPdfAction = async (mode: 'save' | 'preview') => {
    if (!canExport) {
      toast.error('ليس لديك صلاحية لتصدير التقرير.');
      return;
    }
    if (!ensureRangeReady()) return;

    setPdfStatusMessage('');

    try {
      const message = await runStatementPdfAction({
        mode,
        printPreviewElement: printPreviewRef.current,
        printConfig,
        printColumns,
        previewPages,
        rowsForOutput,
        summary,
        onExport,
      });
      setPdfStatusMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر إنشاء ملف PDF.';
      setPdfStatusMessage(message);
      toast.error(message);
    }
  };

  const exportPdf = async () => {
    await runPdfAction('save');
  };

  const openPrintPanel = () => {
    setPdfStatusMessage('');
    setShowPrintPanel(true);
    setCurrentPreviewPage(1);
  };

  const handlePrintFromPanel = () => {
    if (!ensureRangeReady()) return;
    window.print();
  };

  const inspectRow = (row: StatementRow) => {
    toast.info(`فاتورة المخزن: ${row.warehouseInvoice}`);
  };

  return (
    <div className="animate-in fade-in space-y-6 duration-300">
      <StatementPrintPanel
        open={showPrintPanel}
        onClose={() => setShowPrintPanel(false)}
        saveCurrentPrintSettings={saveCurrentPrintSettings}
        resetPrintSettings={resetPrintSettings}
        printConfig={printConfig}
        setPrintConfig={setPrintConfig}
        printableColumnsCatalog={printableColumnsCatalog}
        printColumns={printColumns}
        selectAllPrintColumns={selectAllPrintColumns}
        deselectAllPrintColumns={deselectAllPrintColumns}
        togglePrintColumnKey={togglePrintColumnKey}
        selectedRowsCount={selectedRowsData.length}
        pdfStatusMessage={pdfStatusMessage}
        onPrint={handlePrintFromPanel}
        onExportPdf={() => {
          void exportPdf();
        }}
        onExportExcel={() => {
          void exportExcel();
        }}
        currentPreviewPage={currentPreviewPage}
        setCurrentPreviewPage={setCurrentPreviewPage}
        pagedRowsCount={pagedRows.length}
        previewPages={previewPages}
        previewPaper={previewPaper}
        previewMargin={previewMargin}
        effectivePrintScale={effectivePrintScale}
        isScaleVerySmall={isScaleVerySmall}
        printPreviewRef={printPreviewRef}
        previewTableMeasureRef={previewTableMeasureRef}
        summary={summary}
      />

      <StatementViewContent
        globalSearch={globalSearch}
        setGlobalSearch={setGlobalSearch}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        partnerFilter={partnerFilter}
        setPartnerFilter={setPartnerFilter}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        partnerOptions={partnerOptions}
        selectAllFiltered={selectAllFiltered}
        clearSelection={clearSelection}
        onShowColumnSettings={() => setShowColumnSettings(true)}
        isRowsExpanded={isRowsExpanded}
        onToggleRowsExpanded={() => setIsRowsExpanded((prev) => !prev)}
        onOpenPrintPanel={openPrintPanel}
        showActionsOnPrint={showActionsOnPrint}
        onShowActionsOnPrintChange={setShowActionsOnPrint}
        visibleColumns={visibleColumns}
        sortKey={sortKey}
        sortDirection={sortDirection}
        getColumnStyle={getColumnStyle}
        toggleSort={toggleSort}
        startResize={startResize}
        activeResizeKey={activeResizeKey}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        sortedRows={sortedRows}
        selectedIds={selectedIds}
        toggleRowSelection={toggleRowSelection}
        onInspectRow={inspectRow}
        summary={summary}
        showColumnSettings={showColumnSettings}
        onCloseColumnSettings={() => setShowColumnSettings(false)}
        isForceUnified={isForceUnified}
        columns={columns}
        setColumns={setColumns}
        resetColumns={resetColumns}
        saveColumns={saveColumns}
      />
    </div>
  );
};

export default Statement;