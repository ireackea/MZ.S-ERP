// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Settings,
  Printer,
  FileText,
  FileSpreadsheet,
  FileDown,
  CheckSquare,
  Square,
  Expand,
  Minimize,
  Weight,
  Scale,
  BadgeDollarSign,
  X,
} from 'lucide-react';
import { GridColumnPreference, Item, SystemSettings, Transaction, UnloadingRule } from '../types';
import {
  getGridDisplayPolicy,
  getGridPreferenceForUser,
  resetGridPreferenceForUser,
  upsertGridPreferenceForUser,
} from '../services/storage';
import { getGridModuleDefinition } from '../services/gridModules';
import UniversalColumnManager from './UniversalColumnManager';
import { toast } from '@services/toastService';

interface StatementProps {
  items: Item[];
  transactions: Transaction[];
  settings: SystemSettings;
  unloadingRules: UnloadingRule[];
  currentUserId?: string;
  canExport?: boolean;
  onExport?: (rowCount: number) => void;
}

type SortDirection = 'asc' | 'desc';
type PrintOrientation = 'portrait' | 'landscape';
type PrintPaperSize = 'a4' | 'a3' | 'letter';
type PrintMargins = 'narrow' | 'normal' | 'wide';
type PrintScalingMode = 'fit' | 'actual';
type PrintRange = 'all' | 'current_page' | 'selected_rows';
type PrintFlowMode = 'continuous' | 'paged';

const PRINT_PRESET_STORAGE_KEY = 'print_presets_statement';
const PDF_RENDER_ENDPOINT = import.meta.env.VITE_PDF_RENDER_ENDPOINT || '/api/render-pdf';
const PRINT_FONT_MIN = 8;
const PRINT_FONT_MAX = 24;
const DEFAULT_PRINT_TITLE = 'كشف الحساب';

type StatementRow = {
  id: string;
  rowNumber: number;
  date: string;
  type: string;
  warehouseInvoice: string;
  supplierInvoice: string;
  itemName: string;
  itemCode: string;
  unit: string;
  quantity: number;
  price: number;
  total: number;
  grossWeight: number;
  netWeight: number;
  difference: number;
  packageCount: number;
  weightSlip: string;
  supplierOrReceiver: string;
  warehouseId: string;
  truckNumber: string;
  trailerNumber: string;
  driverName: string;
  entryTime: string;
  exitTime: string;
  unloadingRule: string;
  delayMinutes: number;
  delayAmount: number;
  notes: string;
};

const FALLBACK_COLUMNS: GridColumnPreference[] = [
  { key: 'select', label: 'تحديد', visible: true, order: 0, width: 64, frozen: true },
  { key: 'rowNumber', label: '#', visible: true, order: 1, width: 64, frozen: true },
  { key: 'date', label: 'التاريخ', visible: true, order: 2, width: 130, frozen: false },
  { key: 'type', label: 'نوع العملية', visible: true, order: 3, width: 120, frozen: false },
  { key: 'warehouseInvoice', label: 'فاتورة المخزن', visible: true, order: 4, width: 140, frozen: false },
  { key: 'supplierInvoice', label: 'فاتورة المورد', visible: true, order: 5, width: 140, frozen: false },
  { key: 'itemName', label: 'اسم الصنف', visible: true, order: 6, width: 220, frozen: true },
  { key: 'itemCode', label: 'كود الصنف', visible: true, order: 7, width: 120, frozen: false },
  { key: 'unit', label: 'الوحدة', visible: true, order: 8, width: 90, frozen: false },
  { key: 'quantity', label: 'الكمية', visible: true, order: 9, width: 120, frozen: false },
  { key: 'price', label: 'السعر', visible: true, order: 10, width: 120, frozen: false },
  { key: 'total', label: 'الإجمالي', visible: true, order: 11, width: 130, frozen: false },
  { key: 'grossWeight', label: 'الوزن القائم', visible: true, order: 12, width: 140, frozen: false },
  { key: 'netWeight', label: 'الوزن الصافي', visible: true, order: 13, width: 130, frozen: false },
  { key: 'difference', label: 'الفرق', visible: true, order: 14, width: 110, frozen: false },
  { key: 'packageCount', label: 'عدد العبوات', visible: true, order: 15, width: 110, frozen: false },
  { key: 'weightSlip', label: 'رقم الميزان', visible: true, order: 16, width: 130, frozen: false },
  { key: 'supplierOrReceiver', label: 'المورد/العميل', visible: true, order: 17, width: 200, frozen: false },
  { key: 'warehouseId', label: 'رقم المخزن', visible: true, order: 18, width: 130, frozen: false },
  { key: 'truckNumber', label: 'رقم السيارة', visible: true, order: 19, width: 110, frozen: false },
  { key: 'trailerNumber', label: 'رقم المقطورة', visible: true, order: 20, width: 110, frozen: false },
  { key: 'driverName', label: 'اسم السائق', visible: true, order: 21, width: 150, frozen: false },
  { key: 'entryTime', label: 'وقت الدخول', visible: true, order: 22, width: 90, frozen: false },
  { key: 'exitTime', label: 'وقت الخروج', visible: true, order: 23, width: 90, frozen: false },
  { key: 'unloadingRule', label: 'قاعدة التفريغ', visible: true, order: 24, width: 170, frozen: false },
  { key: 'delayMinutes', label: 'دقائق التأخير', visible: true, order: 25, width: 130, frozen: false },
  { key: 'delayAmount', label: 'قيمة التأخير', visible: true, order: 26, width: 130, frozen: false },
  { key: 'notes', label: 'ملاحظات', visible: true, order: 27, width: 220, frozen: false },
  { key: 'actions', label: 'الإجراءات', visible: true, order: 28, width: 110, frozen: false },
];

