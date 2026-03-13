// ENTERPRISE FIX: Phase 3 - Full Legacy Removal & Complete Single Source of Truth - 2026-03-05
// ENTERPRISE FIX: Phase 2 - Full Single Source of Truth & Legacy Cleanup - 2026-03-05
// ENTERPRISE FIX: Phase 1 - Single Source of Truth & Integration - 2026-03-05
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Item, Transaction } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Filter,
  Printer,
  Save,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  MonthlyAuditRow,
  computeMonthlyAuditRows,
  closeMonth,
  getMonthBounds,
  getMonthLabel,
  getOrCreateMonthlySession,
  isItemConflicted,
  saveManualSignedPdf,
  saveMonthlySession,
  upsertItemCount,
} from '../services/monthlyStocktakingService';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../store/useInventoryStore';

interface StocktakingProps {
  items?: Item[];
  transactions?: Transaction[];
  currentUserName?: string;
  companyName?: string;
  companyLogoUrl?: string;
}

type WorkPane = 'operations' | 'audit';
type QuickFilter = 'all' | 'conflicts';

type ReportCardKey = 'concentrates' | 'rawMaterials' | 'bags' | 'bagThread' | 'cards';
type StocktakingPrintTab = 'layout' | 'content' | 'branding';

interface StocktakingPrintConfig {
  reportTitle: string;
  orientation: 'portrait' | 'landscape';
  paperSize: 'a4' | 'a3' | 'legal';
  margins: 'narrow' | 'normal' | 'wide';
  topPageMarginMm: number;
  bottomPageMarginMm: number;
  smartPaginationEnabled: boolean;
  pageFillPercent: number;
  pageSafetyRows: number;
  repeatHeaderEachPage: boolean;
  tableRowHeightMode: 'auto' | 'fixed';
  headerRowHeightPx: number;
  bodyRowHeightPx: number;
  rowVerticalPaddingPx: number;
  cellTextVerticalPosition: number;
  tableTitleLiftPx: number;
  columnSpacing: number;
  mergeColumns: boolean;
  mergeStrength: number;
  fontSize: number;
  printSignatureBoxHeight?: number; // 7778~77 8&77777 7878788y7 7787878
  tableFontSize: number;
  showBorders: boolean;
  zebraStriping: boolean;
  colorHeaderRow: boolean;
  selectedCards: ReportCardKey[];
  showSignatures: boolean;
  watermarkText: string;
  showQrCode: boolean;
  reportUrl: string;
  generalNote: string;
}

interface StocktakingPrintTemplate {
  id: string;
  name: string;
  config: StocktakingPrintConfig;
  updatedAt: number;
}

interface AuditCategoryCard {
  key: ReportCardKey;
  title: string;
  accentClass: string;
  rows: MonthlyAuditRow[];
}

const REPORT_CARD_CONFIG: Array<Omit<AuditCategoryCard, 'rows'>> = [
  { key: 'concentrates', title: 'مركّزات', accentClass: 'border-blue-500' },
  { key: 'rawMaterials', title: 'مواد أولية', accentClass: 'border-emerald-500' },
  { key: 'bags', title: 'أكياس', accentClass: 'border-amber-500' },
  { key: 'bagThread', title: 'خيط الخياطة', accentClass: 'border-cyan-500' },
  { key: 'cards', title: 'كروت', accentClass: 'border-violet-500' },
];

const STOCKTAKING_PRINT_DEFAULT_CONFIG: StocktakingPrintConfig = {
  reportTitle: 'تقرير الجرد الشهري',
  orientation: 'portrait',
  paperSize: 'a4',
  margins: 'normal',
  topPageMarginMm: 0,
  bottomPageMarginMm: 3,
  smartPaginationEnabled: true,
  pageFillPercent: 95,
  pageSafetyRows: 1,
  repeatHeaderEachPage: false,
  tableRowHeightMode: 'auto',
  headerRowHeightPx: 34,
  bodyRowHeightPx: 32,
  rowVerticalPaddingPx: 8,
  cellTextVerticalPosition: 50,
  tableTitleLiftPx: 0,
  columnSpacing: 12,
  mergeColumns: false,
  mergeStrength: 60,
  fontSize: 11,
  tableFontSize: 12,
  showBorders: true,
  zebraStriping: true,
  colorHeaderRow: true,
  selectedCards: REPORT_CARD_CONFIG.map((card) => card.key),
  showSignatures: true,
  watermarkText: '',
  showQrCode: false,
  reportUrl: typeof window !== 'undefined' ? window.location.href : '',
  generalNote: '',
  printSignatureBoxHeight: 96,
};

const STOCKTAKING_PRINT_CONFIG_STORAGE_KEY = 'stocktaking_print_config';
const STOCKTAKING_PRINT_TEMPLATES_STORAGE_KEY = 'stocktaking_print_templates';

const normalizeText = (value: string | undefined) => String(value || '').trim().toLowerCase();

const getCardKeyForRow = (row: MonthlyAuditRow, categoryRaw: string | undefined): ReportCardKey | null => {
  const category = normalizeText(categoryRaw);
  const itemName = normalizeText(row.itemName);

  if (category === 'مركّزات' || category === '8&78777') return 'concentrates';
  if (category === 'مواد أولية' || category === 'مواد خام' || category === '8&877 7888y7') return 'rawMaterials';
  if (category === 'أكياس' || category === 'أجولة' || category === '788y77') return 'bags';
  if (category === 'خيط خياطة' || category === 'خيط الخياطة' || category === '78y7 7878' || category === '78y7 787878') return 'bagThread';
  if (category === 'كروت بيانات' || category === 'كروت بلاستيك' || category === 'كروت' || category === '8787 778y77' || category === '8787 878y8&7' || category === '8787') return 'cards';

  if (category.includes('خيط') && category.includes('خياطة')) return 'bagThread';

  if (category.includes('كروت') || category.includes('بطاق') || category.includes('كرت')) {
    if (itemName.includes('بلاستيك') || itemName.includes('بيانات')) return 'cards';
    return 'cards';
  }

  return null;
};