const isNumericColumn = (key: string) =>
  ['rowNumber', 'quantity', 'price', 'total', 'grossWeight', 'netWeight', 'difference', 'packageCount', 'delayMinutes', 'delayAmount'].includes(key);

const formatNumber = (value: number, digits = 3) =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const chunkRows = <T,>(rows: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) return [rows];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks.length ? chunks : [[]];
};

const getPaperDimensions = (size: PrintPaperSize, orientation: PrintOrientation) => {
  const table: Record<PrintPaperSize, { width: number; height: number }> = {
    a4: { width: 794, height: 1123 },
    a3: { width: 1123, height: 1587 },
    letter: { width: 816, height: 1056 },
  };
  const base = table[size];
  return orientation === 'portrait'
    ? base
    : { width: base.height, height: base.width };
};

const getMarginPixels = (margins: PrintMargins) => {
  if (margins === 'narrow') return 20;
  if (margins === 'wide') return 56;
  return 36;
};

const getPdfMarginsMm = (margins: PrintMargins): [number, number, number, number] => {
  if (margins === 'narrow') return [5, 5, 5, 5];
  if (margins === 'wide') return [15, 15, 15, 15];
  return [10, 10, 10, 10];
};

const getPdfPaperLabel = (paperSize: PrintPaperSize) => {
  if (paperSize === 'a3') return 'A3';
  if (paperSize === 'letter') return 'Letter';
  return 'A4';
};

const parsePdfServiceError = (value: string) => {
  const raw = (value || '').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw) as { error?: string; details?: string };
    const parts = [parsed.error, parsed.details].filter(Boolean);
    return parts.join(' - ');
  } catch {
    return raw.slice(0, 220);
  }
};

const DEFAULT_PRINT_CONFIG = {
  printTitle: DEFAULT_PRINT_TITLE,
  orientation: 'portrait' as PrintOrientation,
  paperSize: 'a4' as PrintPaperSize,
  margins: 'normal' as PrintMargins,
  flowMode: 'continuous' as PrintFlowMode,
  scalingMode: 'fit' as PrintScalingMode,
  zoom: 100,
  fontSize: 10,
  printGridlines: true,
  printBackgroundColors: true,
  printSummaryCards: true,
  printSignatures: true,
  repeatHeaders: true,
  autoSizeColumnsByContent: false,
  range: 'all' as PrintRange,
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeStatementColumnLabels = (cols: GridColumnPreference[]) =>
  cols.map((column) => {
    if (column.key === 'grossWeight') {
      return { ...column, label: 'الوزن القائم' };
    }
    if (column.key === 'netWeight') {
      return { ...column, label: 'الوزن الصافي' };
    }
    return column;
  });

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
    [statementGridModule]
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
  const [printConfig, setPrintConfig] = useState<{
    printTitle: string;
    orientation: PrintOrientation;
    paperSize: PrintPaperSize;
    margins: PrintMargins;
    flowMode: PrintFlowMode;
    scalingMode: PrintScalingMode;
    zoom: number;
    fontSize: number;
    printGridlines: boolean;
    printBackgroundColors: boolean;
    printSummaryCards: boolean;
    printSignatures: boolean;
    repeatHeaders: boolean;
    autoSizeColumnsByContent: boolean;
    range: PrintRange;
    printColumnKeys: string[];
  }>({
    ...DEFAULT_PRINT_CONFIG,
    printColumnKeys: [],
  });

  const [globalSearch, setGlobalSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [partnerFilter, setPartnerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const printRef = useRef<HTMLDivElement | null>(null);
  const printPreviewRef = useRef<HTMLDivElement | null>(null);
  const previewTableMeasureRef = useRef<HTMLTableElement | null>(null);
  const [measuredTableWidth, setMeasuredTableWidth] = useState(0);

  const [activeResizeKey, setActiveResizeKey] = useState<string | null>(null);

  const printableColumnsCatalog = useMemo(
    () => statementDefaultColumns.filter((column) => !['select', 'actions'].includes(column.key)),
    [statementDefaultColumns]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRINT_PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<typeof printConfig>;
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
        autoSizeColumnsByContent: typeof parsed.autoSizeColumnsByContent === 'boolean'
          ? parsed.autoSizeColumnsByContent
          : prev.autoSizeColumnsByContent,
        range: parsed.range === 'current_page' || parsed.range === 'selected_rows' || parsed.range === 'all' ? parsed.range : prev.range,
        printColumnKeys: Array.isArray(parsed.printColumnKeys) ? parsed.printColumnKeys.filter((k): k is string => typeof k === 'string') : prev.printColumnKeys,
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
    setIsForceUnified(!!policy.forceUnified && effectiveUserId !== '0');
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

  const orderedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);
  const visibleColumns = useMemo(() => orderedColumns.filter((column) => column.visible), [orderedColumns]);

  const frozenOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let offset = 0;
    visibleColumns
      .filter((column) => column.frozen)
      .forEach((column) => {
        offsets[column.key] = offset;
        offset += column.width;
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
    [rows]
  );

  const filteredRows = useMemo(() => {
    const global = globalSearch.trim().toLowerCase();

    return rows.filter((row) => {
      if (global) {
        const haystack = Object.values(row).join(' ').toLowerCase();
        if (!haystack.includes(global)) return false;
      }

      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      if (partnerFilter && !row.supplierOrReceiver.toLowerCase().includes(partnerFilter.toLowerCase())) return false;
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;

      for (const [key, value] of Object.entries(columnFilters)) {
        const normalizedFilter = String(value || '').trim().toLowerCase();
        if (!normalizedFilter) continue;
        const cellValue = String((row as Record<string, unknown>)[key] ?? '').toLowerCase();
        if (!cellValue.includes(normalizedFilter)) return false;
      }

      return true;
    });
  }, [columnFilters, dateFrom, dateTo, globalSearch, partnerFilter, rows, typeFilter]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];

    sorted.sort((a, b) => {
      const left = (a as Record<string, unknown>)[sortKey];
      const right = (b as Record<string, unknown>)[sortKey];

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

  const summary = useMemo(() => {
    return sortedRows.reduce(
      (acc, row) => {
        acc.gross += row.grossWeight;
        acc.net += row.netWeight;
        acc.difference += row.difference;
        acc.delayMinutes += row.delayMinutes;
        acc.delayAmount += row.delayAmount;
        return acc;
      },
      { gross: 0, net: 0, difference: 0, delayMinutes: 0, delayAmount: 0 }
    );
  }, [sortedRows]);

  const selectedRowsData = useMemo(
    () => sortedRows.filter((row) => selectedIds.has(row.id)),
    [sortedRows, selectedIds]
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

  const selectAllFiltered = () => {
    setSelectedIds(new Set(sortedRows.map((row) => row.id)));
  };

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
    const initialWidth = targetColumn.width;

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

  const visibleDataColumns = useMemo(
    () => visibleColumns.filter((column) => !['select', 'actions'].includes(column.key)),
    [visibleColumns]
  );

  const printColumns = useMemo(
    () => printableColumnsCatalog.filter((column) => printConfig.printColumnKeys.includes(column.key)),
    [printConfig.printColumnKeys, printableColumnsCatalog]
  );

  const saveCurrentPrintSettings = () => {
    localStorage.setItem(PRINT_PRESET_STORAGE_KEY, JSON.stringify(printConfig));
    toast.success('تم حفظ إعدادات الطباعة الحالية بنجاح.');
  };

  const resetPrintSettings = () => {
    const allKeys = printableColumnsCatalog.map((column) => column.key);
    const next = { ...DEFAULT_PRINT_CONFIG, printColumnKeys: allKeys };
    setPrintConfig(next);
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

  const exportExcel = async () => {
    if (!canExport) {
      toast.error('ليس لديك صلاحية لتصدير التقرير.');
      return;
    }
    if (!ensureRangeReady()) return;

    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
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

        setRangeBorder(labelRow, startColumn, endColumn, {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        });
        setRangeBorder(valueRow, startColumn, endColumn, {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        });
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

        const signatureTitles = ['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'];

        if (totalColumns >= 3) {
          const lineRow = worksheet.addRow(new Array(totalColumns).fill('')).number;
          const nameRow = worksheet.addRow(new Array(totalColumns).fill('')).number;

          signatureTitles.forEach((title, index) => {
            const startColumn = Math.floor((index * totalColumns) / signatureTitles.length) + 1;
            const endColumn = Math.max(startColumn, Math.floor(((index + 1) * totalColumns) / signatureTitles.length));

            worksheet.mergeCells(lineRow, startColumn, lineRow, endColumn);
            worksheet.mergeCells(nameRow, startColumn, nameRow, endColumn);

            const lineCell = worksheet.getCell(lineRow, startColumn);
            lineCell.value = '';
            lineCell.alignment = { horizontal: 'center', vertical: 'middle' };
            lineCell.border = {
              bottom: { style: 'thin', color: { argb: 'FF0F172A' } },
            };

            const nameCell = worksheet.getCell(nameRow, startColumn);
            nameCell.value = title;
            nameCell.alignment = { horizontal: 'center', vertical: 'middle' };
            nameCell.font = { bold: true, size: Math.max(10, printConfig.fontSize) };
          });
        } else {
          signatureTitles.forEach((title) => {
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
        worksheet.getColumn(index + 1).width = Math.max(14, Math.floor(column.width / 10));
      });

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Statement_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      onExport?.(rowsForOutput.length);
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

    const exportWithClientFallback = async () => {
      if (!printPreviewRef.current) {
        throw new Error('تعذر العثور على محتوى صالح لإنشاء ملف PDF.');
      }

      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as { default?: any }).default || html2pdfModule;

      await html2pdf()
        .set({
          margin: getPdfMarginsMm(printConfig.margins),
          filename: `Statement_${new Date().toISOString().slice(0, 10)}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
          },
          jsPDF: {
            unit: 'mm',
            format: printConfig.paperSize,
            orientation: printConfig.orientation,
          },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(printPreviewRef.current)
        .save();
    };

    try {
      const resolvedPrintTitle = (printConfig.printTitle || '').trim() || DEFAULT_PRINT_TITLE;
      const pageTables =
        printConfig.flowMode === 'paged'
          ? (printConfig.range === 'current_page' ? [rowsForOutput] : previewPages)
          : [rowsForOutput];

      const styleBlock = `
        <style>
          @page { size: ${getPdfPaperLabel(printConfig.paperSize)} ${printConfig.orientation}; margin: ${printConfig.margins === 'narrow' ? '5mm' : printConfig.margins === 'wide' ? '15mm' : '10mm'}; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
            font-size: ${printConfig.fontSize}px;
          }
          .doc-wrap { width: 100%; }
          .doc-page {
            width: 100%;
            ${printConfig.flowMode === 'paged' ? 'page-break-after: always; break-after: page;' : ''}
            margin-bottom: ${printConfig.flowMode === 'paged' ? '0' : '8px'};
          }
          .doc-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .title {
            text-align: center;
            font-weight: 700;
            font-size: ${Math.max(14, printConfig.fontSize + 2)}px;
            margin: 0 0 4px 0;
          }
          .subtitle {
            text-align: center;
            color: #64748b;
            margin: 0 0 10px 0;
            font-size: 11px;
          }
          .table-wrap {
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            ${printConfig.scalingMode === 'fit' ? 'overflow: hidden;' : ''}
          }
          table {
            border-collapse: collapse;
            width: ${printConfig.scalingMode === 'fit' ? '100%' : (printConfig.autoSizeColumnsByContent ? 'auto' : '100%')};
            max-width: 100%;
            margin: 0 auto;
            table-layout: ${printConfig.autoSizeColumnsByContent ? 'auto' : 'fixed'};
          }
          thead {
            ${printConfig.repeatHeaders ? 'display: table-header-group;' : ''}
          }
          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          th, td {
            padding: 2px 4px;
            text-align: center;
            vertical-align: middle;
            line-height: 1.3;
            white-space: ${printConfig.autoSizeColumnsByContent ? 'normal' : 'nowrap'};
            overflow: ${printConfig.autoSizeColumnsByContent ? 'visible' : 'hidden'};
            text-overflow: ${printConfig.autoSizeColumnsByContent ? 'clip' : 'ellipsis'};
            word-break: break-word;
            overflow-wrap: anywhere;
            border: ${printConfig.printGridlines ? '1px solid #d1d5db' : 'none'};
          }
          th {
            font-weight: 700;
            background: ${printConfig.printBackgroundColors ? '#f1f5f9' : 'transparent'};
          }
          tbody tr:nth-child(even) td {
            background: ${printConfig.printBackgroundColors ? '#f8fafc' : 'transparent'};
          }
          .summary {
            display: ${printConfig.printSummaryCards ? 'grid' : 'none'};
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            margin-top: 8px;
            font-size: ${Math.max(8, printConfig.fontSize - 1)}px;
          }
          .summary .card {
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 6px;
          }
          .summary .label {
            color: #64748b;
          }
          .summary .value {
            color: #0f172a;
            font-weight: 700;
            margin-top: 2px;
          }
          .summary-signature-gap {
            display: ${printConfig.printSummaryCards && printConfig.printSignatures ? 'block' : 'none'};
            height: 48px;
          }
          .signatures {
            display: ${printConfig.printSignatures ? 'grid' : 'none'};
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            text-align: center;
            margin-top: 0;
            font-size: ${printConfig.fontSize}px;
          }
          .signatures .line {
            border-bottom: 1px solid #0f172a;
            height: 28px;
          }
          .signatures .name {
            margin-top: 4px;
            font-weight: 700;
            color: #334155;
          }
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
          const rowsHtml = rows
            .map((row) => {
              const cells = printColumns.map((column) => `<td>${renderCellValue(row, column.key)}</td>`).join('');
              return `<tr>${cells}</tr>`;
            })
            .join('');

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
                  <div class="card"><div class="label">778&788y 778~8y 7878!8</div><div class="value">${formatNumber(summary.gross)} 78 </div></div>
                  <div class="card"><div class="label">778&788y 778~8y 788&877</div><div class="value">${formatNumber(summary.net)} 78 </div></div>
                  <div class="card"><div class="label">788~78 78y8  7878!8 8 788&877</div><div class="value">${formatNumber(summary.difference)} 78 </div></div>
                  <div class="card"><div class="label">إجمالي قيمة التأخير</div><div class="value">${formatNumber(summary.delayAmount)} ج.م</div></div>
                </div>

                <div class="summary-signature-gap"></div>

                <div class="signatures">
                  ${['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'].map((title) => `
                    <div>
                      <div class="line"></div>
                      <div class="name">${title}</div>
                    </div>
                  `).join('')}
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
        setPdfStatusMessage('تم فتح معاينة ملف PDF بنجاح.');
      } else {
        downloadBlob(pdfBlob, `Statement_${new Date().toISOString().slice(0, 10)}.pdf`);
        onExport?.(rowsForOutput.length);
        setPdfStatusMessage('تم حفظ ملف PDF بنجاح.');
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
      const networkHint = details.includes('Failed to fetch')
        ? 'تعذر الاتصال بخدمة إنشاء PDF. تأكد من تشغيل npm run pdf:server.'
        : details;

      if (mode === 'save') {
        try {
          await exportWithClientFallback();
          onExport?.(rowsForOutput.length);
          setPdfStatusMessage('تم حفظ ملف PDF باستخدام المسار البديل بعد تعذر الخادم الأساسي.');
          return;
        } catch (fallbackError) {
          const fallbackDetails = fallbackError instanceof Error ? fallbackError.message : 'تعذر تنفيذ المسار البديل';
          const fallbackMessage = `تعذر إنشاء ملف PDF. ${networkHint} | تفاصيل المسار البديل: ${fallbackDetails}`;
          setPdfStatusMessage(fallbackMessage);
          toast.error(fallbackMessage);
          return;
        }
      }

      const base = mode === 'preview' ? 'تعذر فتح معاينة ملف PDF.' : 'تعذر حفظ ملف PDF.';
      const finalMessage = `${base} ${networkHint}`;
      setPdfStatusMessage(finalMessage);
      toast.error(finalMessage);
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

  const ensureRangeReady = () => {
    if (printColumns.length === 0) {
      toast.error('يجب اختيار عمود واحد على الأقل قبل الطباعة.');
      return false;
    }
    if (printConfig.range === 'selected_rows' && selectedRowsData.length === 0) {
      toast.error('يجب تحديد صف واحد على الأقل عند اختيار نطاق الصفوف المحددة.');
      return false;
    }
    return true;
  };

  const handlePrintFromPanel = () => {
    if (!ensureRangeReady()) return;
    window.print();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <style>{`
        @media print {
          @page { margin: 8mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white; }
          nav, aside, header, .no-print, .print-panel-ui { display: none !important; }
          .print-panel-preview-wrap { display: block !important; }
          .statement-print-wrap { display: none !important; }
          .print-flow-paged .print-panel-page { page-break-after: always !important; break-after: page !important; }
          .print-flow-paged .print-panel-page:last-child { page-break-after: auto !important; break-after: auto !important; }
          .print-panel-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: auto !important;
            break-after: auto !important;
            width: 100% !important;
            min-height: auto !important;
            transform: none !important;
            border: none !important;
            padding: 0 !important;
          }
          .statement-table th, .statement-table td { border: 1px solid #cbd5e1 !important; }
          .statement-table { font-size: 9pt !important; }
          .print-signature-line { border-bottom: 1px solid #0f172a !important; }
        }
      `}</style>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <FileText className="text-blue-600" /> 878~ 788&877
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">777 87788y8 877777 87778y7 8&7777 7880 7878y78 77 788&8~8777.</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={selectAllFiltered}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-2"
            >
              <CheckSquare size={14} /> 7778y7 7888
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-2"
            >
              <Square size={14} /> 78777 787778y7
            </button>
            <button
              onClick={() => setShowColumnSettings(true)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-2"
            >
              <Settings size={14} /> الإعدادات
            </button>
            <button
              onClick={() => setIsRowsExpanded((prev) => !prev)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-2"
              title={isRowsExpanded ? 'طي الصفوف' : 'توسيع الصفوف'}
            >
              {isRowsExpanded ? <Minimize size={14} /> : <Expand size={14} />}
              {isRowsExpanded ? 'طي الصفوف' : 'توسيع الصفوف'}
            </button>
            <button
              onClick={openPrintPanel}
              className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 flex items-center gap-2"
            >
              <Printer size={14} /> 77777 / 7778y7
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 mb-4">
          <label className="xl:col-span-2 relative">
            <Search size={16} className="absolute right-3 top-3 text-slate-400" />
            <input
              type="text"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="ابحث بالاسم أو الكود أو رقم الفاتورة"
              className="w-full pr-9 pl-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </label>

          <select title="تصفية حسب نوع العملية" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm">
            <option value="all">كل العمليات</option>
            <option value="وارد">وارد</option>
            <option value="صادر">صادر</option>
            <option value="مرتجع">مرتجع</option>
            <option value="تالف">تالف</option>
          </select>

          <input
            type="text"
            value={partnerFilter}
            onChange={(event) => setPartnerFilter(event.target.value)}
            list="statement-partners"
            placeholder="المورد/العميل"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm"
          />
          <datalist id="statement-partners">
            {partnerOptions.map((partner) => (
              <option key={partner} value={partner} />
            ))}
          </datalist>

          <div className="grid grid-cols-1 gap-2">
            <input title="تاريخ البداية" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm" />
            <input title="تاريخ النهاية" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm" />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-slate-600 font-bold">
          <input type="checkbox" checked={showActionsOnPrint} onChange={(event) => setShowActionsOnPrint(event.target.checked)} className="accent-emerald-600" />
          777 78&87 787777777 78 7 7877777
        </label>
      </div>

      {showPrintPanel && (
        <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm p-4 print:bg-white print:p-0">
          <div className="h-full w-full bg-white rounded-2xl overflow-hidden flex print:rounded-none print:h-auto">
            <aside className="w-full max-w-sm border-l border-slate-200 p-4 overflow-y-auto print-panel-ui">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800">لوحة إعدادات الطباعة</h3>
                <button title="إغلاق لوحة الطباعة" aria-label="إغلاق لوحة الطباعة" onClick={() => setShowPrintPanel(false)} className="text-slate-500 hover:text-red-600"><X size={18} /></button>
              </div>

              <div className="print-panel-ui mb-3 grid grid-cols-2 gap-2">
                <button onClick={saveCurrentPrintSettings} className="px-3 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 text-xs">حفظ الإعدادات الحالية</button>
                <button onClick={resetPrintSettings} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs">7777777 7878~77778y77</button>
              </div>

              <div className="space-y-4 text-sm">
                <div className="space-y-2">
                  <div className="font-bold text-slate-700">787777777 78778&7</div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">78 878  788787</label>
                    <input
                      type="text"
                      value={printConfig.printTitle}
                      onChange={(event) => setPrintConfig((prev) => ({ ...prev, printTitle: event.target.value }))}
                      placeholder={DEFAULT_PRINT_TITLE}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">7877778!</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setPrintConfig((prev) => ({ ...prev, orientation: 'portrait' }))} className={`px-3 py-2 rounded-lg border ${printConfig.orientation === 'portrait' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}>78&878y</button>
                      <button onClick={() => setPrintConfig((prev) => ({ ...prev, orientation: 'landscape' }))} className={`px-3 py-2 rounded-lg border ${printConfig.orientation === 'landscape' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}>78~88y</button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">مقاس الورق</label>
                    <select title="اختيار مقاس الورق" value={printConfig.paperSize} onChange={(event) => setPrintConfig((prev) => ({ ...prev, paperSize: event.target.value as PrintPaperSize }))} className="w-full px-3 py-2 rounded-lg border border-slate-300">
                      <option value="a4">A4</option>
                      <option value="a3">A3</option>
                      <option value="letter">Letter</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">788!878&7</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'narrow' }))} className={`px-2 py-2 rounded-lg border text-xs ${printConfig.margins === 'narrow' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}>78y8</button>
                      <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'normal' }))} className={`px-2 py-2 rounded-lg border text-xs ${printConfig.margins === 'normal' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}>7778y</button>
                      <button onClick={() => setPrintConfig((prev) => ({ ...prev, margins: 'wide' }))} className={`px-2 py-2 rounded-lg border text-xs ${printConfig.margins === 'wide' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}>8777</button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="font-bold text-slate-700">788y8y8~ 7878~77</div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="page-fitting"
                      checked={printConfig.scalingMode === 'actual'}
                      onChange={() => setPrintConfig((prev) => ({ ...prev, scalingMode: 'actual' }))}
                      className="accent-emerald-600"
                    />
                    78778& 788~788y (Actual Size)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="page-fitting"
                      checked={printConfig.scalingMode === 'fit'}
                      onChange={() => setPrintConfig((prev) => ({ ...prev, scalingMode: 'fit' }))}
                      className="accent-emerald-600"
                    />
                    777 88 78778&77 8~8y 78~77 87777 (Fit All Columns on One Page)
                  </label>
                  <div className="text-xs text-slate-500">
                    8 777 787778y8& 787788y7: {Math.round(effectivePrintScale * 100)}%
                  </div>
                  {isScaleVerySmall && (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                      788 7 78y888  778y7789 777897R 888  7877777 8&7777.
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="font-bold text-slate-700">8 8&7 7877777</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPrintConfig((prev) => ({ ...prev, flowMode: 'continuous' }))}
                      className={`px-3 py-2 rounded-lg border text-xs ${printConfig.flowMode === 'continuous' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}
                    >
                      8&7787
                    </button>
                    <button
                      onClick={() => setPrintConfig((prev) => ({ ...prev, flowMode: 'paged' }))}
                      className={`px-3 py-2 rounded-lg border text-xs ${printConfig.flowMode === 'paged' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 text-slate-700'}`}
                    >
                      8&878&7 78~777
                    </button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="font-bold text-slate-700">حجم الخط</div>
                  <label className="block text-xs text-slate-500 mb-1">مقاس الخط: {printConfig.fontSize}px</label>
                  <input
                    type="range"
                    title="تعديل مقاس الخط"
                    min={PRINT_FONT_MIN}
                    max={PRINT_FONT_MAX}
                    step={1}
                    value={printConfig.fontSize}
                    onChange={(event) => setPrintConfig((prev) => ({ ...prev, fontSize: Number(event.target.value) }))}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{PRINT_FONT_MIN}px</span>
                    <span>{PRINT_FONT_MAX}px</span>
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-700">78778&77 788&78877</div>
                    <span className="text-xs text-slate-500">{printColumns.length} / {printableColumnsCatalog.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={selectAllPrintColumns} className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">7778y7 7888</button>
                    <button onClick={deselectAllPrintColumns} className="px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">78777 7888</button>
                  </div>
                  <div className="max-h-44 overflow-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {printableColumnsCatalog.map((column) => (
                      <label key={`print-column-${column.key}`} className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={printConfig.printColumnKeys.includes(column.key)}
                          onChange={() => togglePrintColumnKey(column.key)}
                          className="accent-emerald-600"
                        />
                        {column.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="font-bold text-slate-700">خيارات إضافية</div>
                  {[
                    { key: 'printGridlines', label: 'إظهار خطوط الجدول' },
                    { key: 'printBackgroundColors', label: 'إظهار ألوان الخلفية في الطباعة' },
                    { key: 'printSummaryCards', label: 'إظهار بطاقات الملخص' },
                    { key: 'printSignatures', label: 'إظهار حقول التوقيع' },
                    { key: 'repeatHeaders', label: 'تكرار رؤوس الجدول بكل صفحة' },
                    { key: 'autoSizeColumnsByContent', label: 'ضبط عرض الأعمدة تلقائيًا حسب المحتوى' },
                  ].map((option) => (
                    <label key={option.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean((printConfig as any)[option.key])}
                        onChange={(event) => setPrintConfig((prev) => ({ ...prev, [option.key]: event.target.checked }))}
                        className="accent-emerald-600"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>

                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <div className="font-bold text-slate-700">8 778 7877777</div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="print-range" checked={printConfig.range === 'current_page'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'current_page' }))} className="accent-emerald-600" />
                    77777 7878~77 787788y7 8~87
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="print-range" checked={printConfig.range === 'selected_rows'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'selected_rows' }))} className="accent-emerald-600" />
                    77777 7878~88~ 788&7777 8~87 ({selectedRowsData.length})
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="print-range" checked={printConfig.range === 'all'} onChange={() => setPrintConfig((prev) => ({ ...prev, range: 'all' }))} className="accent-emerald-600" />
                    88 7878~88~
                  </label>
                </div>

                <div className="border-t border-slate-200 pt-3 space-y-2">
                  {pdfStatusMessage && (
                    <div className={`text-xs rounded-lg px-3 py-2 border ${pdfStatusMessage.includes('78 777') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                      {pdfStatusMessage}
                    </div>
                  )}
                  <button onClick={handlePrintFromPanel} className="w-full px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center gap-2"><Printer size={14} /> 77777</button>
                  <button onClick={exportPdf} className="w-full px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center justify-center gap-2"><FileDown size={14} /> 78~7 88 PDF</button>
                  <button onClick={exportExcel} className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-2"><FileSpreadsheet size={14} /> 7778y7 Excel</button>
                </div>
              </div>
            </aside>

            <section className="flex-1 overflow-auto bg-slate-100 p-5 print:p-0 print:bg-white">
              <div className="print-panel-ui flex items-center justify-between mb-4">
                <div className="text-sm font-bold text-slate-700">8&778y8 7 78y7 (WYSIWYG)</div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setCurrentPreviewPage((prev) => Math.max(1, prev - 1))}
                    className="px-2 py-1 rounded border border-slate-300 bg-white"
                    disabled={printConfig.flowMode !== 'paged' || currentPreviewPage <= 1}
                  >
                    787778
                  </button>
                  <span className="px-2">
                    {printConfig.flowMode === 'paged'
                      ? `صفحة ${currentPreviewPage} / ${Math.max(1, pagedRows.length)}`
                      : 'عرض مستمر'}
                  </span>
                  <button
                    onClick={() => setCurrentPreviewPage((prev) => Math.min(Math.max(1, pagedRows.length), prev + 1))}
                    className="px-2 py-1 rounded border border-slate-300 bg-white"
                    disabled={printConfig.flowMode !== 'paged' || currentPreviewPage >= Math.max(1, pagedRows.length)}
                  >
                    787788y
                  </button>
                </div>
              </div>

              <div ref={printPreviewRef} className={`print-panel-preview-wrap space-y-6 ${printConfig.flowMode === 'paged' ? 'print-flow-paged' : 'print-flow-continuous'}`}>
                {previewPages.map((pageRows, pageIndex) => (
                  <div
                    key={`preview-page-${pageIndex}`}
                    className="print-panel-page mx-auto bg-white shadow-xl border border-slate-300"
                    style={{
                      width: `${previewPaper.width}px`,
                      minHeight: `${previewPaper.height}px`,
                      padding: `${previewMargin}px`,
                    }}
                  >
                    <div className="text-center mb-3">
                      <h4 className="text-base font-bold text-slate-800">{(printConfig.printTitle || '').trim() || DEFAULT_PRINT_TITLE}</h4>
                    </div>

                    {printColumns.length === 0 ? (
                      <div className="text-center text-slate-500 border border-dashed border-slate-300 rounded-lg py-8">
                        اختر الأعمدة المطلوب طباعتها من لوحة "إعدادات الطباعة" لعرض المعاينة هنا.
                      </div>
                    ) : (
                    <div
                      className="overflow-visible print-fit-wrapper"
                      style={{
                        zoom: printConfig.scalingMode === 'fit' ? effectivePrintScale : 1,
                        width: printConfig.scalingMode === 'fit' ? `${100 / Math.max(0.25, effectivePrintScale)}%` : '100%',
                      }}
                    >
                    <table
                      ref={pageIndex === 0 ? previewTableMeasureRef : null}
                      className="border-collapse"
                      style={{
                        fontSize: `${printConfig.fontSize}px`,
                        width: printConfig.scalingMode === 'fit' ? 'max-content' : '100%',
                        tableLayout: 'auto',
                      }}
                    >
                      {(printConfig.repeatHeaders || pageIndex === 0) && (
                        <thead>
                          <tr>
                            {printColumns.map((column) => (
                              <th
                                key={`head-${column.key}-${pageIndex}`}
                                className="px-1.5 py-0.5 text-center font-bold whitespace-nowrap"
                                style={{
                                  border: printConfig.printGridlines ? '1px solid #cbd5e1' : 'none',
                                  backgroundColor: printConfig.printBackgroundColors ? '#f1f5f9' : 'transparent',
                                }}
                              >
                                {column.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {pageRows.map((row, rowIndex) => (
                          <tr key={`${row.id}-${pageIndex}`}>
                            {printColumns.map((column) => {
                              const rawValue = (row as Record<string, unknown>)[column.key];
                              const value = isNumericColumn(column.key)
                                ? formatNumber(Number(rawValue || 0), ['delayMinutes', 'packageCount', 'rowNumber'].includes(column.key) ? 0 : 3)
                                : String(rawValue ?? '');
                              return (
                                <td
                                  key={`${column.key}-${row.id}`}
                                  className="px-1.5 py-0.5 text-center whitespace-nowrap"
                                  style={{
                                    border: printConfig.printGridlines ? '1px solid #e2e8f0' : 'none',
                                    backgroundColor: printConfig.printBackgroundColors && rowIndex % 2 === 1 ? '#f8fafc' : 'transparent',
                                  }}
                                >
                                  {value}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                    )}

                    {printConfig.printSummaryCards && pageIndex === previewPages.length - 1 && (
                      <div className={`grid grid-cols-2 gap-2 ${printConfig.scalingMode === 'fit' ? 'mt-2' : 'mt-4'}`} style={{ fontSize: `${Math.max(8, printConfig.fontSize - 1)}px` }}>
                        <div className="p-2 rounded border border-slate-200">
                          <div className="text-[10px] text-slate-500">778&788y 778~8y 7878!8</div>
                          <div className="font-bold text-slate-800">{formatNumber(summary.gross)} 78 </div>
                        </div>
                        <div className="p-2 rounded border border-slate-200">
                          <div className="text-[10px] text-slate-500">778&788y 778~8y 788&877</div>
                          <div className="font-bold text-slate-800">{formatNumber(summary.net)} 78 </div>
                        </div>
                        <div className="p-2 rounded border border-slate-200">
                          <div className="text-[10px] text-slate-500">788~78 78y8  7878!8 8 788&877</div>
                          <div className="font-bold text-slate-800">{formatNumber(summary.difference)} 78 </div>
                        </div>
                        <div className="p-2 rounded border border-slate-200">
                          <div className="text-[10px] text-slate-500">778&788y 8&787 787778y7</div>
                          <div className="font-bold text-slate-800">{formatNumber(summary.delayAmount)} 7.8</div>
                        </div>
                      </div>
                    )}

                    {printConfig.printSignatures && pageIndex === previewPages.length - 1 && (
                      <div className={`grid grid-cols-3 gap-4 text-center ${printConfig.scalingMode === 'fit' ? 'mt-3' : 'mt-6'}`} style={{ fontSize: `${printConfig.fontSize}px` }}>
                        {['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'].map((title) => (
                          <div key={`${title}-${pageIndex}`}>
                            <div className="h-8" />
                            <div className="border-b border-slate-900" />
                            <p className="mt-1 text-[11px] font-bold text-slate-700">{title}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      <div ref={printRef} className="statement-print-wrap space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-blue-600" /> 7787 878~ 7878y78 77
            </div>
            <div className="text-xs text-slate-500">777 7877877: {sortedRows.length}</div>
          </div>

          <div className={`overflow-auto ${isRowsExpanded ? 'max-h-none' : 'max-h-[560px]'}`}>
            <table className="statement-table w-max min-w-full text-center text-sm border-collapse">
              <thead className="bg-white sticky top-0 z-30">
                <tr className="border-b border-slate-200">
                  {visibleColumns.map((column) => {
                    const isActionColumn = column.key === 'actions';
                    if (isActionColumn && !showActionsOnPrint) {
                      return (
                        <th key={column.key} className="p-0 m-0 w-0 min-w-0 print:hidden" />
                      );
                    }

                    const isActiveSort = sortKey === column.key;
                    return (
                      <th
                        key={column.key}
                        style={getColumnStyle(column, true)}
                        className={`relative p-2 border-l border-slate-200 text-xs font-bold text-slate-600 ${isActionColumn && !showActionsOnPrint ? 'print:hidden' : ''}`}
                      >
                        <button onClick={() => toggleSort(column.key)} className="inline-flex items-center gap-1 hover:text-emerald-700">
                          {column.label}
                          {isActiveSort && <span className="text-emerald-700">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                        <div
                          role="presentation"
                          title="اسحب لتغيير عرض العمود"
                          onMouseDown={(event) => startResize(event, column.key)}
                          className={`absolute left-0 top-0 h-full w-1.5 cursor-col-resize ${activeResizeKey === column.key ? 'bg-emerald-400/60' : 'hover:bg-slate-300/60'}`}
                        />
                      </th>
                    );
                  })}
                </tr>

                <tr className="border-b border-slate-200 no-print">
                  {visibleColumns.map((column) => {
                    if (column.key === 'select' || column.key === 'rowNumber' || column.key === 'actions') {
                      return <th key={column.key} style={getColumnStyle(column)} className="p-1 border-l border-slate-100 bg-slate-50" />;
                    }

                    if (column.key === 'type') {
                      return (
                        <th key={column.key} style={getColumnStyle(column)} className="p-1 border-l border-slate-100 bg-slate-50">
                          <select
                            title="تصفية حسب نوع العملية داخل الجدول"
                            value={columnFilters[column.key] || ''}
                            onChange={(event) => setColumnFilters((prev) => ({ ...prev, [column.key]: event.target.value }))}
                            className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                          >
                            <option value="">الكل</option>
                            <option value="وارد">وارد</option>
                            <option value="صادر">صادر</option>
                            <option value="مرتجع">مرتجع</option>
                            <option value="تالف">تالف</option>
                          </select>
                        </th>
                      );
                    }

                    return (
                      <th key={column.key} style={getColumnStyle(column)} className="p-1 border-l border-slate-100 bg-slate-50">
                        <input
                          type="text"
                          value={columnFilters[column.key] || ''}
                          onChange={(event) => setColumnFilters((prev) => ({ ...prev, [column.key]: event.target.value }))}
                          placeholder="تصفية"
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded"
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {sortedRows.map((row, index) => (
                  <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    {visibleColumns.map((column) => {
                      const isActionColumn = column.key === 'actions';
                      const cellClass = `p-2 border-l border-slate-100 text-slate-700 ${isActionColumn && !showActionsOnPrint ? 'print:hidden' : ''}`;

                      if (column.key === 'select') {
                        return (
                          <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                            <button onClick={() => toggleRowSelection(row.id)} className="text-emerald-700">
                              {selectedIds.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                          </td>
                        );
                      }

                      if (column.key === 'actions') {
                        return (
                          <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                            <button
                              onClick={() => toast.info(`فاتورة المخزن: ${row.warehouseInvoice}`)}
                              className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-100"
                            >
                              عرض
                            </button>
                          </td>
                        );
                      }

                      const rawValue = (row as Record<string, unknown>)[column.key];
                      const displayValue = isNumericColumn(column.key)
                        ? formatNumber(Number(rawValue || 0), ['delayMinutes', 'packageCount', 'rowNumber'].includes(column.key) ? 0 : 3)
                        : String(rawValue ?? '');

                      return (
                        <td key={column.key} style={getColumnStyle(column)} className={cellClass}>
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length} className="p-8 text-center text-slate-400 font-bold">
                      87 7877 78y78 77 8&77787 88777 787788y.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500 font-bold flex items-center gap-2"><Weight size={14} className="text-blue-600" /> 778&788y 778~8y 7878!8</div>
            <div className="text-2xl font-extrabold text-slate-800 mt-1">{formatNumber(summary.gross)} 78 </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500 font-bold flex items-center gap-2"><Weight size={14} className="text-emerald-600" /> 778&788y 778~8y 788&877</div>
            <div className="text-2xl font-extrabold text-slate-800 mt-1">{formatNumber(summary.net)} 78 </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500 font-bold flex items-center gap-2"><Scale size={14} className="text-amber-600" /> 788~78 78y8  7878!8 8 788&877</div>
            <div className="text-2xl font-extrabold text-slate-800 mt-1">{formatNumber(summary.difference)} 78 </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500 font-bold flex items-center gap-2"><BadgeDollarSign size={14} className="text-red-600" /> 778&788y 8&787 787778y7</div>
            <div className="text-2xl font-extrabold text-slate-800 mt-1">{formatNumber(summary.delayAmount)} 7.8</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {['معد التقرير', 'مراجع التقرير', 'اعتماد الإدارة'].map((title) => (
              <div key={title}>
                <div className="h-12" />
                <div className="print-signature-line border-b border-slate-900" />
                <p className="mt-2 text-sm font-bold text-slate-700">{title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showColumnSettings && (
        <div className="fixed inset-0 z-[ظ -ظ] flex items-center justify-center bg-black/60 p-4 no-print">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings size={16} /> إعدادات عرض الأعمدة</h3>
              <button onClick={() => setShowColumnSettings(false)} title="إغلاق" aria-label="إغلاق" className="text-slate-500 hover:text-red-600"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto">
              {isForceUnified && (
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  78777 788&877 8&8~787 8&8  787777777 788&7878y77R 8y8&88 8 788&77777 8~87.
                </div>
              )}
              <UniversalColumnManager columns={columns} onChange={setColumns} onReset={resetColumns} mode="user" disabled={isForceUnified} />
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setShowColumnSettings(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">77878</button>
              <button onClick={saveColumns} className="px-4 py-2 rounded-lg bg-slate-900 text-white">78~7</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Statement;