const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const formatNumber = (value: number | undefined) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return numberFormatter.format(value);
};

const getCurrentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const Stocktaking: React.FC<StocktakingProps> = ({
  items: itemsProp,
  transactions: transactionsProp,
  currentUserName,
  companyName,
  companyLogoUrl,
}) => {
  const storeItems = useInventoryStore((state) => state.items);
  const storeTransactions = useInventoryStore((state) => state.transactions);
  const loadAll = useInventoryStore((state) => state.loadAll);
  const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
  const items = itemsProp && itemsProp.length > 0 ? itemsProp : storeItems;
  const transactions = transactionsProp && transactionsProp.length > 0 ? transactionsProp : storeTransactions;
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [pane, setPane] = useState<WorkPane>('operations');
  const [blindMode, setBlindMode] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [statusMessage, setStatusMessage] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [draftUsers, setDraftUsers] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [sessionVersion, setSessionVersion] = useState(0);
  const [showPrintStudio, setShowPrintStudio] = useState(false);
  const [activePrintTab, setActivePrintTab] = useState<StocktakingPrintTab>('layout');
  const [printConfig, setPrintConfig] = useState<StocktakingPrintConfig>(STOCKTAKING_PRINT_DEFAULT_CONFIG);
  const [printTemplates, setPrintTemplates] = useState<StocktakingPrintTemplate[]>([]);
  const [printTemplateName, setPrintTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isPrintingPdf, setIsPrintingPdf] = useState(false);
  const [printStatusMessage, setPrintStatusMessage] = useState('');

  const importInputRef = useRef<HTMLInputElement>(null);
  const signedPdfInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const printPageRef = useRef<HTMLDivElement>(null);

  const session = useMemo(() => getOrCreateMonthlySession(monthKey), [monthKey, sessionVersion]);
  const { start, end } = useMemo(() => getMonthBounds(monthKey), [monthKey]);

  useEffect(() => {
    if (!lastLoadedAt) {
      void loadAll();
    }
  }, [lastLoadedAt, loadAll]);

  useEffect(() => {
    try {
      const rawConfig = localStorage.getItem(STOCKTAKING_PRINT_CONFIG_STORAGE_KEY);
      if (rawConfig) {
        const parsed = JSON.parse(rawConfig) as Partial<StocktakingPrintConfig> & { cellTextVerticalAlign?: 'top' | 'middle' | 'bottom' };
        const legacyVerticalAlign = parsed.cellTextVerticalAlign;
        const normalizedVerticalPosition = typeof parsed.cellTextVerticalPosition === 'number'
          ? Math.min(100, Math.max(0, parsed.cellTextVerticalPosition))
          : legacyVerticalAlign === 'top'
            ? 0
            : legacyVerticalAlign === 'bottom'
              ? 100
              : 50;
        setPrintConfig((prev) => ({
          ...prev,
          ...parsed,
          cellTextVerticalPosition: normalizedVerticalPosition,
          selectedCards: Array.isArray(parsed.selectedCards)
            ? parsed.selectedCards.filter((key): key is ReportCardKey => REPORT_CARD_CONFIG.some((card) => card.key === key))
            : prev.selectedCards,
        }));
      }

      const rawTemplates = localStorage.getItem(STOCKTAKING_PRINT_TEMPLATES_STORAGE_KEY);
      if (rawTemplates) {
        const parsedTemplates = JSON.parse(rawTemplates) as StocktakingPrintTemplate[];
        if (Array.isArray(parsedTemplates)) {
          setPrintTemplates(parsedTemplates);
        }
      }
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STOCKTAKING_PRINT_CONFIG_STORAGE_KEY, JSON.stringify(printConfig));
  }, [printConfig]);

  useEffect(() => {
    localStorage.setItem(STOCKTAKING_PRINT_TEMPLATES_STORAGE_KEY, JSON.stringify(printTemplates));
  }, [printTemplates]);

  const zones = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.zone?.trim() || 'بدون منطقة'))).sort();
    return ['all', ...values];
  }, [items]);

  const zoneItems = useMemo(() => {
    if (zoneFilter === 'all') return items;
    return items.filter((item) => (item.zone?.trim() || 'بدون منطقة') === zoneFilter);
  }, [items, zoneFilter]);

  const auditRows = useMemo(() => {
    const all = computeMonthlyAuditRows({ monthKey, items, transactions });
    if (zoneFilter === 'all') return all;
    const zoneItemIds = new Set(zoneItems.map((item) => item.id));
    return all.filter((row) => zoneItemIds.has(row.itemId));
  }, [monthKey, items, transactions, zoneFilter, zoneItems]);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const reportCards = useMemo<AuditCategoryCard[]>(() => {
    const buckets: Record<ReportCardKey, MonthlyAuditRow[]> = {
      concentrates: [],
      rawMaterials: [],
      bags: [],
      bagThread: [],
      cards: [],
    };

    auditRows.forEach((row) => {
      const item = itemById.get(row.itemId);
      const cardKey = getCardKeyForRow(row, item?.category);
      if (!cardKey) return;
      buckets[cardKey].push(row);
    });

    return REPORT_CARD_CONFIG.map((config) => ({
      ...config,
      rows: buckets[config.key],
    }));
  }, [auditRows, itemById]);

  const visibleReportCards = useMemo(() => {
    const selected = new Set(printConfig.selectedCards);
    return reportCards.filter((card) => selected.has(card.key));
  }, [reportCards, printConfig.selectedCards]);

  const operationsRows = useMemo(() => {
    const byItemId = new Map(auditRows.map((row) => [row.itemId, row]));
    return zoneItems
      .map((item) => {
        const itemRecord = session.itemRecords[item.id];
        const conflict = isItemConflicted(itemRecord);
        const row = byItemId.get(item.id);
        return {
          item,
          itemRecord,
          conflict,
          row,
        };
      })
      .filter((entry) => (quickFilter === 'conflicts' ? entry.conflict : true));
  }, [auditRows, zoneItems, session.itemRecords, quickFilter]);

  const totalItemsForProgress = zoneItems.length;
  const enteredItemsForProgress = zoneItems.filter((item) => session.itemRecords[item.id]?.actualCount !== undefined).length;
  const progress = totalItemsForProgress === 0 ? 0 : Math.round((enteredItemsForProgress / totalItemsForProgress) * 100);

  const conflictCount = useMemo(
    () => zoneItems.filter((item) => isItemConflicted(session.itemRecords[item.id])).length,
    [zoneItems, session.itemRecords]
  );

  const isClosed = session.closed;

  const getDraftCount = (itemId: string) => {
    if (draftCounts[itemId] !== undefined) return draftCounts[itemId];
    const saved = session.itemRecords[itemId]?.actualCount;
    return saved === undefined ? '' : String(saved);
  };

  const getDraftUser = (itemId: string) => {
    if (draftUsers[itemId]) return draftUsers[itemId];
    return currentUserName || 'النظام';
  };

  const getDraftNote = (itemId: string) => {
    if (draftNotes[itemId] !== undefined) return draftNotes[itemId];
    return session.itemRecords[itemId]?.notes || '';
  };

  const saveSingleItem = (itemId: string, resolveConflict = false) => {
    if (isClosed) return;

    const rawCount = getDraftCount(itemId);
    const parsed = Number(String(rawCount).replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) {
      setStatusMessage('القيمة المدخلة في حقل الجرد غير صالحة.');
      return;
    }

    const updated = upsertItemCount({
      monthKey,
      itemId,
      userName: getDraftUser(itemId),
      value: parsed,
      notes: getDraftNote(itemId),
    });

    if (resolveConflict && updated.itemRecords[itemId]) {
      updated.itemRecords[itemId].entries = [{ userName: getDraftUser(itemId), value: parsed, at: Date.now() }];
      saveMonthlySession(updated);
    }

    setSessionVersion((prev) => prev + 1);
    setStatusMessage(`تم حفظ جرد هذا الصنف بنجاح.`);
  };

  const saveAllVisible = () => {
    operationsRows.forEach(({ item }) => saveSingleItem(item.id));
  };

  const exportTemplate = () => {
    const rows = zoneItems.map((item) => ({
      item_code: item.code || '',
      item_name: item.name,
      zone: item.zone || 'بدون منطقة',
      actual_count: '',
      user_name: currentUserName || 'النظام',
      notes: '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `Stocktaking_Template_${monthKey}.xlsx`);
  };

  const exportCurrentEntries = () => {
    const rows = operationsRows.map(({ item, itemRecord, conflict }) => ({
      item_code: item.code || '',
      item_name: item.name,
      zone: item.zone || 'بدون منطقة',
      actual_count: itemRecord?.actualCount ?? '',
      conflict: conflict ? 'متضارب' : 'معتمد',
      entered_by: itemRecord?.entries.map((entry) => `${entry.userName}:${entry.value}`).join(' | ') || '',
      notes: itemRecord?.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Entries');
    XLSX.writeFile(wb, `Stocktaking_Entries_${monthKey}.xlsx`);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file || isClosed) return;

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });

    let importedCount = 0;

    rows.forEach((row) => {
      const code = String(row.item_code || row['item code'] || '').trim();
      const name = String(row.item_name || row['item name'] || '').trim();
      const countRaw = String(row.actual_count || row['actual count'] || '').trim();
      const userName = String(row.user_name || row['user name'] || currentUserName || 'النظام').trim();
      const notes = String(row.notes || '').trim();

      const parsedCount = Number(countRaw.replace(/,/g, ''));
      if (!Number.isFinite(parsedCount)) return;

      const item = items.find((candidate) => {
        if (code && candidate.code === code) return true;
        if (name && candidate.name === name) return true;
        return false;
      });

      if (!item) return;

      upsertItemCount({ monthKey, itemId: item.id, userName, value: parsedCount, notes });
      importedCount += 1;
    });

    setSessionVersion((prev) => prev + 1);
    setStatusMessage(`تم استيراد ${importedCount} صنف بنجاح.`);
  };

  const getPrintMarginInches = () => {
    if (printConfig.margins === 'narrow') return 0.2;
    if (printConfig.margins === 'wide') return 0.6;
    return 0.35;
  };

  const getPaperSizeMm = () => {
    switch (printConfig.paperSize) {
      case 'a3':
        return { width: 297, height: 420 };
      case 'legal':
        return { width: 216, height: 356 };
      case 'a4':
      default:
        return { width: 210, height: 297 };
    }
  };

  const getPrintPageMetrics = () => {
    const paper = getPaperSizeMm();
    const isLandscape = printConfig.orientation === 'landscape';
    const pageWidthMm = isLandscape ? paper.height : paper.width;
    const pageHeightMm = isLandscape ? paper.width : paper.height;
    const marginMm = getPrintMarginInches() * 25.4;

    return {
      pageWidthMm,
      pageHeightMm,
      marginMm,
      contentWidthMm: Math.max(10, pageWidthMm - marginMm * 2),
      contentHeightMm: Math.max(10, pageHeightMm - marginMm * 2),
    };
  };

  const savePrintTemplate = () => {
    const normalizedName = printTemplateName.trim();
    if (!normalizedName) {
      setPrintStatusMessage('يرجى إدخال اسم القالب أولاً.');
      return;
    }

    setPrintTemplates((prev) => {
      const existing = prev.find((template) => template.name === normalizedName);
      if (existing) {
        return prev.map((template) => (template.id === existing.id ? { ...template, config: printConfig, updatedAt: Date.now() } : template));
      }

      return [{ id: `tpl-${Date.now()}`, name: normalizedName, config: printConfig, updatedAt: Date.now() }, ...prev].slice(0, 25);
    });

    setPrintStatusMessage(`تم حفظ قالب الطباعة بنجاح: ${normalizedName}`);
  };

  const applyPrintTemplate = (templateId: string) => {
    const template = printTemplates.find((item) => item.id === templateId);
    if (!template) return;

    setPrintConfig(() => ({
      ...STOCKTAKING_PRINT_DEFAULT_CONFIG,
      ...template.config,
      selectedCards: Array.isArray(template.config.selectedCards)
        ? template.config.selectedCards.filter((key): key is ReportCardKey => REPORT_CARD_CONFIG.some((card) => card.key === key))
        : STOCKTAKING_PRINT_DEFAULT_CONFIG.selectedCards,
    }));
    setSelectedTemplateId(template.id);
    setPrintTemplateName(template.name);
    setPrintStatusMessage(`تم تطبيق القالب: ${template.name}`);
  };

  const deleteSelectedPrintTemplate = () => {
    if (!selectedTemplateId) {
      setPrintStatusMessage('يرجى اختيار قالب أولاً.');
      return;
    }

    const template = printTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;

    toast.warning(`حذف القالب "${template.name}"؟`, {
      action: {
        label: 'تأكيد الحذف',
        onClick: () => {
          setPrintTemplates((prev) => prev.filter((item) => item.id !== selectedTemplateId));
          setSelectedTemplateId('');
          setPrintStatusMessage(`تم حذف القالب: ${template.name}`);
          toast.success('تم حذف القالب');
        },
      },
    });
  };

  const buildPdfFromPrintStudio = async () => {
    if (!printPageRef.current) return;

    try {
      setIsPrintingPdf(true);
      setPrintStatusMessage('جاري إنشاء ملف PDF...');

      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as any).default;
      const topMarginInches = Math.max(0, printConfig.topPageMarginMm / 25.4);
      const bottomMarginInches = Math.max(0, printConfig.bottomPageMarginMm / 25.4);

      await html2pdf()
        .set({
          margin: [topMarginInches, 0, bottomMarginInches, 0],
          filename: `تقرير_الجرد_${monthKey}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: 'in', format: printConfig.paperSize, orientation: printConfig.orientation },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.report-card', '.card-container'] },
        })
        .from(printPageRef.current)
        .save();

      setPrintStatusMessage('تم تنزيل ملف PDF بنجاح.');
    } catch (error) {
      setPrintStatusMessage(error instanceof Error ? error.message : 'فشل في تنزيل ملف PDF.');
    } finally {
      setIsPrintingPdf(false);
    }
  };

  const renderStocktakingPrintSheet = () => {
    const pageMetrics = getPrintPageMetrics();
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
      ...allVisibleRows.map((row) => formatNumber(row.totalProduction)),
      ...allVisibleRows.map((row) => formatNumber(row.totalOutbound)),
      ...allVisibleRows.map((row) => formatNumber(row.totalWaste)),
      ...allVisibleRows.map((row) => formatNumber(row.theoreticalBalance)),
      ...allVisibleRows.map((row) => formatNumber(row.actualCount)),
      ...allVisibleRows.map((row) => formatNumber(row.difference)),
    ];
    const maxNumberLen = numberColumns.reduce((max, value) => Math.max(max, String(value || '').length), 3);

    const baseColumnWidths = [56, 230, 96, 96, 96, 96, 96, 102, 102, 96, 190];
    const minColumnWidths = [
      Math.max(34, estimateTextMinWidth('م'.repeat(maxIndexDigits))),
      Math.max(88, estimateTextMinWidth('اسم الصنف'), estimateTextMinWidth('م'.repeat(Math.min(maxItemNameLen, 24)))),
      Math.max(58, estimateTextMinWidth('الإفتتاحي'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
      Math.max(58, estimateTextMinWidth('الوارد'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
      Math.max(58, estimateTextMinWidth('الإنتاج'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
      Math.max(58, estimateTextMinWidth('المنصرف'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
      Math.max(58, estimateTextMinWidth('التالف'), estimateTextMinWidth('0'.repeat(maxNumberLen))),
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
                <th className="text-center" style={headerCellStyle}>الإنتاج</th>
                <th className="text-center" style={headerCellStyle}>المنصرف</th>
                <th className="text-center" style={headerCellStyle}>التالف</th>
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
                {['أمين المستودع', 'مدير المستودع', 'مدير الإنتاج', 'مدير الإدارة', 'مدير الجودة', 'المدير العام / المفوض'].map((title) => (
                  <div key={title} className="border border-dashed border-slate-300 rounded-lg p-2 flex items-end justify-center text-slate-700 font-bold" style={{ height: (printConfig.printSignatureBoxHeight || 96) + 'px' }}>
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
                    {['أمين المستودع', 'مدير المستودع', 'مدير الإنتاج', 'مدير الإدارة', 'مدير الجودة', 'المدير العام / المفوض'].map((title) => (
                      <div key={title} className="border border-dashed border-slate-300 rounded-lg p-2 flex items-end justify-center text-slate-700 font-bold" style={{ height: (printConfig.printSignatureBoxHeight || 96) + 'px' }}>
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

  const handleUploadSignedPdf = async (file: File | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
      saveManualSignedPdf(monthKey, file.name, file.type || 'application/pdf', base64);
      setSessionVersion((prev) => prev + 1);
      setStatusMessage('تم حفظ ملف PDF الموقع يدوياً.');
    };
    reader.readAsDataURL(file);
  };

  const handleCloseMonth = async () => {
    if (isClosed) return;
    if (conflictCount > 0) {
      setStatusMessage('لا يمكن إغلاق الجرد لوجود أصناف بها تعارض أو غير مجرودة.');
      return;
    }

    if (!reportRef.current) return;

    try {
      setIsClosing(true);
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as any).default;
      const pdfName = `Jard_${getMonthLabel(monthKey)}.pdf`;

      const worker = html2pdf()
        .set({
          margin: 0.35,
          filename: pdfName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.report-card', '.card-container'] },
        })
        .from(reportRef.current);

      const dataUri: string = await worker.outputPdf('datauristring');
      await worker.save();

      const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      const result = closeMonth({
        monthKey,
        approvedBy: currentUserName || 'النظام',
        rows: auditRows,
        archivedPdfName: pdfName,
        archivedPdfMime: 'application/pdf',
        archivedPdfData: base64,
      });

      if (!result.ok) {
        setStatusMessage(result.reason || 'فشل في إغلاق الجرد.');
        return;
      }

      setSessionVersion((prev) => prev + 1);
      setStatusMessage(`تم اعتماد إغلاق الجرد ${monthKey} وحفظ الرصيد الفعلي كأرصدة افتتاحية للشهر القادم.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'حدث خطأ أثناء إعداد أو إغلاق الجرد.');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">تقرير الجرد الشهري واعتماد الجرد الدفتري</h2>
            <p className="text-sm text-slate-500">ملاحظة حول الألوان: الإفتتاحي/الوارد + المنصرف/التالف</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              title="شهر الجرد"
              className="px-3 py-2 border border-slate-300 rounded-lg"
              value={monthKey}
              onChange={(event) => setMonthKey(event.target.value)}
            />

            <select
              className="px-3 py-2 border border-slate-300 rounded-lg"
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
              title="المنطقة"
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>{zone === 'all' ? 'كل المناطق' : zone}</option>
              ))}
            </select>

            <button
              className={`px-3 py-2 rounded-lg border font-bold flex items-center gap-2 ${blindMode ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-slate-300 text-slate-700'}`}
              onClick={() => setBlindMode((prev) => !prev)}
              title="تفعيل/إلغاء وضع الجرد الأعمى"
            >
              {blindMode ? <EyeOff size={16} /> : <Eye size={16} />} {blindMode ? 'وضع الجرد الأعمى: مفعل' : 'وضع الجرد الأعمى: معطل'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className={`px-3 py-2 rounded-lg border font-bold ${pane === 'operations' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setPane('operations')}>
            لوحة العمليات / الإدخال
          </button>
          <button className={`px-3 py-2 rounded-lg border font-bold ${pane === 'audit' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setPane('audit')}>
            المراجعة / الطباعة
          </button>
        </div>
      </div>

      {pane === 'operations' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
            <div>
              <div className="text-sm text-slate-700 font-bold">تم الجرد: {enteredItemsForProgress} / {totalItemsForProgress}</div>
              <progress className="w-72 max-w-full mt-2 h-2.5" value={progress} max={100} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button className={`px-3 py-2 rounded-lg border text-sm font-bold ${quickFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setQuickFilter('all')}>
                <Filter size={14} className="inline ml-1" /> كل الأصناف
              </button>
              <button className={`px-3 py-2 rounded-lg border text-sm font-bold ${quickFilter === 'conflicts' ? 'bg-red-700 text-white border-red-700' : 'bg-white text-slate-700 border-slate-300'}`} onClick={() => setQuickFilter('conflicts')}>
                <AlertTriangle size={14} className="inline ml-1" /> الأصناف المتضاربة فقط ({conflictCount})
              </button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={exportTemplate} disabled={isClosed}><Download size={14} className="inline ml-1" /> قالب الاستيراد</button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={exportCurrentEntries}><FileDown size={14} className="inline ml-1" /> تنزيل المدخلات</button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={() => importInputRef.current?.click()} disabled={isClosed}><Upload size={14} className="inline ml-1" /> استيراد</button>
              <input ref={importInputRef} type="file" title="استيراد ملف جرد" accept=".xlsx,.csv" className="hidden" onChange={(event) => { void handleImportFile(event.target.files?.[0] || null); event.currentTarget.value = ''; }} />
              <button className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold" onClick={saveAllVisible} disabled={isClosed}><Save size={14} className="inline ml-1" /> حفظ الكل</button>
            </div>
          </div>

          {isClosed && (
            <div className="m-4 p-3 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-sm font-bold">
              تم إغلاق هذا الجرد (Read-Only). لا يمكن تعديل بيانات الجرد.
            </div>
          )}

          <div className="overflow-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-white border-b border-slate-200">
                <tr>
                  <th className="p-3 text-right">اسم الصنف</th>
                  <th className="p-3 text-right">المنطقة</th>
                  <th className="p-3 text-right">اسم المستخدم الذي قام بالجرد</th>
                  <th className="p-3 text-right">العدد الفعلي</th>
                  {!blindMode && <th className="p-3 text-right">الرصيد الدفتري</th>}
                  {!blindMode && <th className="p-3 text-right">الفارق</th>}
                  <th className="p-3 text-right">الملاحظات</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {operationsRows.map(({ item, itemRecord, conflict, row }) => {
                  const difference = row?.difference;
                  return (
                    <tr key={item.id} className={`border-b border-slate-100 ${conflict ? 'bg-red-50' : ''}`}>
                      <td className="p-3 font-bold text-slate-800">{item.name}</td>
                      <td className="p-3 text-slate-600">{item.zone || 'بدون منطقة'}</td>
                      <td className="p-3">
                        <input
                          type="text"
                          title="اسم المستخدم الذي قام بالجرد"
                          value={getDraftUser(item.id)}
                          onChange={(event) => setDraftUsers((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-36 p-2 border border-slate-300 rounded-lg"
                          disabled={isClosed}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          title="العدد الفعلي"
                          value={getDraftCount(item.id)}
                          onChange={(event) => setDraftCounts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-36 p-2 border border-slate-300 rounded-lg"
                          placeholder={itemRecord?.actualCount !== undefined ? String(itemRecord.actualCount) : '0.000'}
                          disabled={isClosed}
                        />
                      </td>
                      {!blindMode && <td className="p-3 font-medium text-slate-700">{formatNumber(row?.theoreticalBalance)}</td>}
                      {!blindMode && (
                        <td className={`p-3 font-bold ${difference === undefined ? 'text-slate-400' : (difference > 0 ? 'text-red-700' : difference < 0 ? 'text-emerald-700' : 'text-slate-700')}`}>
                          {formatNumber(difference)}
                        </td>
                      )}
                      <td className="p-3">
                        <input
                          type="text"
                          title="ملاحظات الصنف"
                          value={getDraftNote(item.id)}
                          onChange={(event) => setDraftNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                          className="w-52 p-2 border border-slate-300 rounded-lg"
                          disabled={isClosed}
                        />
                      </td>
                      <td className="p-3">
                        {conflict ? (
                          <span className="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-bold">متضارب</span>
                        ) : (
                          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-xs font-bold">معتمد</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button className="px-2 py-1.5 rounded border border-slate-300 text-xs font-bold" onClick={() => saveSingleItem(item.id, false)} disabled={isClosed}>حفظ</button>
                          {conflict && (
                            <button className="px-2 py-1.5 rounded border border-red-300 text-red-700 text-xs font-bold" onClick={() => saveSingleItem(item.id, true)} disabled={isClosed}>حل التعارض</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {operationsRows.length === 0 && (
                  <tr>
                    <td colSpan={blindMode ? 7 : 9} className="p-6 text-center text-slate-500">لا توجد أصناف في هذا النطاق.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pane === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-2 items-center justify-between">
            <div className="text-sm text-slate-700 font-bold">
              788~777 788&77778y7: {start.toLocaleDateString('en-GB')} 7880 {end.toLocaleDateString('en-GB')}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-2 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-sm font-bold" onClick={() => setShowPrintStudio(true)}><Printer size={14} className="inline ml-1" /> 777878y8 7877777</button>
              <button className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-bold" onClick={() => signedPdfInputRef.current?.click()}><FileUp size={14} className="inline ml-1" /> 78~7 PDF 8&778&7 8y788y789</button>
              <input ref={signedPdfInputRef} type="file" title="" accept="application/pdf" className="hidden" onChange={(event) => { void handleUploadSignedPdf(event.target.files?.[0] || null); event.currentTarget.value = ''; }} />
              <button className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold disabled:opacity-60" onClick={() => void handleCloseMonth()} disabled={isClosing || isClosed}>
                <CheckCircle2 size={14} className="inline ml-1" /> {isClosing ? '7778 787778&77...' : '7778&77 877878 7878!7'}
              </button>
            </div>
          </div>

          <div ref={reportRef}>
            {renderStocktakingPrintSheet()}
          </div>

          {(session.archivedPdfName || session.manualSignedPdfName) && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
              {session.archivedPdfName ? <div>7778y8~ 788 778&: {session.archivedPdfName}</div> : null}
              {session.manualSignedPdfName ? <div>788&88~ 788&778&7 8y788y789: {session.manualSignedPdfName}</div> : null}
            </div>
          )}
        </div>
      )}

      {showPrintStudio && (
        <div className="fixed inset-0 z-[ظ -ظ©] bg-slate-950/85 backdrop-blur-sm">
          <div className="h-full w-full bg-slate-100 flex flex-col">
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Printer size={18} className="text-indigo-600" /> 777878y8 7877777 - 878& 78777</h3>
                <p className="text-xs text-slate-500">8 777 8&7878&7 8&8  777878y8 7877777 8&7 8&778y8 7 8&77777 8&7878~87 8&7 78778y7 78777.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={printTemplateName}
                  onChange={(e) => setPrintTemplateName(e.target.value)}
                  placeholder=""
                  title=""
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs min-w-52"
                />
                <button onClick={savePrintTemplate} className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50">78~7 8787</button>
                <select
                  className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  value={selectedTemplateId}
                  title=""
                  onChange={(e) => applyPrintTemplate(e.target.value)}
                >
                  <option value="">778&8y8 8787 8&78~87...</option>
                  {printTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <button onClick={deleteSelectedPrintTemplate} className="px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg hover:bg-red-100">778~ 8787</button>
                <button onClick={() => setShowPrintStudio(false)} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:text-red-600">77878</button>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-12 min-h-0">
              <div className="col-span-3 border-r border-slate-200 bg-white overflow-y-auto">
                <div className="p-3 border-b border-slate-200 bg-slate-50 flex gap-2">
                  <button onClick={() => setActivePrintTab('layout')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'layout' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>787778y7</button>
                  <button onClick={() => setActivePrintTab('content')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'content' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>788&77880</button>
                  <button onClick={() => setActivePrintTab('branding')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'branding' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>787878&77</button>
                </div>

                <div className="p-4 space-y-4 text-xs">
                  {activePrintTab === 'layout' && (
                    <>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">78 878  787878y7</label>
                        <input title="" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.reportTitle} onChange={(e) => setPrintConfig((prev) => ({ ...prev, reportTitle: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">77778! 7878~77</label>
                        <select title="" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.orientation} onChange={(e) => setPrintConfig((prev) => ({ ...prev, orientation: e.target.value as StocktakingPrintConfig['orientation'] }))}>
                          <option value="portrait">7888y</option>
                          <option value="landscape">7778y</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">8&877 78878</label>
                        <select title="" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.paperSize} onChange={(e) => setPrintConfig((prev) => ({ ...prev, paperSize: e.target.value as StocktakingPrintConfig['paperSize'] }))}>
                          <option value="a4">A4</option>
                          <option value="a3">A3</option>
                          <option value="legal">Legal</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">788!878&7</label>
                        <select title="" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.margins} onChange={(e) => setPrintConfig((prev) => ({ ...prev, margins: e.target.value as StocktakingPrintConfig['margins'] }))}>
                          <option value="narrow">78y87</option>
                          <option value="normal">8&78777</option>
                          <option value="wide">87777</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">77 7878~77 8&8  7877880 ({printConfig.topPageMarginMm}mm)</label>
                        <input
                          title=""
                          type="range"
                          min={0}
                          max={50}
                          value={printConfig.topPageMarginMm}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, topPageMarginMm: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">77 7878~77 8&8  78778~8 ({printConfig.bottomPageMarginMm}mm)</label>
                        <input
                          title=""
                          type="range"
                          min={0}
                          max={50}
                          value={printConfig.bottomPageMarginMm}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, bottomPageMarginMm: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>7778y8 788778y 78y8  7878~777</span>
                        <input
                          type="checkbox"
                          checked={printConfig.smartPaginationEnabled}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, smartPaginationEnabled: e.target.checked }))}
                        />
                      </label>
                      {printConfig.smartPaginationEnabled && (
                        <>
                          <div>
                            <label className="block text-slate-500 mb-1 font-bold">8 777 78&7877 7878~77 878 787778y8 ({printConfig.pageFillPercent}%)</label>
                            <input
                              title=""
                              type="range"
                              min={80}
                              max={99}
                              value={printConfig.pageFillPercent}
                              onChange={(e) => setPrintConfig((prev) => ({ ...prev, pageFillPercent: Number(e.target.value) }))}
                              className="w-full"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-1 font-bold">8!78&7 7878&78  887778y8 ({printConfig.pageSafetyRows} 78~)</label>
                            <input
                              title=""
                              type="range"
                              min={0}
                              max={6}
                              value={printConfig.pageSafetyRows}
                              onChange={(e) => setPrintConfig((prev) => ({ ...prev, pageSafetyRows: Number(e.target.value) }))}
                              className="w-full"
                            />
                          </div>
                          <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                            <span>78777 777 787878y7 8~8y 88 78~77</span>
                            <input
                              type="checkbox"
                              checked={printConfig.repeatHeaderEachPage}
                              onChange={(e) => setPrintConfig((prev) => ({ ...prev, repeatHeaderEachPage: e.target.checked }))}
                            />
                          </label>
                        </>
                      )}
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">حجم خط الترويسة ({printConfig.fontSize}px)</label>
                        <input title="حجم خط الترويسة" type="range" min={9} max={30} value={printConfig.fontSize} onChange={(e) => setPrintConfig((prev) => ({ ...prev, fontSize: Number(e.target.value) }))} className="w-full" />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">حجم خط الجدول ({printConfig.tableFontSize}px)</label>
                        <input title="حجم خط الجدول" type="range" min={5} max={25} value={printConfig.tableFontSize} onChange={(e) => setPrintConfig((prev) => ({ ...prev, tableFontSize: Number(e.target.value) }))} className="w-full" />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">ضبط ارتفاع الصفوف</label>
                        <select
                          title="ضبط ارتفاع الصفوف"
                          className="w-full p-2 border border-slate-300 rounded-lg"
                          value={printConfig.tableRowHeightMode}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, tableRowHeightMode: e.target.value as StocktakingPrintConfig['tableRowHeightMode'] }))}
                        >
                          <option value="auto">تلقائي (مرن)</option>
                          <option value="fixed">ثابت (دقيق)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">ارتفاع ترويسة الجدول ({printConfig.headerRowHeightPx}px)</label>
                        <input
                          title="ارتفاع ترويسة الجدول"
                          type="range"
                          min={18}
                          max={90}
                          value={printConfig.headerRowHeightPx}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, headerRowHeightPx: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">ارتفاع صفوف البيانات ({printConfig.bodyRowHeightPx}px)</label>
                        <input
                          title="ارتفاع صفوف البيانات"
                          type="range"
                          min={18}
                          max={100}
                          value={printConfig.bodyRowHeightPx}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, bodyRowHeightPx: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">التباعد الداخلي العمودي للصفوف ({printConfig.rowVerticalPaddingPx}px)</label>
                        <input
                          title="التباعد الداخلي العمودي للصفوف"
                          type="range"
                          min={0}
                          max={24}
                          value={printConfig.rowVerticalPaddingPx}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, rowVerticalPaddingPx: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">الموضع الرأسي للنص داخل الخلايا ({printConfig.cellTextVerticalPosition}%)</label>
                        <input
                          title="الموضع الرأسي للنص داخل الخلايا"
                          type="range"
                          min={0}
                          max={100}
                          value={printConfig.cellTextVerticalPosition}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, cellTextVerticalPosition: Number(e.target.value) }))}
                          className="w-full"
                        />
                        <div className="mt-1 text-[11px] text-slate-500 flex items-center justify-between">
                          <span>لأعلى</span>
                          <span>{printConfig.cellTextVerticalPosition < 34 ? 'النص محاذى لأعلى' : printConfig.cellTextVerticalPosition > 66 ? 'النص محاذى لأسفل' : 'النص في المنتصف'}</span>
                          <span>لأسفل</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">مسافة عنوان الجدول من الأعلى ({printConfig.tableTitleLiftPx}px)</label>
                        <input
                          title="مسافة عنوان الجدول من الأعلى"
                          type="range"
                          min={0}
                          max={40}
                          value={printConfig.tableTitleLiftPx}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, tableTitleLiftPx: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">تباعد النص عن أطراف العمود ({printConfig.columnSpacing}px)</label>
                        <input
                          title="تباعد النص عن أطراف العمود"
                          type="range"
                          min={0}
                          max={100}
                          value={printConfig.columnSpacing}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, columnSpacing: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>دمج الأعمدة الذكي</span>
                        <input
                          type="checkbox"
                          checked={printConfig.mergeColumns}
                          onChange={(e) => setPrintConfig((prev) => ({ ...prev, mergeColumns: e.target.checked }))}
                        />
                      </label>
                      {printConfig.mergeColumns && (
                        <div>
                          <label className="block text-slate-500 mb-1 font-bold">قوة دمج الأعمدة ({printConfig.mergeStrength}%)</label>
                          <input
                            title="قوة دمج الأعمدة"
                            type="range"
                            min={0}
                            max={100}
                            value={printConfig.mergeStrength}
                            onChange={(e) => setPrintConfig((prev) => ({ ...prev, mergeStrength: Number(e.target.value) }))}
                            className="w-full"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {activePrintTab === 'content' && (
                    <>
                      <div>
                        <label className="block text-slate-500 mb-2 font-bold">محتوى التقرير</label>
                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                          {REPORT_CARD_CONFIG.map((card) => (
                            <label key={card.key} className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-slate-50">
                              <span>{card.title}</span>
                              <input
                                type="checkbox"
                                checked={printConfig.selectedCards.includes(card.key)}
                                onChange={() => setPrintConfig((prev) => {
                                  const exists = prev.selectedCards.includes(card.key);
                                  const next = exists
                                    ? prev.selectedCards.filter((key) => key !== card.key)
                                    : [...prev.selectedCards, card.key];
                                  return { ...prev, selectedCards: next.length ? next : [card.key] };
                                })}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>إظهار التوقيعات</span>
                        <input type="checkbox" checked={printConfig.showSignatures} onChange={(e) => setPrintConfig((prev) => ({ ...prev, showSignatures: e.target.checked }))} />
                      </label>

                      {printConfig.showSignatures && (
                        <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg mt-2">
                          <span>ارتفاع مربع التوقيع (px)</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="48"
                              max="180"
                              step="4"
                              value={printConfig.printSignatureBoxHeight || 96}
                              onChange={e => setPrintConfig(prev => ({ ...prev, printSignatureBoxHeight: Number(e.target.value) }))}
                              className="w-40"
                            />
                            <span className="w-10 text-right">{printConfig.printSignatureBoxHeight || 96}</span>
                          </div>
                        </label>
                      )}
                    </>
                  )}

                  {activePrintTab === 'branding' && (
                    <>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>حدود الجدول</span>
                        <input type="checkbox" checked={printConfig.showBorders} onChange={(e) => setPrintConfig((prev) => ({ ...prev, showBorders: e.target.checked }))} />
                      </label>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>تلوين الصفوف الفردية (Zebra)</span>
                        <input type="checkbox" checked={printConfig.zebraStriping} onChange={(e) => setPrintConfig((prev) => ({ ...prev, zebraStriping: e.target.checked }))} />
                      </label>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>تلوين صف الترويسة</span>
                        <input type="checkbox" checked={printConfig.colorHeaderRow} onChange={(e) => setPrintConfig((prev) => ({ ...prev, colorHeaderRow: e.target.checked }))} />
                      </label>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">العلامة المائية</label>
                        <input title="العلامة المائية" type="text" className="w-full p-2 border border-slate-300 rounded-lg" placeholder="مثال: مسودة / سري" value={printConfig.watermarkText} onChange={(e) => setPrintConfig((prev) => ({ ...prev, watermarkText: e.target.value }))} />
                      </div>
                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                        <span>إظهار رمز QR في التذييل</span>
                        <input type="checkbox" checked={printConfig.showQrCode} onChange={(e) => setPrintConfig((prev) => ({ ...prev, showQrCode: e.target.checked }))} />
                      </label>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">رابط الوصول عبر الهاتف</label>
                        <input title="رابط الوصول عبر الهاتف" type="text" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.reportUrl} onChange={(e) => setPrintConfig((prev) => ({ ...prev, reportUrl: e.target.value }))} />
                      </div>
                      <div>
                        <label className="block text-slate-500 mb-1 font-bold">ملاحظة عامة</label>
                        <textarea title="ملاحظة عامة" className="w-full p-2 border border-slate-300 rounded-lg min-h-24" value={printConfig.generalNote} onChange={(e) => setPrintConfig((prev) => ({ ...prev, generalNote: e.target.value }))} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="col-span-9 flex flex-col min-h-0">
                <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between text-xs">
                  <div className="text-slate-600">معاينة حية للطباعة (WYSIWYG)</div>
                  {printStatusMessage && <div className="text-indigo-700 font-bold">{printStatusMessage}</div>}
                </div>

                <div className="flex-1 overflow-auto p-4 bg-slate-200">
                  <div
                    ref={printPageRef}
                    className="mx-auto bg-white overflow-hidden"
                    style={{
                      width: `${getPrintPageMetrics().pageWidthMm}mm`,
                      minHeight: `${getPrintPageMetrics().pageHeightMm}mm`,
                      paddingTop: `${getPrintPageMetrics().marginMm}mm`,
                      paddingRight: `${getPrintPageMetrics().marginMm}mm`,
                      paddingLeft: `${getPrintPageMetrics().marginMm}mm`,
                      paddingBottom: `${getPrintPageMetrics().marginMm}mm`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {renderStocktakingPrintSheet()}
                  </div>
                </div>

                <div className="px-4 py-3 bg-white border-t border-slate-200 flex items-center justify-end gap-2">
                  <button onClick={() => setShowPrintStudio(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">إغلاق</button>
                  <button onClick={() => void buildPdfFromPrintStudio()} disabled={isPrintingPdf} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
                    {isPrintingPdf ? 'جاري التصدير...' : 'التصدير النهائي (PDF)'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="p-3 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm">
          {statusMessage}
        </div>
      )}
    </div>
  );
};

export default Stocktaking;

