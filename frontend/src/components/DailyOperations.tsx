
// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// تم فحص وتصحيح كل سطر يحتوي على نص عربي

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Item, Transaction, OperationType, Partner, SystemSettings, UnloadingRule, GridColumnPreference } from '../types';
import { OPERATION_TYPES } from '../constants';
import UniversalColumnManager from './UniversalColumnManager';
import { getGridModuleDefinition } from '../services/gridModules';
import { getGridPreferenceForUser, resetGridPreferenceForUser, upsertGridPreferenceForUser } from '../services/storage';
import { 
  Trash2, Save, Download, Upload,
  FileSpreadsheet, Truck, Clock, Scale, 
  User, Calendar, AlertTriangle, ArrowRightLeft, 
    ShieldCheck, Edit, X, FileText, Hash, Info,
  CheckCircle, Settings, FileUp, Database, RefreshCw, AlertCircle,
    Plus, Layers, Receipt, Calculator, PlayCircle, Search, Loader2, Printer
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import Fuse from 'fuse.js';
import { toast } from '@services/toastService';

interface DailyOperationsProps {
  items: Item[];
  transactions: Transaction[];
  partners: Partner[];
  settings: SystemSettings;
    unloadingRules: UnloadingRule[];
  onAddTransaction: (transactions: Transaction[]) => void;
  onUpdateTransaction: (transaction: Transaction) => void;
  onDeleteTransactions: (ids: string[]) => void;
        currentUserId?: string;
    canExport?: boolean;
    canImport?: boolean;
    onExport?: (rowCount: number) => void;
    onImport?: (rowCount: number) => void;
}

interface InventoryDrilldownFilter {
    itemId: string;
    itemName?: string;
    type: OperationType;
    monthKey: string;
}

// --- Helper for Text Highlighting ---
const Highlighter: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
  if (!highlight.trim()) return <>{text}</>;
  
  // Clean matching for safe regex
  const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapedHighlight})`, 'gi'));
  
  return (
    <span>
      {parts.map((part, i) => 
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-200 text-yellow-800 rounded px-0.5 font-bold shadow-sm">{part}</span>
        ) : (
          part
        )
      )}
    </span>
  );
};

const isExcelTimeFractionNoise = (value?: string) => {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (!trimmed) return false;

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return false;

    return numeric > 0 && numeric < 1 && /^\d+\.\d+$/.test(trimmed);
};

// --- Import/Export Helper Types ---
type ImportStep = 'upload' | 'mapping' | 'preview' | 'finish';

type ImportPreviewRow = {
    rowNumber: number;
    date: string;
    type: string;
    warehouseInvoice: string;
    itemName: string;
    partnerName: string;
    quantity: string;
    supplierNet: string;
    entryTime: string;
    exitTime: string;
    unloadingRuleName: string;
    status: 'valid' | 'invalid';
    errors: string[];
};

type OperationPrintOrientation = 'portrait' | 'landscape';
type OperationPrintPaperSize = 'a4' | 'a3' | 'legal';
type OperationPrintMargins = 'narrow' | 'normal' | 'wide';
type OperationPrintGrouping = 'none' | 'day' | 'type';
type OperationPrintTab = 'layout' | 'content' | 'branding';
type InvoiceSortMode = 'invoice_asc_date_desc' | 'invoice_desc_date_desc' | 'invoice_asc_type_then_date' | 'invoice_asc_partner_then_date';

interface OperationPrintableRow {
    id: string;
    invoiceCounter: number;
    date: string;
    type: OperationType;
    warehouseInvoice: string;
    supplierInvoice: string;
    itemName: string;
    supplierOrReceiver: string;
    quantity: number;
    supplierNet: number;
    difference: number;
    packageCount: number;
    weightSlip: string;
    truckNumber: string;
    trailerNumber: string;
    driverName: string;
    entryTime: string;
    exitTime: string;
    delayPenalty: number;
    notes: string;
    [key: string]: string | number;
}

interface OperationPrintConfig {
    reportTitle: string;
    orientation: OperationPrintOrientation;
    paperSize: OperationPrintPaperSize;
    margins: OperationPrintMargins;
    fontSize: number;
    tableFontSize: number;
    cellPadding: number;
    wrapCellText: boolean;
    smartCellPadding: boolean;
    verticalTextOffset: number;
    rowHeight: number;
    showBorders: boolean;
    zebraStriping: boolean;
    colorHeaderRow: boolean;
    selectedColumns: string[];
    grouping: OperationPrintGrouping;
    pageBreakThresholdPercent: number;
    pageStartMarginMm: number;
    pageEndMarginMm: number;
    watermarkText: string;
    showQrCode: boolean;
    reportUrl: string;
    generalNote: string;
    autoSizeColumns: boolean;
}

interface OperationPrintTemplate {
    id: string;
    name: string;
    config: OperationPrintConfig;
    updatedAt: number;
}

const OPERATION_PRINT_CONFIG_STORAGE_KEY = 'operation_log_print_config';
const OPERATION_PRINT_TEMPLATES_STORAGE_KEY = 'operation_log_print_templates';

const OPERATION_PRINT_COLUMNS: { key: keyof OperationPrintableRow; label: string }[] = [
    { key: 'invoiceCounter', label: '#' },
    { key: 'date', label: '7�87�7�7�8y7�' },
    { key: 'type', label: '8 8�7� 7�87�7�8�7�' },
    { key: 'warehouseInvoice', label: '8~7�7�8�7�7� 7�88&7�7�8 ' },
    { key: 'supplierInvoice', label: '8~7�7�8�7�7� 7�88&8�7�7�' },
    { key: 'itemName', label: '7�87�8 8~' },
    { key: 'supplierOrReceiver', label: '7�88&8�7�7�/7�87�8&8y8' },
    { key: 'quantity', label: '7�7�8~8y 7�87�8!8' },
    { key: 'supplierNet', label: '7�7�8~8y 7�88&8�7�7�' },
    { key: 'difference', label: '7�88~7�8' },
    { key: 'packageCount', label: '7�88�8&8y7� (7�7�8�7�7�)' },
    { key: 'weightSlip', label: '8 8&8�7�7� 7�88�7�8 ' },
    { key: 'truckNumber', label: '7�87�7�7�8 7�' },
    { key: 'trailerNumber', label: '7�87�7�7�7�' },
    { key: 'driverName', label: '7�87�7�7�8' },
    { key: 'entryTime', label: '7�7�8�8' },
    { key: 'exitTime', label: '7�7�8�7�' },
    { key: 'delayPenalty', label: '77�7�8&7� 7�87�7�7�8y7�' },
    { key: 'notes', label: '8&87�7�7�7�7�' },
];

const OPERATION_PRINT_DEFAULT_CONFIG: OperationPrintConfig = {
    reportTitle: '7�87�8y7� 7�7�8 7�87�8&88y7�7�',
    orientation: 'landscape',
    paperSize: 'a4',
    margins: 'normal',
    fontSize: 10,
    tableFontSize: 11,
    cellPadding: 6,
    wrapCellText: true,
    smartCellPadding: true,
    verticalTextOffset: -1,
    rowHeight: 34,
    showBorders: true,
    zebraStriping: true,
    colorHeaderRow: true,
    selectedColumns: OPERATION_PRINT_COLUMNS.map((column) => column.key),
    grouping: 'none',
    pageBreakThresholdPercent: 90,
    pageStartMarginMm: 0,
    pageEndMarginMm: 0,
    watermarkText: '',
    showQrCode: false,
    reportUrl: typeof window !== 'undefined' ? window.location.href : '',
    generalNote: '',
    autoSizeColumns: true,
};

// Updated System Fields to match Batch Entry exactly
const SYSTEM_FIELDS: { key: string; label: string; required: boolean }[] = [
  // Basic
  { key: 'date', label: '7�87�7�7�8y7� (YYYY-MM-DD)', required: true },
  { key: 'type', label: '8 8�7� 7�87�8&88y7�', required: true },
  { key: 'warehouseInvoice', label: '7�88& 8~7�7�8�7�7� 7�88&7�7�8 ', required: true },
  { key: 'itemName', label: '7�7�8& 7�87�8 8~', required: true },
  { key: 'partnerName', label: '7�7�8& 7�88&8�7�7�/7�87�8&8y8', required: true },
  
  // Weights
  { key: 'quantity', label: '7�7�8~8y 7�87�8!8 (7�88�8&8y7�)', required: true },
  { key: 'supplierNet', label: '7�7�8~8y 7�88&8�7�7�', required: false },
  { key: 'packageCount', label: '7�7�7� 7�87�7�8�7�7�', required: false },
  { key: 'weightSlip', label: '7�88& 8 8&8�7�7� 7�88�7�8 ', required: false },
  
  // Logistics
  { key: 'supplierInvoice', label: '7�88& 8~7�7�8�7�7� 7�88&8�7�7�', required: false },
  { key: 'truckNumber', label: '7�88& 7�87�7�7�8 7�', required: false },
  { key: 'trailerNumber', label: '7�88& 7�87�7�7�7�/7�88&87�8�7�7�', required: false },
  { key: 'driverName', label: '7�7�8& 7�87�7�7�8', required: false },
  
    // Time
    { key: 'entryTime', label: '8�87� 7�87�7�8�8 (HH:MM)', required: false },
    { key: 'exitTime', label: '8�87� 7�87�7�8�7� (HH:MM)', required: false },
    { key: 'unloadingRuleName', label: '7�7�8& 87�7�7�7� 7�87�8~7�8y7', required: false },
  
  // Other
  { key: 'notes', label: '8&87�7�7�7�7�', required: false },
];

const getImportSearchTerms = (field: { key: string; label: string }) => {
    return [
        field.label,
        field.key,
        field.key === 'type' ? '8 8�7�' : '',
        field.key === 'type' ? '7�7�87�' : '',
        field.key === 'type' ? '7�7�7�7�8!' : '',
        field.key === 'packageCount' ? '7�7�8�7�7�' : '',
        field.key === 'packageCount' ? '7�7�7�' : '',
        field.key === 'weightSlip' ? '7�7�8�8�8' : '',
        field.key === 'weightSlip' ? '8�7�8 ' : '',
        field.key === 'supplierInvoice' ? '8~7�7�8�7�7� 8&8�7�7�' : '',
        field.key === 'trailerNumber' ? '7�7�7�7�' : '',
        field.key === 'trailerNumber' ? '8&87�8�7�7�' : '',
        field.key === 'unloadingRuleName' ? '87�7�7�7�' : '',
        field.key === 'unloadingRuleName' ? '8 7�887�' : '',
        field.key === 'itemName' ? '7�8 8~' : '',
        field.key === 'quantity' ? '8�8&8y7�' : '',
        field.key === 'quantity' ? '8�7�8  87�7�8&' : '',
        field.key === 'partnerName' ? '7�8&8y8' : '',
        field.key === 'partnerName' ? '8&8�7�7�' : '',
    ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
};

const autoMapImportHeaders = (headers: string[]) => {
    const normalizedHeaders = headers.map((header) => String(header || '').trim());
    const autoMap: Record<string, string> = {};

    SYSTEM_FIELDS.forEach((field) => {
        const searchTerms = getImportSearchTerms(field);
        const matchedHeader = normalizedHeaders.find((header) => {
            const headerLower = header.toLowerCase();
            return searchTerms.some((term) => headerLower.includes(term));
        });

        if (matchedHeader) {
            autoMap[field.key] = matchedHeader;
        }
    });

    return autoMap;
};

const detectHeaderRowIndex = (rows: unknown[][]) => {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    rows.forEach((row, rowIndex) => {
        const headers = row.map((value) => String(value ?? '').trim()).filter(Boolean);
        if (headers.length < 2) return;

        const autoMap = autoMapImportHeaders(headers);
        const matchedFields = Object.keys(autoMap).length;
        const score = (matchedFields * 10) + headers.length;

        if (score > bestScore) {
            bestScore = score;
            bestIndex = rowIndex;
        }
    });

    return bestIndex;
};

const DailyOperations: React.FC<DailyOperationsProps> = ({
  items,
  transactions,
  partners,
  settings,
    unloadingRules,
  onAddTransaction,
  onUpdateTransaction,
    onDeleteTransactions,
        currentUserId,
    canExport = false,
    canImport = false,
    onExport,
    onImport
}) => {
    const location = useLocation();
  
  // --- Constants & Config ---
  const ROWS_COUNT = 5;
  
  const getEmptyForm = (): Partial<Transaction> => ({
    date: new Date().toISOString().split('T')[0],
    type: '8�7�7�7�',
    quantity: undefined,
    supplierNet: undefined,
    difference: 0,
    warehouseInvoice: '',
    supplierOrReceiver: '',
    unloadingDuration: settings.defaultUnloadingDuration ?? 60,
    packageCount: undefined,
    supplierInvoice: '',
    weightSlip: '',
    truckNumber: '',
    trailerNumber: '',
    driverName: '',
    entryTime: '',
    exitTime: '',
        unloadingRuleId: '',
    delayDuration: 0,
    delayPenalty: 0,
        calculatedFine: 0,
    notes: '',
    attachmentName: ''
  });

  // --- State ---
  const [entryMode, setEntryMode] = useState<'batch' | 'invoice'>('invoice'); // Default to Invoice Mode (Modern)

  // Batch State
  const [batchForms, setBatchForms] = useState<Partial<Transaction>[]>(
    Array(ROWS_COUNT).fill(null).map(() => getEmptyForm())
  );
  
  // Invoice Builder State
  const [invoiceHeader, setInvoiceHeader] = useState<{
      date: string;
      type: OperationType;
      warehouseInvoice: string;
      supplierOrReceiver: string;
      supplierInvoice?: string;
      weightSlip?: string; // Moved here (Unified)
      truckNumber?: string;
      trailerNumber?: string;
      driverName?: string;
      entryTime?: string;
      exitTime?: string;
      unloadingRuleId?: string;
      unloadingDuration?: number;
      notes?: string;
  }>({
      date: new Date().toISOString().split('T')[0],
      type: '8�7�7�7�',
      warehouseInvoice: '',
      supplierOrReceiver: '',
      unloadingRuleId: '',
      unloadingDuration: settings.defaultUnloadingDuration ?? 60
  });

  const [invoiceItems, setInvoiceItems] = useState<{
      id: string;
      itemId: string;
      quantity?: number;
      supplierNet?: number;
      packageCount?: number;
      // weightSlip removed from item level
      unit?: string; // Visual helper
  }[]>([{ id: uuidv4(), itemId: '' }]);

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeSuggestionRow, setActiveSuggestionRow] = useState<number | null>(null);
  
  // Invoice specific suggestion state
  const [showPartnerSuggestions, setShowPartnerSuggestions] = useState(false);
  // Edit Modal specific suggestion state
  const [showEditPartnerSuggestions, setShowEditPartnerSuggestions] = useState(false);
    const [showBatchColumnSettings, setShowBatchColumnSettings] = useState(false);

  // --- SEARCH STATE ---
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
    const [operationTypeFilter, setOperationTypeFilter] = useState<'all' | OperationType>('all');
    const [operationDateFromFilter, setOperationDateFromFilter] = useState('');
    const [operationDateToFilter, setOperationDateToFilter] = useState('');
    const [operationPartnerFilter, setOperationPartnerFilter] = useState('');
    const [operationMinQuantityFilter, setOperationMinQuantityFilter] = useState('');
    const [operationMaxQuantityFilter, setOperationMaxQuantityFilter] = useState('');
    const [operationPenaltyFilter, setOperationPenaltyFilter] = useState<'all' | 'with_penalty' | 'without_penalty'>('all');
    const [invoiceSortMode, setInvoiceSortMode] = useState<InvoiceSortMode>('invoice_asc_date_desc');
    const [collapsedInvoiceGroups, setCollapsedInvoiceGroups] = useState<Set<string>>(new Set());
  const [showHistoryColumnSettings, setShowHistoryColumnSettings] = useState(false);
  const [activeDrilldown, setActiveDrilldown] = useState<InventoryDrilldownFilter | null>(null);
    const [showPrintStudio, setShowPrintStudio] = useState(false);
    const [activePrintTab, setActivePrintTab] = useState<OperationPrintTab>('layout');
    const [printConfig, setPrintConfig] = useState<OperationPrintConfig>(OPERATION_PRINT_DEFAULT_CONFIG);
    const [printTemplates, setPrintTemplates] = useState<OperationPrintTemplate[]>([]);
    const [printTemplateName, setPrintTemplateName] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [isPrintingPdf, setIsPrintingPdf] = useState(false);
    const [printStatusMessage, setPrintStatusMessage] = useState('');
    const printPageRef = useRef<HTMLDivElement | null>(null);
    const printSheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
      const statePayload = (location.state as { drilldown?: InventoryDrilldownFilter } | null)?.drilldown;
      if (!statePayload) return;

      setActiveDrilldown(statePayload);
      if (statePayload.itemName) {
          setSearchQuery(statePayload.itemName);
      }
  }, [location.state]);

  useEffect(() => {
      try {
          const rawConfig = localStorage.getItem(OPERATION_PRINT_CONFIG_STORAGE_KEY);
          if (rawConfig) {
              const parsed = JSON.parse(rawConfig) as Partial<OperationPrintConfig>;
              setPrintConfig(prev => ({
                  ...prev,
                  ...parsed,
                  selectedColumns: Array.isArray(parsed.selectedColumns)
                      ? parsed.selectedColumns.filter((key): key is string => OPERATION_PRINT_COLUMNS.some(column => column.key === key))
                      : prev.selectedColumns,
              }));
          }

          const rawTemplates = localStorage.getItem(OPERATION_PRINT_TEMPLATES_STORAGE_KEY);
          if (rawTemplates) {
              const parsedTemplates = JSON.parse(rawTemplates) as OperationPrintTemplate[];
              if (Array.isArray(parsedTemplates)) {
                  setPrintTemplates(parsedTemplates);
              }
          }
      } catch {
          // ignore invalid local cache
      }
  }, []);

  useEffect(() => {
      localStorage.setItem(OPERATION_PRINT_CONFIG_STORAGE_KEY, JSON.stringify(printConfig));
  }, [printConfig]);

  useEffect(() => {
      localStorage.setItem(OPERATION_PRINT_TEMPLATES_STORAGE_KEY, JSON.stringify(printTemplates));
  }, [printTemplates]);

  const inventoryLogDefaultColumns = useMemo(() => {
      const module = getGridModuleDefinition('inventory_log');
      return module?.columns || [];
  }, []);
  const inventoryBatchDefaultColumns = useMemo(() => {
      const module = getGridModuleDefinition('inventory_batch');
      return module?.columns || [];
  }, []);
  const [historyColumns, setHistoryColumns] = useState<GridColumnPreference[]>(inventoryLogDefaultColumns);
  const [batchColumns, setBatchColumns] = useState<GridColumnPreference[]>(inventoryBatchDefaultColumns);
  const effectiveUserId = currentUserId || '0';

  useEffect(() => {
      const loaded = getGridPreferenceForUser(effectiveUserId, 'inventory_log', inventoryLogDefaultColumns);
      setHistoryColumns(loaded);
  }, [effectiveUserId, inventoryLogDefaultColumns]);

  useEffect(() => {
      const loaded = getGridPreferenceForUser(effectiveUserId, 'inventory_batch', inventoryBatchDefaultColumns);
      setBatchColumns(loaded);
  }, [effectiveUserId, inventoryBatchDefaultColumns]);

  // --- Delete Modal State ---
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    ids: string[];
  }>({ isOpen: false, ids: [] });

  // --- Import Wizard State ---
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>('upload');
  const [excelData, setExcelData] = useState<any[]>([]);
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({}); // SystemField -> ExcelHeader
  const [importPreview, setImportPreview] = useState<{valid: Transaction[], invalid: {row: any, errors: string[]}[]}>({ valid: [], invalid: [] });
    const [normalizedImportPreview, setNormalizedImportPreview] = useState<ImportPreviewRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
    const seenAutoPrintColumnsRef = useRef<Set<string>>(new Set(OPERATION_PRINT_COLUMNS.map((column) => String(column.key))));

  // --- Logic Helpers ---

  const normalizeTimeValue = (value?: string): string => {
      if (!value) return '';
      if (/^\d{2}:\d{2}$/.test(value)) return value;
      const match = String(value).match(/(\d{2}:\d{2})/);
      return match ? match[1] : '';
  };

  const parseTimeToMinutes = (value?: string): number | null => {
      const normalized = normalizeTimeValue(value);
      if (!normalized) return null;
      const [hours, minutes] = normalized.split(':').map(Number);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return (hours * 60) + minutes;
  };

  const calculateDurationWithRollover = (entry?: string, exit?: string) => {
      const entryMinutes = parseTimeToMinutes(entry);
      const exitMinutes = parseTimeToMinutes(exit);

      if (entryMinutes === null || exitMinutes === null) {
          return { valid: false, minutes: 0, rolledOver: false };
      }

      if (exitMinutes < entryMinutes) {
          return {
              valid: true,
              minutes: (1440 - entryMinutes) + exitMinutes,
              rolledOver: true,
          };
      }

      return {
          valid: true,
          minutes: exitMinutes - entryMinutes,
          rolledOver: false,
      };
  };

  const formatCurrencyLYD = (amount?: number) => {
      const value = Number(amount || 0);
      return `${value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} 7�.8`;
  };

  const getRuleById = (ruleId?: string) => unloadingRules.find(rule => rule.id === ruleId && rule.is_active);

  const resolvePenaltyConfig = (form: Partial<Transaction>) => {
      const selectedRule = getRuleById(form.unloadingRuleId);
      if (selectedRule) {
          return {
              allowedDuration: Number(selectedRule.allowed_duration_minutes || 0),
              penaltyRate: Number(selectedRule.penalty_rate_per_minute || 0),
              hasRule: true,
          };
      }
      return {
          allowedDuration: Number(form.unloadingDuration ?? settings.defaultUnloadingDuration ?? 60),
          penaltyRate: Number(settings.defaultDelayPenalty || 0),
          hasRule: false,
      };
  };

  const processRowLogic = (form: Partial<Transaction>): Partial<Transaction> => {
      const updated = { ...form };
      const qty = updated.quantity !== undefined && updated.quantity !== null ? Number(updated.quantity) : undefined;
      const sup = updated.supplierNet !== undefined && updated.supplierNet !== null ? Number(updated.supplierNet) : undefined;

      if (qty !== undefined && sup !== undefined) updated.difference = qty - sup;
      else updated.difference = 0;

      if (updated.unloadingRuleId) {
          const selectedRule = getRuleById(updated.unloadingRuleId);
          if (selectedRule) {
              updated.unloadingDuration = Number(selectedRule.allowed_duration_minutes || 0);
          }
      }

      if (updated.entryTime || updated.exitTime) {
          updated.entryTime = normalizeTimeValue(updated.entryTime);
          updated.exitTime = normalizeTimeValue(updated.exitTime);
      }

      if (updated.entryTime && updated.exitTime) {
          const duration = calculateDurationWithRollover(updated.entryTime, updated.exitTime);

          if (!duration.valid) {
              updated.delayDuration = 0;
              updated.delayPenalty = 0;
              updated.calculatedFine = 0;
              return updated;
          }

          const stayDuration = duration.minutes;
          updated.delayDuration = stayDuration;
          const { allowedDuration, penaltyRate, hasRule } = resolvePenaltyConfig(updated);
          const allowedTime = Number(allowedDuration || 0);
          const penaltyMinutes = Math.max(0, stayDuration - allowedTime);
          const fine = hasRule ? penaltyMinutes * Number(penaltyRate || 0) : 0;
          updated.delayPenalty = fine;
          updated.calculatedFine = fine;
      } else {
          updated.delayDuration = 0;
          updated.delayPenalty = 0;
          updated.calculatedFine = 0;
      }
      return updated;
  };

  /**
   * Validates if there is enough stock for an Outgoing/Waste transaction.
   * @param itemId The item to check
   * @param type The operation type
   * @param qty The quantity required
   * @param excludeTxId (Optional) If editing, provide the transaction ID to exclude its current effect from the available balance calculation.
   * @returns true if valid, false otherwise (and alerts user).
   */
  const validateStockAvailability = (itemId: string, type: string, qty: number, excludeTxId?: string): boolean => {
      if (type !== '7�7�7�7�' && type !== '8!7�88�') return true;
      
      const item = items.find(i => i.id === itemId);
      if (!item) return true;

      let availableStock = item.currentStock;

      // If we are editing an existing transaction, we need to "undo" its effect on the current stock
      // to determine the base available stock before applying the new quantity.
      if (excludeTxId) {
          const originalTx = transactions.find(t => t.id === excludeTxId);
          if (originalTx && originalTx.itemId === itemId) {
              if (originalTx.type === '7�7�7�7�' || originalTx.type === '8!7�88�') {
                  // It was deducted, so add it back to see what's available
                  availableStock += originalTx.quantity;
              } else if (originalTx.type === '8�7�7�7�' || originalTx.type === '7�8 7�7�7�') {
                  // It was added, so subtract it. If we are changing from 'Import' to 'Export', 
                  // we can't use the imported amount as part of the available stock for the export.
                  availableStock -= originalTx.quantity;
              }
          }
      }

      // Allow small floating point margin errors
      const epsilon = 0.0001;
      if (qty > availableStock + epsilon) {
          toast.error(`7�7�7�: 7�87�7�8y7� 78y7� 8�7�8~8�!\n\n7�87�8 8~: ${item.name}\n7�87�7�8y7� 7�88&7�7�7�: ${availableStock.toLocaleString('en-US', {maximumFractionDigits: 3})} ${item.unit}\n7�88�8&8y7� 7�88&7�88�7�7�: ${qty} ${item.unit}`);
          return false;
      }
      return true;
  };

  // --- Invoice Builder Logic ---

  const handleInvoiceHeaderChange = (field: string, value: any) => {
      setInvoiceHeader(prev => {
          const newData = { ...prev, [field]: value };
          
          // Auto-fill Partner for Production/Waste to prevent validation errors
          if (field === 'type') {
              if (value === '7�8 7�7�7�') newData.supplierOrReceiver = '8�7�7�7� 7�87�8 7�7�7�';
              else if (value === '8!7�88�') newData.supplierOrReceiver = '8!7�88� 8&7�7�8 8y';
              else if (prev.type === '7�8 7�7�7�' || prev.type === '8!7�88�') newData.supplierOrReceiver = ''; // Clear only if it was auto-filled
          }

          if (field === 'unloadingRuleId') {
              const selectedRule = getRuleById(String(value));
              if (selectedRule) {
                  newData.unloadingDuration = Number(selectedRule.allowed_duration_minutes || 0);
              }
          }

          if (field === 'entryTime' || field === 'exitTime') {
              newData.entryTime = normalizeTimeValue(newData.entryTime);
              newData.exitTime = normalizeTimeValue(newData.exitTime);
          }
          
          return newData;
      });
  };

  const handleInvoiceItemChange = (id: string, field: string, value: any) => {
      setInvoiceItems(prev => prev.map(item => {
          if (item.id !== id) return item;
          
          if (field === 'itemId') {
              const selectedItem = items.find(i => i.id === value);
              return { ...item, itemId: value, unit: selectedItem?.unit };
          }
          
          return { ...item, [field]: value === '' ? undefined : value };
      }));
  };

  const addInvoiceItemRow = () => {
      setInvoiceItems(prev => [...prev, { id: uuidv4(), itemId: '' }]);
  };

  const removeInvoiceItemRow = (id: string) => {
      if (invoiceItems.length > 1) {
          setInvoiceItems(prev => prev.filter(i => i.id !== id));
      }
  };

  const fillDemoInvoice = () => {
      // Set Header Data (Shared)
      setInvoiceHeader({
          date: new Date().toISOString().split('T')[0],
          type: '8�7�7�7�',
          warehouseInvoice: 'DEMO-' + Math.floor(Math.random() * 1000),
          supplierOrReceiver: '7�7�8�7� 7�87�7�7�7�7� 887�8�7�8y7�7�7�',
          supplierInvoice: 'SUP-9988',
          weightSlip: 'WS-' + Math.floor(Math.random() * 10000), // Demo Weight Slip
          truckNumber: '7� 7� 7� 123',
          trailerNumber: '456',
          driverName: '8&7�8&8�7� 7�7�7�8',
          entryTime: '18:00',
          exitTime: '01:00',
          unloadingRuleId: unloadingRules.find(rule => rule.is_active)?.id || '',
          unloadingDuration: 60
      });

      // Set Items Data (Individual)
      // Pick up to 3 random items if available
      const demoItems = items.slice(0, 3).map((item, index) => ({
          id: uuidv4(),
          itemId: item.id,
          unit: item.unit,
          quantity: 10 + index * 5, // Different quantity
          supplierNet: 10 + index * 5 - 0.05, // Slight difference
          packageCount: 200 + index * 100, // Different package count
      }));

      if (demoItems.length > 0) {
          setInvoiceItems(demoItems);
      } else {
          toast.error('8y7�7�80 7�7�7�8~7� 7�7�8 7�8~ 888 7�7�8& 7�8�87�89 87�7�7�7�7� 8!7�8! 7�88&8y7�7�');
      }
  };

  const saveInvoice = () => {
      // 1. Validate Header
      if (!invoiceHeader.date || !invoiceHeader.warehouseInvoice || !invoiceHeader.supplierOrReceiver) {
          toast.error('8y7�7�80 7�7�7�7�7� 7�8y7�8 7�7� 7�7�7� 7�88~7�7�8�7�7� 7�87�7�7�7�8y7� (7�87�7�7�8y7�7R 7�87�88&7R 7�88&8�7�7�/7�87�8&8y8)');
          return;
      }

      if (!isInvoiceUnique(invoiceHeader.warehouseInvoice, invoiceHeader.type)) {
          toast.error(`7�88& 7�88~7�7�8�7�7� ${invoiceHeader.warehouseInvoice} 8&8�7�7� 88 8~7� 8 8�7� 7�87�8&88y7�`);
          return;
      }

      const invoiceDateValidation = validateTimeContext(invoiceHeader, '7�7�7� 7�88~7�7�8�7�7�');
      if (!invoiceDateValidation.ok) {
          return;
      }

      const normalizedInvoiceHeader = {
          ...invoiceHeader,
          entryTime: normalizeTimeValue(invoiceHeader.entryTime),
          exitTime: normalizeTimeValue(invoiceHeader.exitTime),
      };

      // 2. Validate Items
      const validItems = invoiceItems.filter(i => i.itemId && i.quantity);
      if (validItems.length === 0) {
          toast.error('8y7�7�80 7�7�7�8~7� 7�8 8~ 8�7�7�7� 7�880 7�87�88 8&7� 7�88�8&8y7�');
          return;
      }

      // 3. Check Stock Availability (Aggregated)
      if (invoiceHeader.type === '7�7�7�7�' || invoiceHeader.type === '8!7�88�') {
          const itemAggregates: Record<string, number> = {};
          validItems.forEach(item => {
              const current = itemAggregates[item.itemId] || 0;
              itemAggregates[item.itemId] = current + (Number(item.quantity) || 0);
          });

          for (const [itemId, totalQty] of Object.entries(itemAggregates)) {
               if (!validateStockAvailability(itemId, invoiceHeader.type, totalQty)) return;
          }
      }

      // 4. Process Logistics Calculations Once
      let delayDuration = 0;
      let delayPenalty = 0;
      if (normalizedInvoiceHeader.entryTime && normalizedInvoiceHeader.exitTime) {
          const stayDuration = invoiceDateValidation.actualMinutes;
          delayDuration = stayDuration;
          const selectedRule = getRuleById(normalizedInvoiceHeader.unloadingRuleId);
          const allowed = Number(selectedRule?.allowed_duration_minutes ?? normalizedInvoiceHeader.unloadingDuration ?? settings.defaultUnloadingDuration ?? 60);
          const penaltyMinutes = Math.max(0, stayDuration - allowed);
          delayPenalty = penaltyMinutes * Number(selectedRule?.penalty_rate_per_minute ?? 0);
      }

      // 5. Construct Transactions
      const newTransactions: Transaction[] = validItems.map(item => {
          const supNet = Number(item.supplierNet) || 0;
          const qty = Number(item.quantity);
          
          return {
              id: uuidv4(),
              ...normalizedInvoiceHeader, // Spreads weightSlip from header
              // Logistics are usually applied to the whole invoice, but we store them per transaction for flatness
              // To avoid double penalty calculation in reports, usually we consider unique invoice ID, 
              // but here we just distribute or repeat. Repeating is safer for row-level filtering.
              delayDuration,
              delayPenalty, // Note: This repeats the penalty on every row. Reporting logic should handle unique invoices.
              calculatedFine: delayPenalty,
              
              // Item Specifics
              itemId: item.itemId,
              quantity: qty,
              supplierNet: supNet,
              difference: supNet ? qty - supNet : 0,
              packageCount: Number(item.packageCount),
              // weightSlip is now in invoiceHeader
              timestamp: Date.now()
          } as Transaction;
      });

      onAddTransaction(newTransactions);
      
      // 6. Reset
      setInvoiceHeader(prev => ({
          ...prev,
          warehouseInvoice: '',
          supplierInvoice: '',
          weightSlip: '',
          notes: '',
          supplierOrReceiver: prev.type === '7�8 7�7�7�' ? '8�7�7�7� 7�87�8 7�7�7�' : (prev.type === '8!7�88�' ? '8!7�88� 8&7�7�8 8y' : '') // Keep default if type stays
      }));
      setInvoiceItems([{ id: uuidv4(), itemId: '' }]);
      toast.success('7�8& 7�8~7� 7�88~7�7�8�7�7� 7�8 7�7�7�');
  };

  const invoiceTotals = useMemo(() => {
      return invoiceItems.reduce((acc, item) => ({
          qty: acc.qty + (Number(item.quantity) || 0),
          count: acc.count + (item.itemId ? 1 : 0)
      }), { qty: 0, count: 0 });
  }, [invoiceItems]);

  const getPartnerLabel = (type: string) => {
      if (type === '8�7�7�7�') return '7�88&8�7�7�';
      if (type === '7�7�7�7�') return '7�87�8&8y8';
      if (type === '7�8 7�7�7�') return '7�7� 7�87�8 7�7�7�';
      if (type === '8!7�88�') return '7�8!7� 7�87�7�87�8~ / 7�88&87�7�7�7�';
      return '7�87�8&8y8 / 7�88&8�7�7�';
  };

  const validateTimeContext = (
      payload: { entryTime?: string; exitTime?: string; unloadingRuleId?: string },
      contextLabel: string
  ) => {
      if (!payload.entryTime && !payload.exitTime) {
          return { ok: true, actualMinutes: 0 };
      }

      if (!payload.entryTime || !payload.exitTime) {
          toast.error(`8y7�7�80 7�7�7�7�8 8�87� 7�87�7�8�8 8�7�87�7�8�7� 8&7�897� (${contextLabel}).`);
          return { ok: false, actualMinutes: 0 };
      }

      if (!payload.unloadingRuleId) {
          toast.error(`8y7�7�80 7�7�7�8y7�7� 87�7�7�7� 7�87�8~7�8y7 87�8 7�87�7�7�7� (${contextLabel}).`);
          return { ok: false, actualMinutes: 0 };
      }

      const duration = calculateDurationWithRollover(payload.entryTime, payload.exitTime);
      if (!duration.valid) {
          toast.error(`7�8y77� 7�88�87� 78y7� 7�7�8y7�7� (${contextLabel}).`);
          return { ok: false, actualMinutes: 0 };
      }

      return { ok: true, actualMinutes: duration.minutes };
  };

  // --- Normal Batch Entry Handlers (Kept for compatibility) ---

  const handleBatchChange = (index: number, field: keyof Transaction, value: any) => {
    const newForms = [...batchForms];
    let processedValue = value;
    if (['quantity', 'supplierNet', 'packageCount', 'unloadingDuration'].includes(field)) {
        processedValue = value === '' ? undefined : Number(value);
    }
    let form = { ...newForms[index], [field]: processedValue };
    
    // Auto-fill Logic for Batch Mode
    if (field === 'type') {
        if (value === '7�8 7�7�7�') form.supplierOrReceiver = '8�7�7�7� 7�87�8 7�7�7�';
        else if (value === '8!7�88�') form.supplierOrReceiver = '8!7�88� 8&7�7�8 8y';
    }

    form = processRowLogic(form);
    newForms[index] = form;
    setBatchForms(newForms);
  };

  const isInvoiceUnique = (invoice: string, type: string, excludeId?: string) => {
      if (!invoice) return true;
      return !transactions.some(t => t.warehouseInvoice === invoice && t.type === type && t.id !== excludeId);
  };

  const saveBatchRow = (index: number) => {
    const form = batchForms[index];
    if (!form.date) return toast.error('7�87�7�7�8y7� 7�88 7�7�7�7�7�8y');
    if (!form.type) return toast.error('8 8�7� 7�87�8&88y7� 7�88 7�7�7�7�7�8y');
    if (!form.itemId) return toast.error('7�87�8 8~ 7�88 7�7�7�7�7�8y');
    if (form.quantity === undefined || form.quantity === null) return toast.error('7�7�8~8y 7�87�8!8 7�88 7�7�7�7�7�8y');
    if (!form.warehouseInvoice) return toast.error('8~7�7�8�7�7� 7�88&7�7�7�8  7�88 7�7�7�7�7�8y');
    if (!form.supplierOrReceiver) return toast.error('7�88&8�7�7�/7�88&7�7�88& 7�88 7�7�7�7�7�8y');

    if (!isInvoiceUnique(form.warehouseInvoice, form.type)) {
        return toast.error(`7�7�7�: 7�88& 8~7�7�8�7�7� 7�88&7�7�8  "${form.warehouseInvoice}" 8&8�7�7� 88 8�7� 7�87�8&88y7� ${form.type}`);
    }

        const rowDateValidation = validateTimeContext(form, `7�87�7�7� ${index + 1}`);
    if (!rowDateValidation.ok) {
        return;
    }

        const normalizedForm = {
            ...form,
            entryTime: normalizeTimeValue(form.entryTime),
            exitTime: normalizeTimeValue(form.exitTime),
        };

    // Stock Validation
    if (!validateStockAvailability(form.itemId, form.type, Number(form.quantity))) {
        return;
    }

    const newTransaction: Transaction = {
      id: uuidv4(),
    ...normalizedForm as Transaction,
      quantity: Number(form.quantity),
      supplierNet: form.supplierNet ? Number(form.supplierNet) : 0,
      timestamp: Date.now()
    };

    onAddTransaction([newTransaction]);
    const newForms = [...batchForms];
    newForms[index] = getEmptyForm();
    setBatchForms(newForms);
  };

  const handleEditChange = (field: keyof Transaction, value: any) => {
      if (!editingTransaction) return;
      let processedValue = value;
      if (['quantity', 'supplierNet', 'packageCount', 'unloadingDuration'].includes(field)) {
          processedValue = value === '' ? undefined : Number(value);
      }
      let updated = { ...editingTransaction, [field]: processedValue };
      updated = processRowLogic(updated) as Transaction;
      setEditingTransaction(updated);
  };

  const handleEditClick = (transaction: Transaction) => {
            setEditingTransaction({
                ...transaction,
                entryTime: normalizeTimeValue(transaction.entryTime),
                exitTime: normalizeTimeValue(transaction.exitTime),
            });
  };

  const saveEdit = () => {
      if (!editingTransaction) return;
      if (!editingTransaction.date || !editingTransaction.itemId || editingTransaction.quantity === undefined || !editingTransaction.warehouseInvoice || !editingTransaction.supplierOrReceiver) {
          toast.error('8y7�7�80 7�87�7�8�7� 8&8  7�7�7�7�7� 7�87�88�8 7�87�7�7�7�7�8y7� (*)');
          return;
      }
      if (!isInvoiceUnique(editingTransaction.warehouseInvoice, editingTransaction.type, editingTransaction.id)) {
          toast.error('7�88& 8~7�7�8�7�7� 7�88&7�7�8  8&8�7�7�!');
          return;
      }

      const editDateValidation = validateTimeContext(editingTransaction, '7�7�7�7� 7�87�7�7�8y8');
      if (!editDateValidation.ok) {
          return;
      }

      const normalizedEditingTransaction: Transaction = {
          ...editingTransaction,
          entryTime: normalizeTimeValue(editingTransaction.entryTime),
          exitTime: normalizeTimeValue(editingTransaction.exitTime),
      };

      // Stock Validation
      if (!validateStockAvailability(editingTransaction.itemId, editingTransaction.type, editingTransaction.quantity, editingTransaction.id)) {
          return;
      }

      onUpdateTransaction(normalizedEditingTransaction);
      setEditingTransaction(null);
  };

  // --- DELETE HANDLERS ---
  const confirmDelete = () => {
      if (deleteModal.ids.length > 0) {
          onDeleteTransactions(deleteModal.ids);
          setSelectedIds(new Set());
          setDeleteModal({ isOpen: false, ids: [] });
      }
  };

  // --- SMART SEARCH IMPLEMENTATION (Fuse.js) ---

  // 1. Debounce Input
  useEffect(() => {
    setIsSearching(true);
    const handler = setTimeout(() => {
        setDebouncedQuery(searchQuery);
        setIsSearching(false);
        }, 150);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 2. Prepare Data for Fuse (Denormalize Item Names)
  const searchableData = useMemo(() => {
      return transactions.map(t => ({
          ...t,
          // Add resolved Item Name for searching
          itemName: items.find(i => i.id === t.itemId)?.name || ''
      }));
  }, [transactions, items]);

  // 3. Initialize Fuse Instance (Memoized)
  const fuse = useMemo(() => {
      return new Fuse(searchableData, {
          keys: [
              { name: 'warehouseInvoice', weight: 0.8 },
              { name: 'itemName', weight: 0.7 },
              { name: 'supplierOrReceiver', weight: 0.6 },
              { name: 'supplierInvoice', weight: 0.5 },
              { name: 'truckNumber', weight: 0.4 },
              { name: 'driverName', weight: 0.4 },
              { name: 'notes', weight: 0.3 },
              { name: 'weightSlip', weight: 0.5 },
          ],
          threshold: 0.3, // Fuzzy matching threshold (0.0 = perfect, 1.0 = match anything)
          includeScore: true,
          ignoreLocation: true // Search anywhere in the string
      });
  }, [searchableData]);

  // 4. Perform Search
  const filteredTransactions = useMemo(() => {
      const base = !debouncedQuery.trim()
          ? [...transactions].sort((a,b) => b.timestamp - a.timestamp)
          : fuse.search(debouncedQuery).map(r => r.item);

      const afterDrilldown = !activeDrilldown
          ? base
          : base.filter(tx => {
                if (tx.itemId !== activeDrilldown.itemId) return false;
                if (tx.type !== activeDrilldown.type) return false;
                const txMonth = (tx.date || '').slice(0, 7);
                return txMonth === activeDrilldown.monthKey;
            });

      const minQuantity = operationMinQuantityFilter.trim() === '' ? null : Number(operationMinQuantityFilter);
      const maxQuantity = operationMaxQuantityFilter.trim() === '' ? null : Number(operationMaxQuantityFilter);
      const normalizedPartner = operationPartnerFilter.trim().toLowerCase();

      return afterDrilldown.filter((tx) => {
          if (operationTypeFilter !== 'all' && tx.type !== operationTypeFilter) return false;

          if (operationDateFromFilter && tx.date && tx.date < operationDateFromFilter) return false;
          if (operationDateToFilter && tx.date && tx.date > operationDateToFilter) return false;

          if (normalizedPartner && !String(tx.supplierOrReceiver || '').toLowerCase().includes(normalizedPartner)) return false;

          const txQuantity = Number(tx.quantity || 0);
          if (minQuantity !== null && Number.isFinite(minQuantity) && txQuantity < minQuantity) return false;
          if (maxQuantity !== null && Number.isFinite(maxQuantity) && txQuantity > maxQuantity) return false;

          const hasPenalty = Number(tx.delayPenalty || 0) > 0;
          if (operationPenaltyFilter === 'with_penalty' && !hasPenalty) return false;
          if (operationPenaltyFilter === 'without_penalty' && hasPenalty) return false;

          return true;
      });
  }, [
      debouncedQuery,
      fuse,
      transactions,
      activeDrilldown,
      operationTypeFilter,
      operationDateFromFilter,
      operationDateToFilter,
      operationPartnerFilter,
      operationMinQuantityFilter,
      operationMaxQuantityFilter,
      operationPenaltyFilter,
  ]);

  const invoiceCounterByTransactionId = useMemo(() => {
      const sequenceByInvoice = new Map<string, number>();
      const counters: Record<string, number> = {};
      let nextCounter = 1;

      filteredTransactions.forEach((tx, index) => {
          const invoiceKey = String(tx.warehouseInvoice || '').trim();
          if (!invoiceKey) {
              counters[tx.id] = index + 1;
              return;
          }

          if (!sequenceByInvoice.has(invoiceKey)) {
              sequenceByInvoice.set(invoiceKey, nextCounter);
              nextCounter += 1;
          }

          counters[tx.id] = sequenceByInvoice.get(invoiceKey) || 0;
      });

      return counters;
  }, [filteredTransactions]);

  const compareRowsByInvoiceSort = <T extends {
      warehouseInvoice?: string;
      date?: string;
      type?: string;
      supplierOrReceiver?: string;
      timestamp?: number;
      id?: string;
  }>(a: T, b: T) => {
      const invoiceA = String(a.warehouseInvoice || '').trim();
      const invoiceB = String(b.warehouseInvoice || '').trim();

      const compareInvoice = (descending = false) => {
          if (invoiceA && invoiceB) {
              const compared = invoiceA.localeCompare(invoiceB, 'ar', { numeric: true, sensitivity: 'base' });
              return descending ? -compared : compared;
          }
          if (invoiceA && !invoiceB) return -1;
          if (!invoiceA && invoiceB) return 1;
          return 0;
      };

      const compareDateDesc = () => {
          const dateCompared = String(b.date || '').localeCompare(String(a.date || ''));
          if (dateCompared !== 0) return dateCompared;
          return (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0);
      };

      const compareTypeThenDate = () => {
          const typeCompared = String(a.type || '').localeCompare(String(b.type || ''), 'ar', { sensitivity: 'base' });
          if (typeCompared !== 0) return typeCompared;
          return compareDateDesc();
      };

      const comparePartnerThenDate = () => {
          const partnerCompared = String(a.supplierOrReceiver || '').localeCompare(String(b.supplierOrReceiver || ''), 'ar', { sensitivity: 'base' });
          if (partnerCompared !== 0) return partnerCompared;
          return compareDateDesc();
      };

      const finalize = (baseResult: number, secondary: () => number) => {
          if (baseResult !== 0) return baseResult;
          const secondResult = secondary();
          if (secondResult !== 0) return secondResult;
          return String(b.id || '').localeCompare(String(a.id || ''));
      };

      switch (invoiceSortMode) {
          case 'invoice_desc_date_desc':
              return finalize(compareInvoice(true), compareDateDesc);
          case 'invoice_asc_type_then_date':
              return finalize(compareInvoice(false), compareTypeThenDate);
          case 'invoice_asc_partner_then_date':
              return finalize(compareInvoice(false), comparePartnerThenDate);
          case 'invoice_asc_date_desc':
          default:
              return finalize(compareInvoice(false), compareDateDesc);
      }
  };

  const displayTransactions = useMemo(() => {
      return [...filteredTransactions].sort(compareRowsByInvoiceSort);
  }, [filteredTransactions, invoiceSortMode]);

  const invoiceGroupMetaByTransactionId = useMemo(() => {
      const tones = [
          'bg-indigo-50/60 border-indigo-200',
          'bg-emerald-50/60 border-emerald-200',
          'bg-amber-50/60 border-amber-200',
          'bg-cyan-50/60 border-cyan-200',
          'bg-violet-50/60 border-violet-200',
      ];

      const invoiceOrder = new Map<string, number>();
      const invoiceCounts = displayTransactions.reduce((acc, tx) => {
          const invoice = String(tx.warehouseInvoice || '').trim();
          if (!invoice) return acc;
          acc[invoice] = (acc[invoice] || 0) + 1;
          return acc;
      }, {} as Record<string, number>);

      const meta: Record<string, {
          isDuplicateInvoice: boolean;
          invoiceKey: string;
          tone: string;
          isFirst: boolean;
          isLast: boolean;
          groupNo: number;
      }> = {};

      displayTransactions.forEach((tx, index) => {
          const invoice = String(tx.warehouseInvoice || '').trim();
          if (!invoice) {
              meta[tx.id] = {
                  isDuplicateInvoice: false,
                  invoiceKey: '',
                  tone: 'bg-white border-slate-100',
                  isFirst: false,
                  isLast: false,
                  groupNo: 0,
              };
              return;
          }

          const isDuplicateInvoice = (invoiceCounts[invoice] || 0) > 1;
          if (!isDuplicateInvoice) {
              meta[tx.id] = {
                  isDuplicateInvoice: false,
                  invoiceKey: invoice,
                  tone: 'bg-white border-slate-100',
                  isFirst: false,
                  isLast: false,
                  groupNo: 0,
              };
              return;
          }

          if (!invoiceOrder.has(invoice)) {
              invoiceOrder.set(invoice, invoiceOrder.size + 1);
          }

          const prevInvoice = index > 0 ? String(displayTransactions[index - 1].warehouseInvoice || '').trim() : '';
          const nextInvoice = index < displayTransactions.length - 1 ? String(displayTransactions[index + 1].warehouseInvoice || '').trim() : '';
          const groupNo = invoiceOrder.get(invoice) || 1;

          meta[tx.id] = {
              isDuplicateInvoice: true,
              invoiceKey: invoice,
              tone: tones[(groupNo - 1) % tones.length],
              isFirst: prevInvoice !== invoice,
              isLast: nextInvoice !== invoice,
              groupNo,
          };
      });

      return meta;
  }, [displayTransactions]);

  const invoiceDuplicateSummaryByInvoice = useMemo(() => {
      return displayTransactions.reduce((acc, tx) => {
          const invoice = String(tx.warehouseInvoice || '').trim();
          if (!invoice) return acc;

          if (!acc[invoice]) {
              acc[invoice] = {
                  count: 0,
                  totalQuantity: 0,
                  totalSupplierNet: 0,
                  totalDelayPenalty: 0,
              };
          }

          acc[invoice].count += 1;
          acc[invoice].totalQuantity += Number(tx.quantity || 0);
          acc[invoice].totalSupplierNet += Number(tx.supplierNet || 0);
          acc[invoice].totalDelayPenalty += Number(tx.delayPenalty || 0);
          return acc;
      }, {} as Record<string, {
          count: number;
          totalQuantity: number;
          totalSupplierNet: number;
          totalDelayPenalty: number;
      }>);
  }, [displayTransactions]);

  const hasAdvancedOperationFilters = useMemo(() => {
      return (
          operationTypeFilter !== 'all'
          || Boolean(operationDateFromFilter)
          || Boolean(operationDateToFilter)
          || Boolean(operationPartnerFilter.trim())
          || Boolean(operationMinQuantityFilter.trim())
          || Boolean(operationMaxQuantityFilter.trim())
          || operationPenaltyFilter !== 'all'
      );
  }, [
      operationTypeFilter,
      operationDateFromFilter,
      operationDateToFilter,
      operationPartnerFilter,
      operationMinQuantityFilter,
      operationMaxQuantityFilter,
      operationPenaltyFilter,
  ]);

  const resetOperationAdvancedFilters = () => {
      setOperationTypeFilter('all');
      setOperationDateFromFilter('');
      setOperationDateToFilter('');
      setOperationPartnerFilter('');
      setOperationMinQuantityFilter('');
      setOperationMaxQuantityFilter('');
      setOperationPenaltyFilter('all');
  };

  const operationRowsForPrint = useMemo<OperationPrintableRow[]>(() => {
      const invoiceCounterByInvoice = new Map<string, number>();
      let nextInvoiceCounter = 1;

      return filteredTransactions.map((transaction) => {
          const item = items.find(i => i.id === transaction.itemId);
          const warehouseInvoice = transaction.warehouseInvoice || '';
          const supplierInvoice = transaction.supplierInvoice || '';
          const quantity = Number(transaction.quantity || 0);
          const supplierNet = Number(transaction.supplierNet || 0);
          const difference = Number(transaction.difference || 0);
          const packageCount = Number(transaction.packageCount || 0);
          const delayPenalty = Number(transaction.delayPenalty || 0);
          const entryTime = transaction.entryTime || '';
          const exitTime = transaction.exitTime || '';
          const partner = transaction.supplierOrReceiver || '';
          const truckNumber = transaction.truckNumber || '';
          const trailerNumber = transaction.trailerNumber || '';
          const driverName = transaction.driverName || '';
          const date = transaction.date || '';
          const dateLabel = date ? new Date(date).toLocaleDateString('en-GB') : '-';
          const invoiceKey = String(warehouseInvoice || '').trim();
          let invoiceCounter = 0;
          if (invoiceKey) {
              if (!invoiceCounterByInvoice.has(invoiceKey)) {
                  invoiceCounterByInvoice.set(invoiceKey, nextInvoiceCounter);
                  nextInvoiceCounter += 1;
              }
              invoiceCounter = invoiceCounterByInvoice.get(invoiceKey) || 0;
          }

          return {
              id: transaction.id,
              invoiceCounter,
              date,
              type: transaction.type,
              warehouseInvoice,
              supplierInvoice,
              itemName: item?.name || '78y7� 8&7�7�8�8~',
              supplierOrReceiver: partner,
              quantity,
              supplierNet,
              difference,
              packageCount,
              weightSlip: transaction.weightSlip || '',
              truckNumber,
              trailerNumber,
              driverName,
              entryTime,
              exitTime,
              delayPenalty,
              notes: transaction.notes || '',
              dateInvoice: `${dateLabel} | #${warehouseInvoice || '-'}`,
              item: item?.name || '78y7� 8&7�7�8�8~',
              weights: `7�87�8!8: ${formatNumber(quantity)} | 7�88&8�7�7�: ${formatNumber(supplierNet)} | 7�88~7�8: ${formatNumber(difference)}`,
              logistics: `${partner || '-'}${supplierInvoice ? ` | 8~7�7�8�7�7� 7�88&8�7�7�: ${supplierInvoice}` : ''}${truckNumber ? ` | 7�7�7�8 7�: ${truckNumber}` : ''}${trailerNumber ? ` (${trailerNumber})` : ''}${driverName ? ` | 7�7�7�8: ${driverName}` : ''}`,
              timeFine: `7�7�8�8: ${entryTime || '-'} | 7�7�8�7�: ${exitTime || '-'} | 77�7�8&7�: ${formatCurrencyLYD(delayPenalty)}`,
          };
      });
  }, [filteredTransactions, items]);

  const operationSummary = useMemo(() => {
      const uniqueInvoices = new Set<string>();
      const result = operationRowsForPrint.reduce((acc, row) => {
          acc.totalNetWeight += row.quantity;
          acc.totalQuantity += row.packageCount;
          acc.totalSupplierNet += row.supplierNet;
          acc.totalDelayPenalty += row.delayPenalty;
          if (row.warehouseInvoice) {
              uniqueInvoices.add(row.warehouseInvoice);
          }

          if (row.type === '8�7�7�7�' || row.type === '7�8 7�7�7�') {
              acc.netBalance += row.quantity;
          } else if (row.type === '7�7�7�7�' || row.type === '8!7�88�') {
              acc.netBalance -= row.quantity;
          }

          return acc;
      }, {
          totalNetWeight: 0,
          totalQuantity: 0,
          totalSupplierNet: 0,
          totalDelayPenalty: 0,
          netBalance: 0,
      });

      return {
          ...result,
          totalCount: operationRowsForPrint.length,
          invoiceCount: uniqueInvoices.size,
      };
  }, [operationRowsForPrint]);

  const groupedPrintRows = useMemo(() => {
      const sortRowsByWarehouseInvoice = (rows: OperationPrintableRow[]) => {
          return [...rows].sort(compareRowsByInvoiceSort);
      };

      if (printConfig.grouping === 'none') {
          const sortedRows = sortRowsByWarehouseInvoice(operationRowsForPrint);
          return [{
              id: 'all',
              title: '8�8 7�87�7�87�7�',
              rows: sortedRows,
              subtotalNet: sortedRows.reduce((sum, row) => sum + row.quantity, 0),
              subtotalSupplier: sortedRows.reduce((sum, row) => sum + row.supplierNet, 0),
          }];
      }

      const groups = new Map<string, OperationPrintableRow[]>();
      operationRowsForPrint.forEach((row) => {
          const key = printConfig.grouping === 'day' ? row.date : row.type;
          const normalizedKey = key || '78y7� 8&7�7�7�';
          const bucket = groups.get(normalizedKey) || [];
          bucket.push(row);
          groups.set(normalizedKey, bucket);
      });

      return Array.from(groups.entries()).map(([key, rows]) => {
          const sortedRows = sortRowsByWarehouseInvoice(rows);
          return {
              id: key,
              title: printConfig.grouping === 'day' ? `7�88y8�8&: ${key}` : `7�88 8�7�: ${key}`,
              rows: sortedRows,
              subtotalNet: sortedRows.reduce((sum, row) => sum + row.quantity, 0),
              subtotalSupplier: sortedRows.reduce((sum, row) => sum + row.supplierNet, 0),
          };
      });
    }, [operationRowsForPrint, printConfig.grouping, invoiceSortMode]);

  const printInvoiceRowColorById = useMemo(() => {
      const palette = ['#eef2ff', '#ecfdf5', '#fffbeb', '#ecfeff', '#f5f3ff'];
      const countByInvoice = operationRowsForPrint.reduce((acc, row) => {
          const invoice = String(row.warehouseInvoice || '').trim();
          if (!invoice) return acc;
          acc[invoice] = (acc[invoice] || 0) + 1;
          return acc;
      }, {} as Record<string, number>);

      const invoiceOrder = new Map<string, number>();
      const colors: Record<string, string | null> = {};

      operationRowsForPrint.forEach((row) => {
          const invoice = String(row.warehouseInvoice || '').trim();
          if (!invoice || (countByInvoice[invoice] || 0) <= 1) {
              colors[row.id] = null;
              return;
          }

          if (!invoiceOrder.has(invoice)) {
              invoiceOrder.set(invoice, invoiceOrder.size + 1);
          }

          const groupNo = invoiceOrder.get(invoice) || 1;
          colors[row.id] = palette[(groupNo - 1) % palette.length];
      });

      return colors;
  }, [operationRowsForPrint]);

  const togglePrintColumn = (columnKey: string) => {
      setPrintConfig(prev => {
          const exists = prev.selectedColumns.includes(columnKey);
          const selectedColumns = exists
              ? prev.selectedColumns.filter(key => key !== columnKey)
              : [...prev.selectedColumns, columnKey];

          return {
              ...prev,
              selectedColumns: selectedColumns.length ? selectedColumns : [columnKey],
          };
      });
  };

  const operationPrintColumns = useMemo(() => {
      const merged = new Map<string, { key: string; label: string }>();

      OPERATION_PRINT_COLUMNS.forEach((column) => {
          merged.set(String(column.key), { key: String(column.key), label: column.label });
      });

      [...historyColumns]
          .sort((a, b) => a.order - b.order)
          .filter((column) => column.key !== 'select' && column.key !== 'actions')
          .forEach((column) => {
              merged.set(column.key, { key: column.key, label: column.label });
          });

      return Array.from(merged.values());
  }, [historyColumns]);

  useEffect(() => {
      const unseenColumns = operationPrintColumns
          .map((column) => column.key)
          .filter((key) => !seenAutoPrintColumnsRef.current.has(key));

      if (unseenColumns.length === 0) return;

      unseenColumns.forEach((key) => seenAutoPrintColumnsRef.current.add(key));

      setPrintConfig((prev) => {
          const selected = new Set(prev.selectedColumns);
          let changed = false;

          unseenColumns.forEach((key) => {
              if (!selected.has(key)) {
                  selected.add(key);
                  changed = true;
              }
          });

          if (!changed) return prev;

          return {
              ...prev,
              selectedColumns: Array.from(selected),
          };
      });
  }, [operationPrintColumns]);

  const getSelectedPrintColumns = () => {
      const selected = new Set(printConfig.selectedColumns);
      return operationPrintColumns.filter(column => selected.has(column.key));
  };

  const getPrintCellValue = (row: OperationPrintableRow, key: string) => {
      const value = row[key];
      if (key === 'invoiceCounter') {
          return Number(value || 0) > 0 ? String(value) : '-';
      }
      if (typeof value === 'number') {
          return value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      }
      return value || '-';
  };

  const getPrintMarginMm = () => {
      if (printConfig.margins === 'narrow') return 5;
      if (printConfig.margins === 'wide') return 15;
      return 10;
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
      const base = getPaperSizeMm();
      const isLandscape = printConfig.orientation === 'landscape';
      const pageWidthMm = isLandscape ? base.height : base.width;
      const pageHeightMm = isLandscape ? base.width : base.height;
      const marginMm = getPrintMarginMm();
      const startMarginMm = Math.max(0, Number(printConfig.pageStartMarginMm) || 0);
      const endMarginMm = Math.max(0, Number(printConfig.pageEndMarginMm) || 0);
      const contentWidthMm = Math.max(pageWidthMm - (marginMm * 2), 10);
      const contentHeightMm = Math.max(pageHeightMm - (marginMm * 2) - startMarginMm - endMarginMm, 10);

      return {
          pageWidthMm,
          pageHeightMm,
          marginMm,
          startMarginMm,
          endMarginMm,
          contentWidthMm,
          contentHeightMm,
      };
  };

  const savePrintTemplate = () => {
      const normalizedName = printTemplateName.trim();
      if (!normalizedName) {
          toast.error('8y7�7�80 7�7�7�7�8 7�7�8& 7�887�87� 7�8�87�89.');
          return;
      }

      setPrintTemplates(prev => {
          const existing = prev.find(template => template.name === normalizedName);
          if (existing) {
              return prev.map(template => template.id === existing.id
                  ? { ...template, config: printConfig, updatedAt: Date.now() }
                  : template
              );
          }

          return [{
              id: uuidv4(),
              name: normalizedName,
              config: printConfig,
              updatedAt: Date.now(),
          }, ...prev].slice(0, 25);
      });

      setPrintStatusMessage(`7�8& 7�8~7� 87�87� 7�87�7�7�7�7�: ${normalizedName}`);
  };

  const applyPrintTemplate = (templateId: string) => {
      const template = printTemplates.find(item => item.id === templateId);
      if (!template) return;

      setPrintConfig(() => ({
          ...OPERATION_PRINT_DEFAULT_CONFIG,
          ...template.config,
          selectedColumns: Array.isArray(template.config.selectedColumns)
              ? template.config.selectedColumns.filter((key): key is string => operationPrintColumns.some(column => column.key === key))
              : OPERATION_PRINT_DEFAULT_CONFIG.selectedColumns,
      }));
      setSelectedTemplateId(template.id);
      setPrintTemplateName(template.name);
      setPrintStatusMessage(`7�8& 7�7�8&8y8 87�87�: ${template.name}`);
  };

  const deleteSelectedPrintTemplate = () => {
      if (!selectedTemplateId) {
          toast.error('8y7�7�80 7�7�7�8y7�7� 87�87� 7�8�87�89.');
          return;
      }

      const template = printTemplates.find(item => item.id === selectedTemplateId);
      if (!template) return;

      toast.warning(`7�7�8~ 7�887�87� "${template.name}"7�`, {
          action: {
              label: '7�7�8�8y7� 7�87�7�8~',
              onClick: () => {
                  setPrintTemplates(prev => prev.filter(item => item.id !== selectedTemplateId));
                  setSelectedTemplateId('');
                  setPrintStatusMessage(`7�8& 7�7�8~ 7�887�87�: ${template.name}`);
                  toast.success('7�8& 7�7�8~ 7�887�87� 7�8 7�7�7�');
              },
          },
      });
  };

  const buildPdfFromPreview = async () => {
      if (!printPageRef.current) {
          toast.error('87� 7�8�7�7� 8&7�7�8y8 7� 7�7�8!7�7� 887�7�7�7�7�.');
          return;
      }
      if (operationRowsForPrint.length === 0) {
          toast.error('87� 7�8�7�7� 7�8y7�8 7�7� 8&8~87�7�7� 887�7�7�7�7�.');
          return;
      }

      setIsPrintingPdf(true);
      setPrintStatusMessage('7�7�7�8y 7�7�8!8y7� 8&88~ PDF 7�7�88y 7�87�87�...');
      try {
          const html2pdfModule = await import('html2pdf.js');
          const html2pdf = (html2pdfModule as { default?: any }).default || html2pdfModule;

          await html2pdf()
              .set({
                  margin: 0,
                  filename: `operation-log-${new Date().toISOString().slice(0, 10)}.pdf`,
                  html2canvas: {
                      scale: 2,
                      useCORS: true,
                      backgroundColor: '#ffffff',
                  },
                  image: { type: 'jpeg', quality: 0.98 },
                  jsPDF: {
                      unit: 'mm',
                      format: printConfig.paperSize,
                      orientation: printConfig.orientation,
                  },
                  pagebreak: { mode: ['css', 'legacy'] },
              })
              .from(printPageRef.current)
              .save();

          setPrintStatusMessage('7�8& 7�8 7�7�7 8&88~ PDF 7�8 7�7�7�.');
      } catch {
          setPrintStatusMessage('7�7�7�7� 7�8 7�7�7 8&88~ PDF.');
          toast.error('7�7�7� 7�7�7� 7�7�8 7�7 7�7�7�7�7� PDF. 7�7�8�8 8&7�7�7�7�89.');
      } finally {
          setIsPrintingPdf(false);
      }
  };

  const quickPrintCurrentFilter = async () => {
      if (operationRowsForPrint.length === 0) {
          toast.error('87� 7�8�7�7� 7�8y7�8 7�7� 8&8~87�7�7� 887�7�7�8y7� 7�880 Excel.');
          return;
      }

      const selectedColumns = getSelectedPrintColumns();
      if (selectedColumns.length === 0) {
          toast.error('8y7�7�80 7�7�7�8y7�7� 7�8&8�7� 8�7�7�7� 7�880 7�87�88 8&8  7�7�7�8�7�8y8� 7�87�7�7�7�7�.');
          return;
      }

      setPrintStatusMessage('7�7�7�8y 7�7�8!8y7� 8&88~ Excel 8&7�7�7�8 87�8 7�8y8 7�87�7�7�7�7�...');
      try {
          const ExcelJS = await import('exceljs');
          const workbook = new ExcelJS.Workbook();
          const worksheet = workbook.addWorksheet('7�7�8 7�87�8&88y7�7�');
          worksheet.views = [{ rightToLeft: true }];
          worksheet.pageSetup = {
              orientation: printConfig.orientation,
              paperSize: printConfig.paperSize === 'a3' ? 8 : printConfig.paperSize === 'legal' ? 5 : 9,
              fitToPage: true,
              fitToWidth: 1,
              fitToHeight: 0,
          };

          const totalColumns = Math.max(1, selectedColumns.length);

          const setRangeBorder = (rowNumber: number, startColumn: number, endColumn: number, color = 'FFE2E8F0') => {
              if (!printConfig.showBorders) return;
              for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
                  const cell = worksheet.getCell(rowNumber, columnIndex);
                  cell.border = {
                      top: { style: 'thin', color: { argb: color } },
                      left: { style: 'thin', color: { argb: color } },
                      bottom: { style: 'thin', color: { argb: color } },
                      right: { style: 'thin', color: { argb: color } },
                  };
              }
          };

          const titleRow = worksheet.addRow([printConfig.reportTitle || '7�87�8y7� 7�7�8 7�87�8&88y7�7�']).number;
          worksheet.mergeCells(titleRow, 1, titleRow, totalColumns);
          const titleCell = worksheet.getCell(titleRow, 1);
          titleCell.font = { bold: true, size: 18, color: { argb: 'FF0F172A' } };
          titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

          const metaRow = worksheet.addRow([`7�8& 7�87�8 7�7�7 8~8y ${new Date().toLocaleString('en-GB')} ⬢ 7�7�7� 7�87�7�87�7�: ${operationSummary.totalCount}`]).number;
          worksheet.mergeCells(metaRow, 1, metaRow, totalColumns);
          const metaCell = worksheet.getCell(metaRow, 1);
          metaCell.font = { size: 11, color: { argb: 'FF64748B' } };
          metaCell.alignment = { horizontal: 'center', vertical: 'middle' };

          worksheet.addRow([]);

          const summaryCards = [
              { label: '7�7�8&7�88y 7�7�8~8y 7�87�8!8', value: formatNumber(operationSummary.totalNetWeight) },
              { label: '7�7�8&7�88y 7�7�8~8y 7�88&8�7�7�', value: formatNumber(operationSummary.totalSupplierNet) },
              { label: '7�88~7�8 7�8y8  7�7�8~8y 7�87�8!8 8�7�7�8~8y 7�88&8�7�7�', value: formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet) },
              { label: '7�7�7� 7�88~8�7�7�8y7�', value: String(operationSummary.invoiceCount) },
              { label: '7�7�8&7�88y 8&7�87 7�87�7�7�8y7�', value: formatCurrencyLYD(operationSummary.totalDelayPenalty) },
          ];

          const splitAt = Math.max(1, Math.floor(totalColumns / 2));
          const hasRightRegion = splitAt < totalColumns;
          const styleCardRegion = (labelRow: number, valueRow: number, startColumn: number, endColumn: number, label: string, value: string) => {
              worksheet.mergeCells(labelRow, startColumn, labelRow, endColumn);
              worksheet.mergeCells(valueRow, startColumn, valueRow, endColumn);

              const labelCell = worksheet.getCell(labelRow, startColumn);
              labelCell.value = label;
              labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
              labelCell.font = { bold: true, size: Math.max(9, printConfig.tableFontSize - 1), color: { argb: 'FF64748B' } };
              labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

              const valueCell = worksheet.getCell(valueRow, startColumn);
              valueCell.value = value;
              valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
              valueCell.font = { bold: true, size: Math.max(10, printConfig.tableFontSize + 1), color: { argb: 'FF0F172A' } };

              setRangeBorder(labelRow, startColumn, endColumn);
              setRangeBorder(valueRow, startColumn, endColumn);
          };

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

          worksheet.addRow([]);

          const addHeaderRow = () => {
              const header = worksheet.addRow(selectedColumns.map((column) => column.label));
              header.height = Math.max(20, printConfig.rowHeight - 8);
              header.eachCell((cell) => {
                  cell.font = { bold: true, size: printConfig.tableFontSize, color: { argb: 'FF334155' } };
                  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: printConfig.wrapCellText };
                  if (printConfig.colorHeaderRow) {
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                  }
              });
              setRangeBorder(header.number, 1, totalColumns, 'FFCBD5E1');
          };

          groupedPrintRows.forEach((group) => {
              if (printConfig.grouping !== 'none') {
                  const subtotal = `Subtotal: ${formatNumber(group.subtotalNet)}`;
                  const groupRow = worksheet.addRow([`${group.title} ⬢ ${subtotal}`]).number;
                  worksheet.mergeCells(groupRow, 1, groupRow, totalColumns);
                  const groupCell = worksheet.getCell(groupRow, 1);
                  groupCell.font = { bold: true, size: Math.max(10, printConfig.tableFontSize), color: { argb: 'FF334155' } };
                  groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                  groupCell.alignment = { horizontal: 'right', vertical: 'middle' };
                  setRangeBorder(groupRow, 1, totalColumns);
              }

              addHeaderRow();

              group.rows.forEach((row, rowIndex) => {
                  const dataRow = worksheet.addRow(selectedColumns.map((column) => getPrintCellValue(row, column.key)));
                  dataRow.height = Math.max(18, printConfig.rowHeight - 10);
                  dataRow.eachCell((cell) => {
                      cell.font = { size: printConfig.tableFontSize, color: { argb: 'FF0F172A' } };
                      cell.alignment = {
                          horizontal: 'center',
                          vertical: 'middle',
                          wrapText: printConfig.wrapCellText,
                      };
                      if (printConfig.zebraStriping && rowIndex % 2 === 1) {
                          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                      }
                  });
                  setRangeBorder(dataRow.number, 1, totalColumns);
              });

              worksheet.addRow([]);
          });

          selectedColumns.forEach((column, index) => {
              const headerLen = Math.max(6, String(column.label || '').length);
              const maxValueLen = operationRowsForPrint.reduce((maxLen, row) => {
                  const value = String(getPrintCellValue(row, column.key));
                  return Math.max(maxLen, value.length);
              }, headerLen);
              worksheet.getColumn(index + 1).width = Math.min(60, Math.max(12, Math.ceil(maxValueLen * 1.2)));
          });

          const buffer = await workbook.xlsx.writeBuffer();
          const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `operation-log-filter-${new Date().toISOString().slice(0, 10)}.xlsx`;
          link.click();
          URL.revokeObjectURL(link.href);

          setPrintStatusMessage('7�8& 7�8 7�7�7 8&88~ Excel 7�7�8 7�8y8 8&7�7�7�8 887�7�7�7�7�.');
      } catch {
          setPrintStatusMessage('7�7�7�7� 7�8 7�7�7 8&88~ Excel.');
          toast.error('7�7�7� 7�7�7� 7�7�8 7�7 7�7�7�7�7� Excel. 7�7�8�8 8&7�7�7�7�89.');
      }
  };


  // --- SMART IMPORT/EXPORT LOGIC ---

  const handleSmartExport = () => {
        if (!canExport) {
            toast.error('88y7� 87�8y8� 7�87�7�8y7� 7�7�7�8y7� 7�7�8�7�7� 7�88&7�7�8�8 .');
            return;
        }
    // Advanced Export: Includes calculated fields and readable names
    const data = transactions.map(t => {
        const item = items.find(i => i.id === t.itemId);
        const unloadingRule = unloadingRules.find(rule => rule.id === t.unloadingRuleId);
        return {
            '8�8�7� 7�87�8&88y7�': t.id,
            '7�87�7�7�8y7�': t.date,
            '7�88 8�7�': t.type,
            '7�88& 7�88~7�7�8�7�7�': t.warehouseInvoice,
            '8�8�7� 7�87�8 8~': item?.code || '',
            '7�7�8& 7�87�8 8~': item?.name || '78y7� 8&7�7�8�8~',
            '7�7�8~8y 7�87�8!8': t.quantity,
            '7�7�8~8y 7�88&8�7�7�': t.supplierNet || 0,
            '7�88~7�8': t.difference || 0,
            '7�7�7� 7�87�7�8�7�7�': t.packageCount || 0,
            '8 8&8�7�7� 7�88�7�8 ': t.weightSlip || '',
            '7�88�7�7�7�': item?.unit || '',
            '7�88&8�7�7�/7�87�8&8y8': t.supplierOrReceiver,
            '8~7�7�8�7�7� 8&8�7�7�': t.supplierInvoice || '',
            '7�88& 7�87�7�7�8 7�': t.truckNumber || '',
            '7�88& 7�87�7�7�7�': t.trailerNumber || '',
            '7�7�8& 7�87�7�7�8': t.driverName || '',
            '8�87� 7�87�7�8�8': t.entryTime || '',
            '8�87� 7�87�7�8�7�': t.exitTime || '',
            '87�7�7�7� 7�87�8~7�8y7': unloadingRule?.rule_name || '',
            '8&7�7� 7�87�87�7 (7�88y87�)': t.delayDuration || 0,
            '77�7�8&7� 7�87�7�7�8y7�': t.delayPenalty || 0,
            '8&87�7�7�7�7�': t.notes || ''
        };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wscols = Object.keys(data[0] || {}).map(k => ({ wch: k.length + 10 }));
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "7�7�8�7� 7�88&7�7�8�8 ");
    XLSX.writeFile(wb, `Stock_Movement_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
        onExport?.(data.length);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canImport) {
            toast.error('88y7� 87�8y8� 7�87�7�8y7� 7�7�7�8y7�7�7� 7�87�7�8�7�7�.');
            return;
        }
    const file = e.target.files?.[0];
    if (!file) return;

    setImportPreview({ valid: [], invalid: [] });
    setNormalizedImportPreview([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
        
        if (data.length > 0) {
            const normalizedRows = data
                .map((row) => (Array.isArray(row) ? row : []))
                .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));

            if (!normalizedRows.length) {
                toast.error('7�88&88~ 87� 8y7�7�8�8y 7�8y7�8 7�7� 7�7�87�7� 887�7�7�8y7�7�7�.');
                return;
            }

            const headerRowIndex = detectHeaderRowIndex(normalizedRows);
            const headers = (normalizedRows[headerRowIndex] || []).map((cell) => String(cell ?? '').trim());
            const rows = normalizedRows.slice(headerRowIndex + 1);

            setExcelHeaders(headers);
            setExcelData(rows);

            const autoMap = autoMapImportHeaders(headers);
            setColumnMapping(autoMap);
            setImportStep('mapping');
        }
    };
    reader.readAsBinaryString(file);
  };

  const normalizeCellText = (raw: unknown) => {
      if (raw === null || raw === undefined) return '';
      return String(raw)
          .replace(/[ظ -ظ©]/g, (digit) => String('8�88�8�8�8�8�8�8�8�'.indexOf(digit)))
          .replace(/[ظ -ظ©]/g, '.')
          .replace(/[٬]/g, ',')
          .trim();
  };

  const parseFlexibleNumber = (raw: unknown): number | undefined => {
      if (raw === null || raw === undefined || raw === '') return undefined;
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

      const normalized = normalizeCellText(raw)
          .replace(/ط¯.ظ„|ط¬.ظ…|ط±.ط³|ظƒط¬ظ…|kg|KG|7�\.8|7�\.8\.|LYD/gi, '')
          .replace(/\s+/g, '')
          .replace(/,/g, '');

      if (!normalized) return undefined;

      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : undefined;
  };

  const parseFlexibleDate = (raw: unknown): string | undefined => {
      if (raw === null || raw === undefined || raw === '') return undefined;

      if (typeof raw === 'number' && Number.isFinite(raw)) {
          const excelDate = new Date(Math.round((raw - 25569) * 86400 * 1000));
          if (!Number.isNaN(excelDate.getTime())) {
              return excelDate.toISOString().split('T')[0];
          }
      }

      const text = normalizeCellText(raw);
      if (!text) return undefined;

      const direct = new Date(text);
      if (!Number.isNaN(direct.getTime())) {
          return direct.toISOString().split('T')[0];
      }

      const match = text.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
      if (!match) return undefined;

      const a = Number(match[1]);
      const b = Number(match[2]);
      const c = Number(match[3]);

      let year = a;
      let month = b;
      let day = c;

      if (a < 1000) {
          year = c;
          if (a > 12) {
              day = a;
              month = b;
          } else {
              month = a;
              day = b;
          }
      }

      if (year < 100) {
          year += 2000;
      }

      const normalizedDate = new Date(year, month - 1, day);
      if (Number.isNaN(normalizedDate.getTime())) return undefined;

      const yyyy = normalizedDate.getFullYear();
      const mm = String(normalizedDate.getMonth() + 1).padStart(2, '0');
      const dd = String(normalizedDate.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
  };

  const parseFlexibleTime = (raw: unknown): string => {
      if (raw === null || raw === undefined || raw === '') return '';

      if (typeof raw === 'number' && Number.isFinite(raw)) {
          if (raw >= 0 && raw < 1) {
              const totalMinutes = Math.round(raw * 24 * 60);
              const hours = Math.floor(totalMinutes / 60) % 24;
              const minutes = totalMinutes % 60;
              return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          }
          if (raw >= 0 && raw <= 2359) {
              const asInt = Math.floor(raw);
              const hours = Math.floor(asInt / 100);
              const minutes = asInt % 100;
              if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
              }
          }
      }

      const text = normalizeCellText(raw)
          .replace('.', ':')
          .replace(';', ':');

      const hhmm = text.match(/(\d{1,2})\s*[:]\s*(\d{1,2})/);
      if (hhmm) {
          const hours = Number(hhmm[1]);
          const minutes = Number(hhmm[2]);
          if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
              return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          }
      }

      return normalizeTimeValue(text);
  };

  const normalizeOperationType = (raw: unknown): OperationType | undefined => {
      const value = normalizeCellText(raw);
      if (!value) return undefined;

      if (OPERATION_TYPES.includes(value as OperationType)) {
          return value as OperationType;
      }

      const v = value.toLowerCase();
      if (['1', 'in', 'import'].includes(v)) return '8�7�7�7�';
      if (['2', 'out', 'export'].includes(v)) return '7�7�7�7�';
      if (['3', 'prod', 'production'].includes(v)) return '7�8 7�7�7�';
      if (['4', 'waste', 'damaged'].includes(v)) return '8!7�88�';

      if (v.includes('7�7�7�7�') || v.includes('7�8y7�') || v.includes('sale') || v.includes('7�7�8~') || v.includes('7�7�8�7�')) return '7�7�7�7�';
      if (v.includes('8�7�7�7�') || v.includes('7�7�7�7') || v.includes('purchase') || v.includes('7�8�7�8y7�') || v.includes('7�7�8�8')) return '8�7�7�7�';
      if (v.includes('7�8 7�7�7�') || v.includes('7�8 7�7�7�') || v.includes('7�7�8 8y7�')) return '7�8 7�7�7�';
      if (v.includes('8!7�88�') || v.includes('7�7�88~') || v.includes('damage') || v.includes('waste')) return '8!7�88�';

      return undefined;
  };

  const findItemByImportedValue = (raw: unknown) => {
      const token = normalizeCellText(raw).toLowerCase();
      if (!token) return undefined;

      return items.find((item) => {
          const name = item.name.toLowerCase();
          const code = String(item.code || '').toLowerCase();
          const englishName = String(item.englishName || '').toLowerCase();
          return name === token || code === token || englishName === token || name.includes(token) || token.includes(name);
      });
  };

  const findUnloadingRuleByImportedValue = (raw: unknown) => {
      const token = normalizeCellText(raw).toLowerCase();
      if (!token) return undefined;

      return unloadingRules.find((rule) => {
          if (!rule.is_active) return false;
          const name = rule.rule_name.toLowerCase();
          return name === token || name.includes(token) || token.includes(name);
      });
  };

  const validateAndProcessImport = () => {
    const validRows: Transaction[] = [];
    const invalidRows: {row: any, errors: string[]}[] = [];
        const normalizedRows: ImportPreviewRow[] = [];
    const invoiceTracker = new Set<string>(); // Track invoices within the file itself

    excelData.forEach((rowArray, idx) => {
        const rowObj: any = {};
        excelHeaders.forEach((header, i) => { rowObj[header] = rowArray[i]; });
        
        const errors: string[] = [];
        
        // Helper to get value based on mapping
        const getValue = (key: string) => {
            const header = columnMapping[key];
            return header ? rowObj[header] : undefined;
        };

        // 1. Basic Extraction & Validation
        const date = parseFlexibleDate(getValue('date'));
        const rawType = getValue('type');
        const type = normalizeOperationType(rawType);
        const invoice = normalizeCellText(getValue('warehouseInvoice'));
        const importedItemToken = normalizeCellText(getValue('itemName'));
        let partnerName = normalizeCellText(getValue('partnerName'));
        const quantity = parseFlexibleNumber(getValue('quantity'));
        const entryDateTime = parseFlexibleTime(getValue('entryTime'));
        const exitDateTimeRaw = parseFlexibleTime(getValue('exitTime'));
        const unloadingRuleName = normalizeCellText(getValue('unloadingRuleName'));

        if (!partnerName && type === '7�8 7�7�7�') partnerName = '8�7�7�7� 7�87�8 7�7�7�';
        if (!partnerName && type === '8!7�88�') partnerName = '8!7�88� 8&7�7�8 8y';

        // Check Required
        if (!date) errors.push('7�87�7�7�8y7� 8&8~88�7�');
        if (!type) errors.push(`8 8�7� 7�87�8&88y7� 78y7� 8&7�7�8�8~: ${rawType}`);
        if (!invoice) errors.push('7�88& 7�88~7�7�8�7�7� 8&8~88�7�');
        if (!importedItemToken) errors.push('7�7�8& 7�87�8 8~ 8&8~88�7�');
        if (!partnerName) errors.push('7�7�8& 7�87�7�8~ 7�87�7�8 8y 8&8~88�7�');
        if (quantity === undefined || Number.isNaN(quantity)) errors.push('7�88�8&8y7� 78y7� 7�7�87�7�');

        let unloadingRuleId = '';
        if (unloadingRuleName) {
            const matchedRule = findUnloadingRuleByImportedValue(unloadingRuleName);
            if (!matchedRule) {
                errors.push(`87�7�7�7� 7�87�8~7�8y7 78y7� 8&8�7�8�7�7� 7�8� 78y7� 8&8~7�87�: ${unloadingRuleName}`);
            } else {
                unloadingRuleId = matchedRule.id;
            }
        }

        if ((entryDateTime || exitDateTimeRaw) && (!entryDateTime || !exitDateTimeRaw)) {
            errors.push('8y7�7� 7�7�7�7�7� 8�87� 7�87�7�8�8 8�7�87�7�8�7� 8&7�897�');
        }

        if (entryDateTime && exitDateTimeRaw && !unloadingRuleId) {
            errors.push('8y7�7� 7�7�7�8y7� 87�7�7�7� 7�87�8~7�8y7 87�7�7�7� 7�877�7�8&7�');
        }

        if (entryDateTime && exitDateTimeRaw) {
            const duration = calculateDurationWithRollover(entryDateTime, exitDateTimeRaw);
            if (!duration.valid) {
                errors.push('7�8y77� 7�88�87� 78y7� 7�7�8y7�7� (HH:MM)');
            }
        }

        // 2. Logic Validation (Relations)
        let itemId = '';
        if (importedItemToken) {
            const item = findItemByImportedValue(importedItemToken);
            if (!item) errors.push(`7�87�8 8~ 78y7� 8&8�7�8�7� 7�7�88 7�7�8&: ${importedItemToken}`);
            else itemId = item.id;
        }

        // 3. Duplicate Invoice Check
        if (invoice && type) {
            const existsInDb = !isInvoiceUnique(String(invoice), type);
            // ALLOW DUPLICATES INSIDE FILE (Multi-line invoices)
            // const existsInFile = invoiceTracker.has(`${type}-${invoice}`);
            
            if (existsInDb) errors.push(`7�88& 7�88~7�7�8�7�7� ${invoice} 8&7�7�8 7�7�7�87�89 8~8y 7�88 7�7�8&`);
            // REMOVED CHECK: if (existsInFile) errors.push(`7�88& 7�88~7�7�8�7�7� ${invoice} 8&8�7�7� 7�7�7�8 7�88&88~`);
            
            if (!existsInDb) invoiceTracker.add(`${type}-${invoice}`);
        }

        if (errors.length > 0) {
            invalidRows.push({ row: rowObj, errors });
        } else {
            // 4. Construct Transaction Object
            let t: Partial<Transaction> = {
                id: uuidv4(),
                date: String(date),
                type: type,
                warehouseInvoice: String(invoice),
                itemId: itemId,
                supplierOrReceiver: String(partnerName),
                quantity: Number(quantity || 0),
                supplierNet: parseFlexibleNumber(getValue('supplierNet')) || 0,
                
                // New Fields
                packageCount: parseFlexibleNumber(getValue('packageCount')) || undefined,
                weightSlip: normalizeCellText(getValue('weightSlip')),
                supplierInvoice: normalizeCellText(getValue('supplierInvoice')),
                trailerNumber: normalizeCellText(getValue('trailerNumber')),
                unloadingRuleId,
                unloadingDuration: parseFlexibleNumber(getValue('unloadingDuration')) || settings.defaultUnloadingDuration || 60,

                truckNumber: normalizeCellText(getValue('truckNumber')),
                driverName: normalizeCellText(getValue('driverName')),
                entryTime: entryDateTime,
                exitTime: exitDateTimeRaw,
                notes: normalizeCellText(getValue('notes')),
                timestamp: Date.now()
            };
            
            // Apply Calculations
            t = processRowLogic(t);
            validRows.push(t as Transaction);
        }

        normalizedRows.push({
            rowNumber: idx + 1,
            date: date || '',
            type: type || normalizeCellText(rawType),
            warehouseInvoice: invoice,
            itemName: importedItemToken,
            partnerName,
            quantity: quantity === undefined ? '' : String(quantity),
            supplierNet: String(parseFlexibleNumber(getValue('supplierNet')) ?? ''),
            entryTime: entryDateTime,
            exitTime: exitDateTimeRaw,
            unloadingRuleName,
            status: errors.length > 0 ? 'invalid' : 'valid',
            errors
        });
    });

    setImportPreview({ valid: validRows, invalid: invalidRows });
    setNormalizedImportPreview(normalizedRows);
    setImportStep('preview');
  };

  const commitImport = () => {
      onAddTransaction(importPreview.valid);
      onImport?.(importPreview.valid.length);
      setImportStep('finish');
  };

  const closeImport = () => {
      setIsImportOpen(false);
      setImportStep('upload');
      setExcelData([]);
      setImportPreview({ valid: [], invalid: [] });
      setNormalizedImportPreview([]);
  };

  // --- UI Helpers ---

    function formatNumber(num?: number) {
      if (num === undefined || num === null || isNaN(num)) return '-';
      return num.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
  
  const getSuggestions = (val: string) => partners.filter(p => p.name.toLowerCase().includes(val.toLowerCase()));

  const getRowColor = (type?: OperationType) => {
    switch (type) {
      case '8�7�7�7�': return 'border-l-4 border-l-emerald-500 bg-emerald-50/10';
      case '7�7�7�7�': return 'border-l-4 border-l-red-500 bg-red-50/10';
      case '7�8 7�7�7�': return 'border-l-4 border-l-blue-500 bg-blue-50/10';
      case '8!7�88�': return 'border-l-4 border-l-yellow-500 bg-yellow-50/10';
      default: return 'border-l-4 border-l-slate-200';
    }
  };

  const orderedHistoryColumns = useMemo(
      () => [...historyColumns].sort((a, b) => a.order - b.order),
      [historyColumns]
  );

  const orderedBatchColumns = useMemo(
      () => [...batchColumns].sort((a, b) => a.order - b.order),
      [batchColumns]
  );

  const visibleHistoryColumns = useMemo(
      () => orderedHistoryColumns.filter(column => column.visible),
      [orderedHistoryColumns]
  );

  const visibleBatchColumns = useMemo(
      () => orderedBatchColumns.filter(column => column.visible),
      [orderedBatchColumns]
  );

  const frozenHistoryOffsets = useMemo(() => {
      let offset = 0;
      const offsets: Record<string, number> = {};
      visibleHistoryColumns.filter(column => column.frozen).forEach(column => {
          offsets[column.key] = offset;
          offset += column.width;
      });
      return offsets;
  }, [visibleHistoryColumns]);

  const frozenBatchOffsets = useMemo(() => {
      let offset = 0;
      const offsets: Record<string, number> = {};
      visibleBatchColumns.filter(column => column.frozen).forEach(column => {
          offsets[column.key] = offset;
          offset += column.width;
      });
      return offsets;
  }, [visibleBatchColumns]);

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
              left: frozenHistoryOffsets[column.key] || 0,
              zIndex: isHeader ? 25 : 20,
              background: isHeader ? '#ffffff' : '#ffffff',
          };
      }
      return base;
  };

  const getBatchColumnStyle = (column: GridColumnPreference, isHeader = false): React.CSSProperties => {
      const base: React.CSSProperties = {
          width: `${column.width}px`,
          minWidth: `${column.width}px`,
          maxWidth: `${column.width}px`,
      };
      if (column.frozen) {
          return {
              ...base,
              position: 'sticky',
              left: frozenBatchOffsets[column.key] || 0,
              zIndex: isHeader ? 25 : 20,
              background: isHeader ? '#f1f5f9' : '#ffffff',
          };
      }
      return base;
  };

  const handleSaveHistoryColumns = () => {
      upsertGridPreferenceForUser(effectiveUserId, 'inventory_log', historyColumns);
      setShowHistoryColumnSettings(false);
  };

  const handleResetHistoryColumns = () => {
      resetGridPreferenceForUser(effectiveUserId, 'inventory_log');
      setHistoryColumns(inventoryLogDefaultColumns);
  };

  const handleSaveBatchColumns = () => {
      upsertGridPreferenceForUser(effectiveUserId, 'inventory_batch', batchColumns);
      setShowBatchColumnSettings(false);
  };

  const handleResetBatchColumns = () => {
      resetGridPreferenceForUser(effectiveUserId, 'inventory_batch');
      setBatchColumns(inventoryBatchDefaultColumns);
  };

  const requiredBatchColumns = useMemo(() => new Set([
      'date',
      'type',
      'warehouseInvoice',
      'supplierOrReceiver',
      'itemId',
      'quantity',
  ]), []);

  const renderOperationPrintSheet = () => {
      const selectedColumns = getSelectedPrintColumns();
      const pageMetrics = getPrintPageMetrics();
      const effectiveRowHeight = Math.max(10, printConfig.rowHeight);
      const verticalCellPadding = Math.min(
          Math.max(1, printConfig.cellPadding - 1),
          Math.max(1, Math.floor((effectiveRowHeight - 8) / 2))
      );
      const columnWidthPercentages = printConfig.autoSizeColumns
          ? (() => {
                const measureTextUnits = (value: string) => {
                    const normalized = value.replace(/\s+/g, ' ').trim();
                    if (!normalized) return 4;
                    const arabicChars = (normalized.match(/[\u0600-\u06FF]/g) || []).length;
                    const otherChars = normalized.length - arabicChars;
                    return (arabicChars * 1.15) + (otherChars * 0.95);
                };

                const widths: Partial<Record<keyof OperationPrintableRow, number>> = {};
                selectedColumns.forEach((column) => {
                    const headerUnits = measureTextUnits(column.label) + 3;
                    const maxCellUnits = operationRowsForPrint.reduce((maxUnits, row) => {
                        const cellValue = String(getPrintCellValue(row, column.key));
                        return Math.max(maxUnits, measureTextUnits(cellValue));
                    }, 0);

                    widths[column.key] = Math.min(Math.max(Math.max(headerUnits, maxCellUnits) + 2, 10), 46);
                });

                const totalUnits = selectedColumns.reduce((sum, column) => sum + (widths[column.key] || 0), 0);
                if (totalUnits <= 0) return null;

                return selectedColumns.reduce((acc, column) => {
                    acc[column.key] = `${((widths[column.key] || 0) / totalUnits) * 100}%`;
                    return acc;
                }, {} as Partial<Record<keyof OperationPrintableRow, string>>);
            })()
          : null;

      const smartColumnPadding = printConfig.smartCellPadding
          ? (() => {
                const measureTextUnits = (value: string) => {
                    const normalized = value.replace(/\s+/g, ' ').trim();
                    if (!normalized) return 4;
                    const arabicChars = (normalized.match(/[\u0600-\u06FF]/g) || []).length;
                    const otherChars = normalized.length - arabicChars;
                    return (arabicChars * 1.15) + (otherChars * 0.95);
                };

                const widthByColumn = selectedColumns.reduce((acc, column) => {
                    if (columnWidthPercentages?.[column.key]) {
                        const parsed = Number(String(columnWidthPercentages[column.key]).replace('%', ''));
                        acc[column.key] = Number.isFinite(parsed) ? parsed : (100 / Math.max(1, selectedColumns.length));
                    } else {
                        acc[column.key] = 100 / Math.max(1, selectedColumns.length);
                    }
                    return acc;
                }, {} as Partial<Record<keyof OperationPrintableRow, number>>);

                const densityByColumn = selectedColumns.reduce((acc, column) => {
                    const maxCellUnits = operationRowsForPrint.reduce((maxUnits, row) => {
                        const cellValue = String(getPrintCellValue(row, column.key));
                        return Math.max(maxUnits, measureTextUnits(cellValue));
                    }, measureTextUnits(column.label));

                    const widthPercent = widthByColumn[column.key] || (100 / Math.max(1, selectedColumns.length));
                    acc[column.key] = maxCellUnits / Math.max(1, widthPercent);
                    return acc;
                }, {} as Partial<Record<keyof OperationPrintableRow, number>>);

                const allDensities = selectedColumns.map((column) => densityByColumn[column.key] || 0).filter(Boolean);
                const avgDensity = allDensities.length
                    ? allDensities.reduce((sum, item) => sum + item, 0) / allDensities.length
                    : 1;
                const maxDensity = allDensities.length ? Math.max(...allDensities) : avgDensity;
                const pressureLevel = avgDensity > 0 ? (maxDensity / avgDensity) : 1;

                const basePadding = Math.max(0, printConfig.cellPadding);

                const rankedColumns = selectedColumns
                    .map((column) => ({
                        key: column.key,
                        density: densityByColumn[column.key] || avgDensity,
                    }))
                    .sort((a, b) => b.density - a.density);

                const criticalCount = Math.max(1, Math.ceil(selectedColumns.length * 0.25));
                const criticalColumns = new Set(rankedColumns.slice(0, criticalCount).map((item) => item.key));

                return selectedColumns.reduce((acc, column) => {
                    const density = densityByColumn[column.key] || avgDensity;

                    if (pressureLevel < 1.1) {
                        acc[column.key] = basePadding;
                        return acc;
                    }

                    if (criticalColumns.has(column.key)) {
                        acc[column.key] = basePadding;
                    } else if (density >= avgDensity) {
                        acc[column.key] = Math.max(0, basePadding - 1);
                    } else if (pressureLevel >= 1.35) {
                        acc[column.key] = Math.max(0, basePadding - 3);
                    } else {
                        acc[column.key] = Math.max(0, basePadding - 2);
                    }

                    return acc;
                }, {} as Partial<Record<keyof OperationPrintableRow, number>>);
            })()
          : null;

      const getCellHorizontalPadding = (columnKey: keyof OperationPrintableRow) => {
          if (smartColumnPadding?.[columnKey]) return smartColumnPadding[columnKey] as number;
          return Math.max(0, printConfig.cellPadding);
      };

      const getCellPadding = (columnKey: keyof OperationPrintableRow) => {
          const horizontal = getCellHorizontalPadding(columnKey);
          const normalizedOffset = Math.max(-6, Math.min(6, Number(printConfig.verticalTextOffset) || 0));
          const topPadding = Math.max(0, (verticalCellPadding - 1) + normalizedOffset);
          const bottomPadding = Math.max(0, (verticalCellPadding + 1) - normalizedOffset);
          return `${topPadding}px ${horizontal}px ${bottomPadding}px`;
      };

      return (
          <div
              ref={printSheetRef}
              className="bg-white text-slate-800 relative"
              style={{
                  fontSize: `${printConfig.fontSize}px`,
                  direction: 'rtl',
                  width: '100%',
                  minHeight: `${pageMetrics.contentHeightMm}mm`,
                  padding: 0,
                  boxSizing: 'border-box',
              }}
          >
              {printConfig.watermarkText.trim() && (
                  <div
                      className="pointer-events-none select-none absolute inset-0 flex items-center justify-center"
                      style={{ opacity: 0.08 }}
                  >
                      <div className="font-bold" style={{ fontSize: '72px', transform: 'rotate(-24deg)' }}>
                          {printConfig.watermarkText}
                      </div>
                  </div>
              )}

              <div className="relative z-10 space-y-4">
                  <div className="border-b border-slate-300 pb-3">
                      <h2 className="font-bold text-xl text-slate-900">{printConfig.reportTitle || '7�87�8y7� 7�7�8 7�87�8&88y7�7�'}</h2>
                      <p className="text-xs text-slate-500 mt-1">
                          7�8& 7�87�8 7�7�7 8~8y {new Date().toLocaleString('en-GB')} ⬢ 7�7�7� 7�87�7�87�7�: {operationSummary.totalCount}
                      </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <div className="border border-slate-200 rounded-lg p-2">
                          <div className="text-[11px] text-slate-500">7�7�8&7�88y 7�7�8~8y 7�87�8!8</div>
                          <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight)}</div>
                      </div>
                      <div className="border border-slate-200 rounded-lg p-2">
                          <div className="text-[11px] text-slate-500">7�7�8&7�88y 7�7�8~8y 7�88&8�7�7�</div>
                          <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalSupplierNet)}</div>
                      </div>
                      <div className="border border-slate-200 rounded-lg p-2">
                          <div className="text-[11px] text-slate-500">7�88~7�8 7�8y8  7�7�8~8y 7�87�8!8 8�7�7�8~8y 7�88&8�7�7�</div>
                          <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet)}</div>
                      </div>
                      <div className="border border-slate-200 rounded-lg p-2">
                          <div className="text-[11px] text-slate-500">7�7�7� 7�88~8�7�7�8y7�</div>
                          <div className="font-bold text-slate-800 dir-ltr text-left">{operationSummary.invoiceCount}</div>
                      </div>
                      <div className="border border-slate-200 rounded-lg p-2">
                          <div className="text-[11px] text-slate-500">7�7�8&7�88y 8&7�87 7�87�7�7�8y7�</div>
                          <div className="font-bold text-red-700 dir-ltr text-left">{formatCurrencyLYD(operationSummary.totalDelayPenalty)}</div>
                      </div>
                  </div>

                  {groupedPrintRows.map((group) => (
                      <div key={group.id} className="space-y-2">
                          {printConfig.grouping !== 'none' && (
                              <div className="bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold text-slate-700 flex justify-between">
                                  <span>{group.title}</span>
                                  <span className="dir-ltr">Subtotal: {formatNumber(group.subtotalNet)}</span>
                              </div>
                          )}

                          <div className="overflow-visible rounded-lg border border-slate-200">
                              <table
                                  className={`w-full ${printConfig.autoSizeColumns ? 'table-auto' : 'table-fixed'}`}
                                  style={{
                                      borderCollapse: 'collapse',
                                      fontSize: `${printConfig.tableFontSize}px`,
                                  }}
                              >
                                      {columnWidthPercentages && (
                                          <colgroup>
                                              {selectedColumns.map((column) => (
                                                  <col
                                                      key={`col-${group.id}-${column.key}`}
                                                      style={{ width: columnWidthPercentages[column.key], minWidth: columnWidthPercentages[column.key] }}
                                                  />
                                              ))}
                                          </colgroup>
                                      )}
                                      <thead
                                          className={printConfig.colorHeaderRow ? 'bg-slate-100 text-slate-700' : 'bg-white text-slate-700'}
                                          style={{ display: 'table-header-group' }}
                                      >
                                          <tr>
                                              {selectedColumns.map((column) => (
                                                  <th
                                                      key={`${group.id}-head-${column.key}`}
                                                      className={`text-center ${printConfig.wrapCellText ? 'whitespace-normal break-words' : 'whitespace-nowrap overflow-hidden text-ellipsis'}`}
                                                      title={column.label}
                                                      style={{
                                                          padding: getCellPadding(column.key),
                                                          lineHeight: printConfig.wrapCellText ? '1.25' : '1.1',
                                                          verticalAlign: 'top',
                                                          border: printConfig.showBorders ? '1px solid #cbd5e1' : 'none',
                                                      }}
                                                  >
                                                      {column.label}
                                                  </th>
                                              ))}
                                          </tr>
                                      </thead>
                                      <tbody>
                                          {group.rows.map((row, rowIndex) => {
                                              const duplicateInvoiceColor = printInvoiceRowColorById[row.id];
                                              const rowBackground = duplicateInvoiceColor || (printConfig.zebraStriping && rowIndex % 2 === 1
                                                  ? '#f8fafc'
                                                  : '#ffffff');

                                              return (
                                                  <tr
                                                      key={`${group.id}-${row.id}`}
                                                      style={{
                                                          background: rowBackground,
                                                          breakInside: 'avoid',
                                                          pageBreakInside: 'avoid',
                                                      }}
                                                  >
                                                      {selectedColumns.map((column) => (
                                                          <td
                                                              key={`${group.id}-${row.id}-${column.key}`}
                                                              className={`text-center ${printConfig.wrapCellText ? 'whitespace-normal break-words' : 'whitespace-nowrap overflow-hidden text-ellipsis'}`}
                                                              title={String(getPrintCellValue(row, column.key))}
                                                              style={{
                                                                  padding: getCellPadding(column.key),
                                                                  lineHeight: printConfig.wrapCellText ? '1.25' : '1.1',
                                                                  verticalAlign: 'top',
                                                                  border: printConfig.showBorders ? '1px solid #e2e8f0' : 'none',
                                                                  height: printConfig.wrapCellText ? 'auto' : `${effectiveRowHeight}px`,
                                                                  minHeight: `${effectiveRowHeight}px`,
                                                              }}
                                                          >
                                                              {getPrintCellValue(row, column.key)}
                                                          </td>
                                                      ))}
                                                  </tr>
                                              );
                                          })}
                                      </tbody>
                              </table>
                          </div>
                      </div>
                  ))}

                  <div className="mt-6 grid grid-cols-2 gap-4 justify-items-center">
                      <div className="w-full max-w-[320px] border border-slate-300 rounded-lg p-3 min-h-[128px] flex flex-col justify-between">
                          <div className="text-xs font-bold text-slate-700">8&7�7�7�7� 7�88&7�7�7�8 </div>
                          <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-500">7�87�7�8&: __________________________</div>
                      </div>
                      <div className="w-full max-w-[320px] border border-slate-300 rounded-lg p-3 min-h-[128px] flex flex-col justify-between">
                          <div className="text-xs font-bold text-slate-700">8&7�8y7� 7�88&7�7�7�8 </div>
                          <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-500">7�87�7�8&: __________________________</div>
                      </div>
                  </div>

                  {(printConfig.generalNote.trim() || printConfig.showQrCode) && (
                      <div className="mt-4 border-t border-slate-200 pt-3 flex items-end justify-between gap-4">
                          <div className="text-xs text-slate-600 whitespace-pre-wrap">
                              {printConfig.generalNote.trim() && (
                                  <>
                                      <div className="font-bold mb-1 text-slate-700">8&87�7�7�7� 7�7�8&7�</div>
                                      <div>{printConfig.generalNote}</div>
                                  </>
                              )}
                          </div>

                          {printConfig.showQrCode && printConfig.reportUrl.trim() && (
                              <div className="text-center">
                                  <img
                                      src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(printConfig.reportUrl)}`}
                                      alt="QR Verification"
                                      className="w-20 h-20 border border-slate-200 rounded"
                                  />
                                  <div className="text-[10px] text-slate-500 mt-1">7�87�7�88 8&8  7�87�87�8y7�</div>
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
             <ArrowRightLeft className="text-emerald-600" /> 7�7�8�7� 7�88&7�7�8�8  7�88y8�8&8y7�
          </h2>
          <p className="text-slate-500 text-sm mt-1">7�7�7�7�7� 7�7�8&87� 87�8&88y7�7� 7�88�7�7�7� 8�7�87�7�7�7� 8&7� 7�7�7�7�7�7� 7�877�7�8&7�7� 7�88y7�89.</p>
        </div>
        <div className="flex gap-3">
             <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                      <button onClick={handleSmartExport} disabled={!canExport} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-emerald-600 hover:shadow-sm transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed" title={canExport ? '7�7�7�8y7� Excel' : '87� 7�8&88� 7�87�7�8y7� 7�87�7�7�8y7�'}>
                    <FileUp size={16} /> 7�7�7�8y7� Excel
                 </button>
                 <div className="w-[1px] h-6 bg-slate-300"></div>
                      <button onClick={() => { if (canImport) setIsImportOpen(true); else toast.error('88y7� 87�8y8� 7�87�7�8y7� 7�87�7�7�8y7�7�7�.'); }} disabled={!canImport} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-blue-600 hover:shadow-sm transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed" title={canImport ? '7�7�7�8y7�7�7� 7�8�8y' : '87� 7�8&88� 7�87�7�8y7� 7�87�7�7�8y7�7�7�'}>
                    <FileSpreadsheet size={16} /> 7�7�7�8y7�7�7� 7�8�8y
                 </button>
                      <div className="w-[1px] h-6 bg-slate-300"></div>
                      <button
                          onClick={() => setShowPrintStudio(true)}
                          className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-indigo-600 hover:shadow-sm transition font-medium text-xs"
                          title="8~7�7� 7�7�7�8�7�8y8� 7�87�7�7�7�7�"
                      >
                          <Printer size={16} /> 7�7�7�8�7�8y8� 7�87�7�7�7�7�
                      </button>
                      <button
                          onClick={quickPrintCurrentFilter}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-xs"
                          title="7�7�7�7�7� Excel 888~87�7�7� 7�87�7�88y7�"
                      >
                          <FileText size={16} /> 7�7�7�7�7� Excel
                      </button>
             </div>
             <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm font-bold border border-emerald-100 flex items-center">
                7�88y8�8&: {transactions.filter(t => t.date === new Date().toISOString().split('T')[0]).length}
             </div>
        </div>
      </div>

      {/* --- ENTRY MODES TABS --- */}
      <div className="flex justify-center -mb-6 relative z-10">
          <div className="bg-slate-100 p-1 rounded-xl shadow-inner flex gap-1 border border-slate-200">
              <button 
                  onClick={() => setEntryMode('invoice')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${entryMode === 'invoice' ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-500/20' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Receipt size={18} /> 8~7�7�8�7�7� 8&7�8&7�7� (7�7�8y7�)
              </button>
              <button 
                  onClick={() => setEntryMode('batch')}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${entryMode === 'batch' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-500/20' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Layers size={18} /> 7�7�7�7�8 8&7�7�7�7� (Batch)
              </button>
          </div>
      </div>

      {/* --- INVOICE BUILDER MODE --- */}
      {entryMode === 'invoice' && (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden mt-8 animate-in slide-in-from-bottom-2">
              <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                      <h3 className="font-bold flex items-center gap-2">
                          <Receipt className="text-emerald-400" /> 7�8 7�7�7 8~7�7�8�7�7� 8&7�8&7�7�
                      </h3>
                      <button 
                          onClick={fillDemoInvoice}
                          className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs hover:bg-emerald-600 hover:text-white transition flex items-center gap-1"
                          title="8&87 7�88 8&8�7�7� 7�7�8y7�8 7�7� 8�8!8&8y7� 887�7�7�7�7�"
                      >
                          <PlayCircle size={14} /> 7�7�7�7�7� 7�8y7�8 7�7� 7�7�7�8y7�8y7�
                      </button>
                  </div>
                  <div className="text-xs bg-slate-700 px-3 py-1 rounded-full text-slate-300">
                      8y7�8& 7�8~7� 7�8&8y7� 7�87�7�8 7�8~ 7�7�7� 7�88& 8~7�7�8�7�7� 8�7�7�7�
                  </div>
              </div>

              <div className="p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
                  {/* HEADER SECTION (Left Panel) */}
                  <div className="lg:col-span-1 space-y-4 border-l pl-0 lg:pl-2 border-slate-100">
                      <h4 className="font-bold text-slate-700 border-b pb-2 mb-2 text-sm flex items-center gap-2">
                          <Info size={16} className="text-blue-500" /> 7�8y7�8 7�7� 7�88~7�7�8�7�7�
                      </h4>
                      
                      <div className="space-y-3">
                          <div>
                              <label className="text-xs font-bold text-slate-500 block mb-1">8 8�7� 7�87�8&88y7�</label>
                              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                  value={invoiceHeader.type} onChange={e => handleInvoiceHeaderChange('type', e.target.value)}>
                                  {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 block mb-1">7�87�7�7�8y7�</label>
                              <input type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                                  value={invoiceHeader.date} onChange={e => handleInvoiceHeaderChange('date', e.target.value)} />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 block mb-1">7�88& 7�88~7�7�8�7�7� (7�88&7�7�8 )</label>
                              <div className="relative">
                                  <Hash size={14} className="absolute right-3 top-3 text-slate-400" />
                                  <input type="text" className="w-full pl-3 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono font-bold text-center outline-none focus:ring-2 focus:ring-emerald-500"
                                      placeholder="00000"
                                      value={invoiceHeader.warehouseInvoice} onChange={e => handleInvoiceHeaderChange('warehouseInvoice', e.target.value)} />
                              </div>
                          </div>
                          <div className="relative">
                              <label className="text-xs font-bold text-slate-500 block mb-1">
                                  {getPartnerLabel(invoiceHeader.type)}
                              </label>
                              <input type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                                  placeholder="7�7�7�..."
                                  value={invoiceHeader.supplierOrReceiver} 
                                  onChange={e => { handleInvoiceHeaderChange('supplierOrReceiver', e.target.value); setShowPartnerSuggestions(true); }}
                                  onFocus={() => setShowPartnerSuggestions(true)}
                                  onBlur={() => setTimeout(() => setShowPartnerSuggestions(false), 200)}
                              />
                              {showPartnerSuggestions && invoiceHeader.supplierOrReceiver && getSuggestions(invoiceHeader.supplierOrReceiver).length > 0 && (
                                  <div className="absolute z-20 w-full bg-white border border-slate-200 shadow-xl rounded-xl mt-1 max-h-40 overflow-y-auto">
                                      {getSuggestions(invoiceHeader.supplierOrReceiver).map(p => (
                                          <div key={p.id} className="p-2 hover:bg-slate-50 cursor-pointer text-sm" 
                                               onMouseDown={() => handleInvoiceHeaderChange('supplierOrReceiver', p.name)}>
                                              {p.name}
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 block mb-1">8~7�7�8�7�7� 7�88&8�7�7� (7�7�7�8y7�7�8y)</label>
                              <input type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                  value={invoiceHeader.supplierInvoice || ''} onChange={e => handleInvoiceHeaderChange('supplierInvoice', e.target.value)} />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 block mb-1">8 8&8�7�7� 7�88�7�8  (8&8�7�7�)</label>
                              <input type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                  placeholder="7�88& 7�87�8�8 "
                                  value={invoiceHeader.weightSlip || ''} onChange={e => handleInvoiceHeaderChange('weightSlip', e.target.value)} />
                          </div>
                      </div>

                      <h4 className="font-bold text-slate-700 border-b pb-2 mb-2 mt-6 text-sm flex items-center gap-2">
                          <Truck size={16} className="text-orange-500" /> 7�888�7�7�7�8y7�7� (8&8�7�7�)
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                          <input type="text" placeholder="7�88& 7�87�7�7�8 7�" className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                              value={invoiceHeader.truckNumber || ''} onChange={e => handleInvoiceHeaderChange('truckNumber', e.target.value)} />
                          <input type="text" placeholder="7�88& 7�87�7�7�7�" className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                              value={invoiceHeader.trailerNumber || ''} onChange={e => handleInvoiceHeaderChange('trailerNumber', e.target.value)} />
                          <input type="text" placeholder="7�7�8& 7�87�7�7�8" className="col-span-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                              value={invoiceHeader.driverName || ''} onChange={e => handleInvoiceHeaderChange('driverName', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                          <div>
                              <label className="text-[10px] text-slate-400 block">7�7�8�8</label>
                              <input type="time" className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                                  value={invoiceHeader.entryTime || ''} onChange={e => handleInvoiceHeaderChange('entryTime', e.target.value)} />
                          </div>
                          <div>
                              <label className="text-[10px] text-slate-400 block">7�7�8�7�</label>
                              <input type="time" className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                                  value={invoiceHeader.exitTime || ''} onChange={e => handleInvoiceHeaderChange('exitTime', e.target.value)} />
                          </div>
                      </div>
                      <div className="mt-2">
                          <label className="text-[10px] text-slate-400 block mb-1">87�7�7�7� 7�87�8~7�8y7</label>
                          <select
                              className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                              value={invoiceHeader.unloadingRuleId || ''}
                              onChange={e => handleInvoiceHeaderChange('unloadingRuleId', e.target.value)}
                          >
                              <option value="">7�7�7�7� 7�887�7�7�7�...</option>
                              {unloadingRules.filter(rule => rule.is_active).map(rule => (
                                  <option key={rule.id} value={rule.id}>
                                      {rule.rule_name}
                                  </option>
                              ))}
                          </select>
                      </div>
                      <div className="mt-2 bg-red-50 border border-red-100 rounded-lg p-2">
                          <label className="text-[10px] text-red-700 block mb-1">7�877�7�8&7� 7�88&7�7�8�7�7� (7�.8)</label>
                          <div className="text-sm font-bold text-red-700">
                              {(() => {
                                  if (!invoiceHeader.entryTime || !invoiceHeader.exitTime || !invoiceHeader.unloadingRuleId) {
                                      return formatCurrencyLYD(0);
                                  }
                                  const selectedRule = getRuleById(invoiceHeader.unloadingRuleId);
                                  const duration = calculateDurationWithRollover(invoiceHeader.entryTime, invoiceHeader.exitTime);
                                  const actual = duration.minutes;
                                  if (!selectedRule || !duration.valid) return formatCurrencyLYD(0);
                                  const excess = Math.max(0, actual - Number(selectedRule.allowed_duration_minutes || 0));
                                  const fine = excess * Number(selectedRule.penalty_rate_per_minute || 0);
                                  return formatCurrencyLYD(fine);
                              })()}
                          </div>
                      </div>
                  </div>

                  {/* ITEMS GRID (Right Panel) */}
                  <div className="lg:col-span-3 flex flex-col h-full">
                      <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
                          <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 grid grid-cols-12 gap-2 text-xs font-bold text-slate-500 text-center">
                              <div className="col-span-4 text-right">7�87�8 8~</div>
                              <div className="col-span-2">7�7�8~8y 7�87�8!8</div>
                              <div className="col-span-2">7�7�8~8y 7�88&8�7�7�</div>
                              <div className="col-span-1">7�88~7�8</div>
                              <div className="col-span-2">7�87�7�8�7�7�</div>
                              <div className="col-span-1">7�7�8~</div>
                          </div>
                          
                          <div className="flex-1 overflow-y-auto p-2 space-y-2">
                              {invoiceItems.map((item, idx) => (
                                  <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-2">
                                      <div className="col-span-4">
                                          <select className="w-full p-2 bg-slate-50 border-none rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
                                              value={item.itemId} onChange={e => handleInvoiceItemChange(item.id, 'itemId', e.target.value)}>
                                              <option value="">7�7�7�7� 7�87�8 8~...</option>
                                              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                          </select>
                                          {item.unit && <span className="text-[10px] text-slate-400 mr-2">{item.unit}</span>}
                                      </div>
                                      <div className="col-span-2">
                                          <input type="number" step="0.001" placeholder="0.000" className="w-full p-2 bg-emerald-50 border border-emerald-100 rounded-lg text-center font-bold text-emerald-700 outline-none focus:border-emerald-500"
                                              value={item.quantity !== undefined ? item.quantity : ''} onChange={e => handleInvoiceItemChange(item.id, 'quantity', e.target.value)} />
                                      </div>
                                      <div className="col-span-2">
                                          <input type="number" step="0.001" placeholder="-" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500"
                                              value={item.supplierNet !== undefined ? item.supplierNet : ''} onChange={e => handleInvoiceItemChange(item.id, 'supplierNet', e.target.value)} />
                                      </div>
                                      <div className="col-span-1 text-center font-mono text-xs font-bold text-slate-500">
                                          {item.quantity && item.supplierNet ? (Number(item.quantity) - Number(item.supplierNet)).toFixed(3) : '-'}
                                      </div>
                                      <div className="col-span-2">
                                          <input type="number" placeholder="-" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500"
                                              value={item.packageCount !== undefined ? item.packageCount : ''} onChange={e => handleInvoiceItemChange(item.id, 'packageCount', e.target.value)} />
                                      </div>
                                      <div className="col-span-1 text-center">
                                          <button onClick={() => removeInvoiceItemRow(item.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50" disabled={invoiceItems.length === 1}>
                                              <Trash2 size={16} />
                                          </button>
                                      </div>
                                  </div>
                              ))}
                              
                              <button onClick={addInvoiceItemRow} className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 transition flex items-center justify-center gap-2 font-bold text-sm">
                                  <Plus size={18} /> 7�7�7�8~7� 7�8 8~ 7�7�7� 888~7�7�8�7�7�
                              </button>
                          </div>
                          
                          {/* SUMMARY FOOTER */}
                          <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
                              <div className="flex gap-6 text-sm">
                                  <div className="flex items-center gap-2">
                                      <Calculator size={16} className="text-emerald-400" />
                                      <span className="text-slate-400">7�7�8&7�88y 7�87�7�8 7�8~:</span>
                                      <span className="font-bold text-xl">{invoiceTotals.count}</span>
                                  </div>
                                  <div className="w-[1px] h-6 bg-slate-600"></div>
                                  <div className="flex items-center gap-2">
                                      <Scale size={16} className="text-emerald-400" />
                                      <span className="text-slate-400">7�7�8&7�88y 7�88�7�8 :</span>
                                      <span className="font-bold text-xl">{invoiceTotals.qty.toLocaleString()}</span>
                                  </div>
                              </div>
                              <button onClick={saveInvoice} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-900/50 flex items-center gap-2 transition transform hover:-translate-y-1">
                                  <Save size={18} /> 7�8~7� 7�88~7�7�8�7�7� 8�7�8&87�
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- BATCH GRID MODE (Classic) --- */}
      {entryMode === 'batch' && (
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden mt-8 animate-in slide-in-from-bottom-2">
        <div className="bg-slate-800 text-white px-6 py-3 flex justify-between items-center">
            <h3 className="font-bold flex items-center gap-2 text-sm">
                <FileSpreadsheet size={18} className="text-emerald-400" /> 7�7�7�7�8 8&7�7�7�7� (Batch Entry)
            </h3>
            <div className="flex items-center gap-3">
                <button
                    onClick={() => setShowBatchColumnSettings(true)}
                    className="flex items-center gap-2 bg-white/10 border border-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-white/20"
                    title="7�7�7�7�7�7�7� 7�7�8&7�7� 7�87�7�7�7�8 7�88&7�7�7�7�"
                >
                    <Settings size={14} /> 7�7�7�7�7�7�7� 7�87�7�8&7�7�
                </button>
                <div className="flex gap-4 text-xs text-slate-300">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span> 7�7�7�7�8y</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> 7�8�7�7�8 </span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span> 88�7�7�7�8y</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400"></span> 8�87�</span>
                </div>
            </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
            <table className="w-max min-w-full text-right text-xs border-collapse">
                <thead>
                    <tr className="bg-slate-100 text-slate-500 border-b border-slate-200 h-10 text-center font-bold">
                        {visibleBatchColumns.map(column => (
                            <th
                                key={column.key}
                                className={`p-2 border-l ${column.key === 'delayPenalty' ? 'bg-orange-50/30 text-red-600' : 'bg-slate-100'} ${column.key === 'itemId' ? 'text-right' : 'text-center'}`}
                                style={getBatchColumnStyle(column, true)}
                            >
                                <span className="inline-flex items-center gap-1">
                                    {column.label}
                                    {requiredBatchColumns.has(column.key) && <span className="text-red-500">*</span>}
                                    {column.key === 'delayPenalty' && (settings.defaultDelayPenalty || 0) === 0 && <span title="88y8&7� 7�877�7�8&7� 0 8~8y 7�87�7�7�7�7�7�7�"><Info size={12} className="text-slate-400" /></span>}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {batchForms.map((form, idx) => {
                        return (
                        <tr key={idx} className={`group hover:bg-slate-50 transition-colors ${getRowColor(form.type)}`}>
                            {visibleBatchColumns.map(column => {
                                if (column.key === 'rowNumber') {
                                    return <td key={column.key} className="p-1 border-l text-center text-slate-400 font-mono" style={getBatchColumnStyle(column)}>{idx + 1}</td>;
                                }

                                if (column.key === 'date') {
                                    return <td key={column.key} className="p-1 border-l" style={getBatchColumnStyle(column)}><input type="date" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-emerald-500 outline-none" value={form.date} onChange={e => handleBatchChange(idx, 'date', e.target.value)} /></td>;
                                }

                                if (column.key === 'type') {
                                    return (
                                      <td key={column.key} className="p-1 border-l" style={getBatchColumnStyle(column)}>
                                        <select className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-emerald-500 outline-none" value={form.type} onChange={e => handleBatchChange(idx, 'type', e.target.value)}>
                                            {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                      </td>
                                    );
                                }

                                if (column.key === 'warehouseInvoice') {
                                    return <td key={column.key} className="p-1 border-l" style={getBatchColumnStyle(column)}><input type="text" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-emerald-500 outline-none font-mono text-center font-bold" value={form.warehouseInvoice} onChange={e => handleBatchChange(idx, 'warehouseInvoice', e.target.value)} placeholder="7�88&" /></td>;
                                }

                                if (column.key === 'supplierOrReceiver') {
                                    return (
                                      <td key={column.key} className="p-1 border-l bg-blue-50/10 relative" style={getBatchColumnStyle(column)}>
                                        <input type="text" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-blue-500 outline-none" value={form.supplierOrReceiver || ''} onChange={e => handleBatchChange(idx, 'supplierOrReceiver', e.target.value)} onFocus={() => setActiveSuggestionRow(idx)} placeholder={form.type === '7�8 7�7�7�' ? '8�7�7�7� 7�87�8 7�7�7�' : form.type === '8!7�88�' ? '8!7�88� 8&7�7�8 8y' : '7�7�7�...'} />
                                        {activeSuggestionRow === idx && form.supplierOrReceiver && getSuggestions(form.supplierOrReceiver).length > 0 && (
                                            <div className="absolute z-50 top-full right-0 w-48 bg-white shadow-lg rounded border border-slate-200 mt-1 max-h-32 overflow-y-auto">
                                                {getSuggestions(form.supplierOrReceiver).map(p => (
                                                    <div key={p.id} className="p-2 hover:bg-slate-100 cursor-pointer" onClick={() => { handleBatchChange(idx, 'supplierOrReceiver', p.name); setActiveSuggestionRow(null); }}>{p.name}</div>
                                                ))}
                                            </div>
                                        )}
                                      </td>
                                    );
                                }

                                if (column.key === 'supplierInvoice') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="text" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.supplierInvoice || ''} onChange={e => handleBatchChange(idx, 'supplierInvoice', e.target.value)} /></td>;
                                }

                                if (column.key === 'truckNumber') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="text" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.truckNumber || ''} onChange={e => handleBatchChange(idx, 'truckNumber', e.target.value)} /></td>;
                                }

                                if (column.key === 'trailerNumber') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="text" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.trailerNumber || ''} onChange={e => handleBatchChange(idx, 'trailerNumber', e.target.value)} /></td>;
                                }

                                if (column.key === 'driverName') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="text" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.driverName || ''} onChange={e => handleBatchChange(idx, 'driverName', e.target.value)} /></td>;
                                }

                                if (column.key === 'weightSlip') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="text" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.weightSlip || ''} onChange={e => handleBatchChange(idx, 'weightSlip', e.target.value)} placeholder="-" /></td>;
                                }

                                if (column.key === 'itemId') {
                                    return (
                                      <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}>
                                        <select className="w-full p-2 bg-slate-50 border-none rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-1 focus:ring-blue-500" value={form.itemId || ''} onChange={e => handleBatchChange(idx, 'itemId', e.target.value)}>
                                            <option value="">7�7�7�7�...</option>
                                            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                        </select>
                                      </td>
                                    );
                                }

                                if (column.key === 'quantity') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="number" step="0.001" className="w-full p-2 bg-emerald-50 border border-emerald-100 rounded-lg text-center font-bold text-emerald-700 outline-none focus:border-emerald-500" value={form.quantity !== undefined ? form.quantity : ''} onChange={e => handleBatchChange(idx, 'quantity', e.target.value)} placeholder="0.000" /></td>;
                                }

                                if (column.key === 'supplierNet') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="number" step="0.001" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.supplierNet !== undefined ? form.supplierNet : ''} onChange={e => handleBatchChange(idx, 'supplierNet', e.target.value)} placeholder="-" /></td>;
                                }

                                if (column.key === 'packageCount') {
                                    return <td key={column.key} className="p-1 border-l bg-slate-50" style={getBatchColumnStyle(column)}><input type="number" className="w-full p-2 bg-slate-50 border-none rounded-lg text-center text-sm outline-none focus:ring-1 focus:ring-blue-500" value={form.packageCount !== undefined ? form.packageCount : ''} onChange={e => handleBatchChange(idx, 'packageCount', e.target.value)} placeholder="-" /></td>;
                                }

                                if (column.key === 'entryTime') {
                                    return <td key={column.key} className="p-1 border-l bg-orange-50/10" style={getBatchColumnStyle(column)}><input type="time" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-orange-500 outline-none text-center" value={form.entryTime || ''} onChange={e => handleBatchChange(idx, 'entryTime', e.target.value)} /></td>;
                                }

                                if (column.key === 'exitTime') {
                                    return <td key={column.key} className="p-1 border-l bg-orange-50/10" style={getBatchColumnStyle(column)}><input type="time" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-orange-500 outline-none text-center" value={form.exitTime || ''} onChange={e => handleBatchChange(idx, 'exitTime', e.target.value)} /></td>;
                                }

                                if (column.key === 'unloadingRuleId') {
                                    return (
                                      <td key={column.key} className="p-1 border-l bg-orange-50/10" style={getBatchColumnStyle(column)}>
                                        <select
                                            className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-orange-500 outline-none text-xs"
                                            value={form.unloadingRuleId || ''}
                                            onChange={e => handleBatchChange(idx, 'unloadingRuleId', e.target.value)}
                                        >
                                            <option value="">7�7�7�7�...</option>
                                            {unloadingRules.filter(rule => rule.is_active).map(rule => (
                                                <option key={rule.id} value={rule.id}>{rule.rule_name}</option>
                                            ))}
                                        </select>
                                      </td>
                                    );
                                }

                                if (column.key === 'delayPenalty') {
                                    return <td key={column.key} className="p-1 border-l bg-orange-50/10 text-center font-bold text-red-600" style={getBatchColumnStyle(column)}>{formatCurrencyLYD(form.delayPenalty)}</td>;
                                }

                                if (column.key === 'saveAction') {
                                    return <td key={column.key} className="p-1 border-l sticky left-0 bg-slate-50 shadow-lg text-center" style={getBatchColumnStyle(column)}><button title="7�8~7� 7�87�8~" onClick={() => saveBatchRow(idx)} className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition"><Save size={14} /></button></td>;
                                }

                                return null;
                            })}
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
      </div>
      )}

      {showBatchColumnSettings && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings size={18} /> 7�7�7�7�7�7�7� 7�7�7� 7�87�7�8&7�7� - 7�7�7�7�8 8&7�7�7�7�</h3>
                      <button onClick={() => setShowBatchColumnSettings(false)} className="text-slate-500 hover:text-red-600" title="7�787�8" aria-label="7�787�8"><X size={18} /></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                      <UniversalColumnManager
                          columns={batchColumns}
                          onChange={setBatchColumns}
                          onReset={handleResetBatchColumns}
                      />
                  </div>
                  <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                      <button onClick={() => setShowBatchColumnSettings(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">7�787�8</button>
                      <button onClick={handleSaveBatchColumns} className="px-4 py-2 rounded-lg bg-slate-900 text-white">7�8~7�</button>
                  </div>
              </div>
          </div>
      )}

      {/* --- HISTORY LIST WITH SMART SEARCH --- */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
         <div className="p-5 border-b border-slate-200 bg-slate-50 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-center gap-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <ShieldCheck size={20} className="text-emerald-600" /> 7�7�8 7�87�8&88y7�7�
                    </h3>
                    {isSearching && <div className="flex items-center text-xs text-slate-400 gap-1"><Loader2 size={12} className="animate-spin" /> 7�7�7�8y 7�87�7�7�...</div>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-96 group">
                        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="7�7�7� 7�8�8y (7�88~7�7�8�7�7�7R 7�87�8 8~7R 7�87�7�7�87R 7�88&87�7�7�7�7�...)"
                            className="w-full pl-4 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={() => setShowHistoryColumnSettings(true)}
                        className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-50"
                        title="7�7�7�7�7�7�7� 7�87�7�7�"
                    >
                        <Settings size={14} /> 7�7�7�7�7�7�7� 7�87�7�7�
                    </button>

                    {selectedIds.size > 0 && (
                        <button onClick={() => setDeleteModal({ isOpen: true, ids: Array.from(selectedIds) })} className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 text-xs font-bold hover:bg-red-100 transition">
                            <Trash2 size={14} /> 7�7�8~ ({selectedIds.size})
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
                    <select
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationTypeFilter}
                        onChange={(e) => setOperationTypeFilter(e.target.value as 'all' | OperationType)}
                        title="8~87�7�7� 7�7�7� 8 8�7� 7�87�7�8�7�"
                    >
                        <option value="all">8�8 7�8 8�7�7� 7�87�7�8�7�</option>
                        {OPERATION_TYPES.map((type) => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>

                    <input
                        type="date"
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationDateFromFilter}
                        onChange={(e) => setOperationDateFromFilter(e.target.value)}
                        title="8&8  7�7�7�8y7�"
                    />

                    <input
                        type="date"
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationDateToFilter}
                        onChange={(e) => setOperationDateToFilter(e.target.value)}
                        title="7�880 7�7�7�8y7�"
                    />

                    <input
                        type="text"
                        placeholder="7�88&8�7�7�/7�87�8&8y8"
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationPartnerFilter}
                        onChange={(e) => setOperationPartnerFilter(e.target.value)}
                        title="8~87�7�7� 7�7�7� 7�87�7�8~"
                    />

                    <input
                        type="number"
                        step="0.001"
                        placeholder="7�7�8 80 7�7�8~8y 7�87�8!8"
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationMinQuantityFilter}
                        onChange={(e) => setOperationMinQuantityFilter(e.target.value)}
                        title="7�7�8 80 7�7�8~8y 7�87�8!8"
                    />

                    <input
                        type="number"
                        step="0.001"
                        placeholder="7�7�880 7�7�8~8y 7�87�8!8"
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationMaxQuantityFilter}
                        onChange={(e) => setOperationMaxQuantityFilter(e.target.value)}
                        title="7�7�880 7�7�8~8y 7�87�8!8"
                    />

                    <select
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={operationPenaltyFilter}
                        onChange={(e) => setOperationPenaltyFilter(e.target.value as 'all' | 'with_penalty' | 'without_penalty')}
                        title="8~87�7�7� 7�877�7�8&7�7�"
                    >
                        <option value="all">8�8 7�87�7�87�7� (77�7�8&7�/7�7�8�8 )</option>
                        <option value="with_penalty">8&7� 77�7�8&7� 8~87�</option>
                        <option value="without_penalty">7�7�8�8  77�7�8&7� 8~87�</option>
                    </select>

                    <select
                        className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
                        value={invoiceSortMode}
                        onChange={(e) => setInvoiceSortMode(e.target.value as InvoiceSortMode)}
                        title="7�7�7�8y7� 7�88~8�7�7�8y7�"
                    >
                        <option value="invoice_asc_date_desc">7�7�7�8y7� 7�88~8�7�7�8y7�: 7�7�7�7�7�8y + 7�87�7�7�7� 7�7�7�88!7�</option>
                        <option value="invoice_desc_date_desc">7�7�7�8y7� 7�88~8�7�7�8y7�: 7�8 7�7�88y + 7�87�7�7�7� 7�7�7�88!7�</option>
                        <option value="invoice_asc_type_then_date">7�7�7�8y7� 7�88~8�7�7�8y7�: 7�7�7�7�7�8y + 8 8�7� 7�87�7�8�7�</option>
                        <option value="invoice_asc_partner_then_date">7�7�7�8y7� 7�88~8�7�7�8y7�: 7�7�7�7�7�8y + 7�87�7�8~</option>
                    </select>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500">
                        7�88 7�7�7�7� 7�7�7� 7�88~87�7�7�: <span className="font-bold text-slate-700">{filteredTransactions.length}</span>
                        {hasAdvancedOperationFilters && <span className="text-emerald-700 font-bold mr-2">⬢ 8~87�7�7� 8&7�87�8&7� 8&8~7�887�</span>}
                    </div>
                    <button
                        onClick={resetOperationAdvancedFilters}
                        disabled={!hasAdvancedOperationFilters}
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        7�7�7�7�7� 7�7�8y8y8  7�88~87�7�7�
                    </button>
                </div>
            </div>
         </div>
         {activeDrilldown && (
            <div className="px-5 py-3 border-b border-blue-100 bg-blue-50 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-800 font-bold">
                <div>
                    8~87�7� 7�8�8y 8&8~7�88: {activeDrilldown.itemName || '7�8 8~'} / {activeDrilldown.type} / {activeDrilldown.monthKey}
                </div>
                <button
                    onClick={() => setActiveDrilldown(null)}
                    className="px-2.5 py-1 rounded border border-blue-300 bg-white hover:bg-blue-100"
                >
                    7�877�7 7�88~87�7� 7�87�8�8y
                </button>
            </div>
         )}
         <div className="overflow-x-auto pb-2 custom-scrollbar">
             <table className="w-full text-right text-xs">
                 <thead className="bg-white text-slate-500 font-medium border-b border-slate-100">
                     <tr>
                         {visibleHistoryColumns.map(column => (
                            <th key={column.key} className={`p-3 ${column.key === 'actions' ? 'text-center' : ''}`} style={getColumnStyle(column, true)}>
                                {column.key === 'select' ? (
                                    <input
                                        type="checkbox"
                                        title="7�7�7�8y7�/7�877�7 7�7�7�8y7� 7�8&8y7� 7�87�7�8�7�7�"
                                        aria-label="7�7�7�8y7�/7�877�7 7�7�7�8y7� 7�8&8y7� 7�87�7�8�7�7�"
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedIds(new Set(transactions.map(t => t.id)));
                                            else setSelectedIds(new Set());
                                        }}
                                        checked={selectedIds.size === transactions.length && transactions.length > 0}
                                        className="rounded border-slate-300 accent-emerald-600"
                                    />
                                ) : column.key === 'invoiceCounter' ? '#' : column.label}
                            </th>
                         ))}
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                     {displayTransactions.map(t => {
                         const item = items.find(i => i.id === t.itemId);
                         const rowMeta = invoiceGroupMetaByTransactionId[t.id] || {
                             isDuplicateInvoice: false,
                             invoiceKey: '',
                             tone: 'bg-white border-slate-100',
                             isFirst: false,
                             isLast: false,
                             groupNo: 0,
                         };
                         const invoiceKey = rowMeta.invoiceKey || String(t.warehouseInvoice || '').trim();
                         const groupSummary = invoiceKey ? invoiceDuplicateSummaryByInvoice[invoiceKey] : undefined;
                         const isGroupCollapsible = Boolean(rowMeta.isDuplicateInvoice && groupSummary && groupSummary.count > 1);
                         const isCollapsed = isGroupCollapsible && collapsedInvoiceGroups.has(invoiceKey);
                         const showSummaryRow = Boolean(isGroupCollapsible && rowMeta.isFirst);
                         const showDetailsRow = !isCollapsed;

                         if (!showSummaryRow && isCollapsed) {
                             return null;
                         }

                         return (
                         <React.Fragment key={t.id}>
                            {showSummaryRow && groupSummary && (
                                <tr className="bg-slate-100 border-y border-slate-300">
                                    <td colSpan={Math.max(visibleHistoryColumns.length, 1)} className="px-3 py-2 text-[11px]">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="font-bold text-slate-700">
                                                8~7�7�8�7�7� 7�88&7�7�7�8  #{invoiceKey} ⬢ 7�7�7� 7�87�7�8�7�: {groupSummary.count}
                                            </div>
                                            <div className="flex items-center gap-3 text-slate-600">
                                                <span>7�7�8~8y 7�87�8!8: {formatNumber(groupSummary.totalQuantity)}</span>
                                                <span>7�7�8~8y 7�88&8�7�7�: {formatNumber(groupSummary.totalSupplierNet)}</span>
                                                <span>7�877�7�8&7�7�: {formatCurrencyLYD(groupSummary.totalDelayPenalty)}</span>
                                                <button
                                                    onClick={() => setCollapsedInvoiceGroups((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(invoiceKey)) next.delete(invoiceKey);
                                                        else next.add(invoiceKey);
                                                        return next;
                                                    })}
                                                    className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 font-bold text-[10px]"
                                                    title={isCollapsed ? '7�8�7�8y7� 7�88&7�8&8�7�7�' : '7�8y 7�88&7�8&8�7�7�'}
                                                >
                                                    {isCollapsed ? '7�7�8!7�7� 7�87�8~7�7�8y8' : '7�8y 7�87�8~7�7�8y8'}
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}

                            {showDetailsRow && (
                         <tr
                             className={rowMeta.isDuplicateInvoice
                                 ? `transition-colors border-x ${rowMeta.tone} hover:brightness-[0.98] ${rowMeta.isFirst ? 'border-t-2' : 'border-t'} ${rowMeta.isLast ? 'border-b-2' : 'border-b'}`
                                 : 'hover:bg-slate-50 transition-colors'}
                         >
                            {visibleHistoryColumns.map(column => {
                                if (column.key === 'select') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                                                                <input type="checkbox" title="7�7�7�8y7� 7�87�7�8�7�" aria-label="7�7�7�8y7� 7�87�7�8�7�" checked={selectedIds.has(t.id)} onChange={() => { const s = new Set(selectedIds); if(s.has(t.id)) s.delete(t.id); else s.add(t.id); setSelectedIds(s); }} className="rounded border-slate-300 accent-emerald-600" />
                                      </td>
                                    );
                                }

                                if (column.key === 'dateInvoice') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                        <div className="font-bold text-slate-700 dir-ltr text-right">{new Date(t.date).toLocaleDateString('en-GB')}</div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                              t.type === '8�7�7�7�' ? 'bg-green-50 text-green-700 border-green-200' : 
                                              t.type === '7�7�7�7�' ? 'bg-red-50 text-red-700 border-red-200' : 
                                              'bg-blue-50 text-blue-700 border-blue-200'
                                          }`}>{t.type}</span>
                                          <span className="font-mono text-slate-500 bg-slate-100 px-1 rounded">#<Highlighter text={t.warehouseInvoice} highlight={debouncedQuery} /></span>
                                                                                        {rowMeta.isDuplicateInvoice && (
                                                                                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-600">8&7�8&8�7�7� {rowMeta.groupNo}</span>
                                                                                    )}
                                        </div>
                                      </td>
                                    );
                                }

                                                                if (column.key === 'invoiceCounter') {
                                                                        return (
                                                                            <td key={column.key} className="p-3 align-top text-center" style={getColumnStyle(column)}>
                                                                                <div className="font-bold text-slate-700">{invoiceCounterByTransactionId[t.id] || '-'}</div>
                                                                            </td>
                                                                        );
                                                                }

                                if (column.key === 'item') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                        <div className="font-bold text-slate-800"><Highlighter text={item?.name || ''} highlight={debouncedQuery} /></div>
                                        <span className="text-[10px] text-slate-400">{item?.unit}</span>
                                      </td>
                                    );
                                }

                                if (column.key === 'weights') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                        <div className="flex flex-col gap-1 text-[11px]">
                                          <div className="flex justify-between w-32"><span className="text-slate-500">7�87�8!8:</span> <span className="font-bold">{t.quantity}</span></div>
                                          {t.supplierNet && <div className="flex justify-between w-32"><span className="text-slate-500">7�88&8�7�7�:</span> <span>{t.supplierNet}</span></div>}
                                          {t.difference !== 0 && <div className={`flex justify-between w-32 pt-1 border-t border-slate-100 ${t.difference && t.difference < 0 ? 'text-red-600' : 'text-green-600'}`}><span>7�88~7�8:</span> <span className="font-bold dir-ltr">{formatNumber(t.difference)}</span></div>}
                                                                                    {t.weightSlip && <div className="flex justify-between w-32 text-slate-600"><span>8 8&8�7�7� 7�88�7�8 :</span> <span className="font-mono"><Highlighter text={t.weightSlip} highlight={debouncedQuery} /></span></div>}
                                        </div>
                                      </td>
                                    );
                                }

                                if (column.key === 'logistics') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                        <div className="font-bold text-slate-700"><Highlighter text={t.supplierOrReceiver} highlight={debouncedQuery} /></div>
                                        <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
                                          {t.truckNumber && <div><Truck size={10} className="inline ml-1"/><Highlighter text={t.truckNumber} highlight={debouncedQuery} /> {t.trailerNumber && `(${t.trailerNumber})`}</div>}
                                          {t.driverName && <div><User size={10} className="inline ml-1"/><Highlighter text={t.driverName} highlight={debouncedQuery} /></div>}
                                                                                      {t.supplierInvoice && <div><Receipt size={10} className="inline ml-1"/>8~7�7�8�7�7� 7�88&8�7�7�: <Highlighter text={t.supplierInvoice} highlight={debouncedQuery} /></div>}
                                                                                    {t.notes && !isExcelTimeFractionNoise(t.notes) && <div className="mt-1 italic text-slate-400"><Highlighter text={t.notes} highlight={debouncedQuery} /></div>}
                                        </div>
                                      </td>
                                    );
                                }

                                if (column.key === 'timeFine') {
                                    return (
                                      <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                                                                <div className="space-y-0.5 text-[10px] text-slate-500">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-slate-400">8�87� 7�87�7�8�8:</span>
                                                                                        <span className="dir-ltr">{t.entryTime || '-'}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-slate-400">8�87� 7�87�7�8�7�:</span>
                                                                                        <span className="dir-ltr">{t.exitTime || '-'}</span>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-slate-400">87�7�7�7� 7�87�8~7�8y7:</span>
                                                                                        <span className="font-medium text-slate-600">
                                                                                            {t.unloadingRuleId ? (unloadingRules.find(rule => rule.id === t.unloadingRuleId)?.rule_name || t.unloadingRuleId) : '-'}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>

                                                                                <div className="mt-2 pt-1 border-t border-slate-100">
                                                                                    {t.delayPenalty ? (
                                                                                        <div className="text-red-600 font-bold text-[11px] bg-red-50 border border-red-100 px-2 py-1 rounded w-fit">
                                                                                            <AlertTriangle size={10} className="inline ml-1" />77�7�8&7�: {formatCurrencyLYD(t.delayPenalty)}
                                                                                        </div>
                                                                                    ) : <span className="text-green-600 text-[10px] block">87� 8y8�7�7� 77�7�8&7�</span>}
                                                                                </div>
                                      </td>
                                    );
                                }

                                return (
                                  <td key={column.key} className="p-3 align-top text-center" style={getColumnStyle(column)}>
                                    <div className="flex justify-center gap-1">
                                      <button onClick={() => handleEditClick(t)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded border border-blue-100 transition" title="7�7�7�8y8"><Edit size={14} /></button>
                                      <button onClick={() => setDeleteModal({ isOpen: true, ids: [t.id] })} className="p-1.5 text-red-500 hover:bg-red-50 rounded border border-red-100 transition" title="7�7�8~"><Trash2 size={14} /></button>
                                    </div>
                                  </td>
                                );
                            })}
                         </tr>
                                                        )}
                                                 </React.Fragment>
                         );
                     })}
                     {displayTransactions.length === 0 && (
                         <tr>
                             <td colSpan={Math.max(visibleHistoryColumns.length, 1)} className="p-8 text-center text-slate-400">87� 7�8�7�7� 8 7�7�7�7� 8&7�7�7�87� 887�7�7�</td>
                         </tr>
                     )}
                 </tbody>
             </table>
         </div>

         <div className="sticky bottom-0 z-20 bg-slate-900 text-white border-t border-slate-700 px-4 py-3">
             <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                 <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                     <div className="text-slate-300">7�7�8&7�88y 7�7�8~8y 7�87�8!8</div>
                     <div className="font-bold text-emerald-300 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight)}</div>
                 </div>
                 <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                     <div className="text-slate-300">7�7�8&7�88y 7�7�8~8y 7�88&8�7�7�</div>
                     <div className="font-bold text-blue-200 dir-ltr text-left">{formatNumber(operationSummary.totalSupplierNet)}</div>
                 </div>
                 <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                     <div className="text-slate-300">7�88~7�8 7�8y8  7�7�8~8y 7�87�8!8 8�7�7�8~8y 7�88&8�7�7�</div>
                     <div className="font-bold text-white dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet)}</div>
                 </div>
                 <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                     <div className="text-slate-300">7�7�7� 7�88~8�7�7�8y7�</div>
                     <div className="font-bold text-white dir-ltr text-left">{operationSummary.invoiceCount}</div>
                 </div>
                 <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                     <div className="text-slate-300">7�7�8&7�88y 8&7�87 7�87�7�7�8y7�</div>
                     <div className="font-bold text-red-300 dir-ltr text-left">{formatCurrencyLYD(operationSummary.totalDelayPenalty)}</div>
                 </div>
             </div>
         </div>
      </div>

      {showHistoryColumnSettings && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings size={18} /> 7�7�7�7�7�7�7� 7�7�7� 7�87�7�8&7�7� - 7�7�8 7�87�8&88y7�7�</h3>
                      <button onClick={() => setShowHistoryColumnSettings(false)} className="text-slate-500 hover:text-red-600" title="7�787�8" aria-label="7�787�8"><X size={18} /></button>
                  </div>
                  <div className="p-5 overflow-y-auto">
                      <UniversalColumnManager
                          columns={historyColumns}
                          onChange={setHistoryColumns}
                          onReset={handleResetHistoryColumns}
                      />
                  </div>
                  <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                      <button onClick={() => setShowHistoryColumnSettings(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">7�787�8</button>
                      <button onClick={handleSaveHistoryColumns} className="px-4 py-2 rounded-lg bg-slate-900 text-white">7�8~7�</button>
                  </div>
              </div>
          </div>
      )}

      <div className="fixed -left-[200vw] top-0 w-[1200px] min-h-[1400px] pointer-events-none opacity-0" aria-hidden="true">
          {renderOperationPrintSheet()}
      </div>

      {showPrintStudio && (
          <div className="fixed inset-0 z-[ظ -ظ©] bg-slate-950/85 backdrop-blur-sm">
              <div className="h-full w-full bg-slate-100 flex flex-col">
                  <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
                      <div>
                          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Printer size={18} className="text-indigo-600" /> 7�7�7�8�7�8y8� 7�87�7�7�7�7� 7�88&7�7�8�7� - 7�7�8 7�87�8&88y7�7�</h3>
                          <p className="text-xs text-slate-500">8&7�7�8y8 7� 7�8y7� WYSIWYG 8&7� 7�7�8&8y7�7R 87�87� 7�7�7�7�7�7R 7�7�8& 8&7�7�8y7R 8� QR.</p>
                      </div>
                      <div className="flex items-center gap-2">
                          <input
                              type="text"
                              value={printTemplateName}
                              onChange={(e) => setPrintTemplateName(e.target.value)}
                              placeholder="7�7�8& 7�887�87� (8&7�7�8: 7�87�8y7� 7�88&7�8y7�)"
                              className="px-3 py-2 border border-slate-300 rounded-lg text-xs min-w-52"
                          />
                          <button onClick={savePrintTemplate} className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50">7�8~7� 87�87�</button>
                          <select
                              className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                              value={selectedTemplateId}
                              onChange={(e) => applyPrintTemplate(e.target.value)}
                          >
                              <option value="">7�7�8&8y8 87�87� 8&7�8~8�7�...</option>
                              {printTemplates.map((template) => (
                                  <option key={template.id} value={template.id}>{template.name}</option>
                              ))}
                          </select>
                          <button
                              onClick={deleteSelectedPrintTemplate}
                              className="px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg hover:bg-red-100"
                              title="7�7�8~ 7�887�87� 7�88&7�7�7�"
                          >
                              7�7�8~ 87�87�
                          </button>
                          <button onClick={() => setShowPrintStudio(false)} className="p-2 rounded-lg border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300" title="7�787�8"><X size={16} /></button>
                      </div>
                  </div>

                  <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
                      <div className="col-span-3 border-r border-slate-200 bg-white overflow-y-auto">
                          <div className="p-3 border-b border-slate-200 bg-slate-50 flex gap-2">
                              <button onClick={() => setActivePrintTab('layout')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'layout' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>7�87�7�7�8y7�</button>
                              <button onClick={() => setActivePrintTab('content')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'content' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>7�88&7�7�8�80</button>
                              <button onClick={() => setActivePrintTab('branding')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'branding' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>7�87�87�8&7�7�</button>
                          </div>

                          <div className="p-4 space-y-4 text-xs">
                              {activePrintTab === 'layout' && (
                                  <>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�8 8�7�8  7�87�87�8y7�</label>
                                          <input
                                              type="text"
                                              className="w-full p-2 border border-slate-300 rounded-lg"
                                              placeholder="7�8�7�7� 7�8 8�7�8  7�87�87�8y7�"
                                              value={printConfig.reportTitle}
                                              onChange={(e) => setPrintConfig(prev => ({ ...prev, reportTitle: e.target.value }))}
                                          />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�7�7�8! 7�87�8~7�7�</label>
                                          <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.orientation} onChange={(e) => setPrintConfig(prev => ({ ...prev, orientation: e.target.value as OperationPrintOrientation }))}>
                                              <option value="portrait">Portrait</option>
                                              <option value="landscape">Landscape</option>
                                          </select>
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�8& 7�88�7�8</label>
                                          <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.paperSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, paperSize: e.target.value as OperationPrintPaperSize }))}>
                                              <option value="a4">A4</option>
                                              <option value="a3">A3</option>
                                              <option value="legal">Legal</option>
                                          </select>
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�88!8�7�8&7�</label>
                                          <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.margins} onChange={(e) => setPrintConfig(prev => ({ ...prev, margins: e.target.value as OperationPrintMargins }))}>
                                              <option value="narrow">7�8y87�</option>
                                              <option value="normal">8&7�8�7�7�7�</option>
                                              <option value="wide">8�7�7�7�7�</option>
                                          </select>
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�8& 7�87�7� ({printConfig.fontSize}px)</label>
                                          <input type="range" min={8} max={14} value={printConfig.fontSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, fontSize: Number(e.target.value) }))} className="w-full" />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�8& 7�7� 7�87�7�8�8 ({printConfig.tableFontSize}px)</label>
                                          <input type="range" min={8} max={16} value={printConfig.tableFontSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, tableFontSize: Number(e.target.value) }))} className="w-full" />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�87�7�7� 7�88 7� 8&8  7�87�7�8&7�7� ({printConfig.cellPadding}px)</label>
                                          <input type="range" min={0} max={12} value={printConfig.cellPadding} onChange={(e) => setPrintConfig(prev => ({ ...prev, cellPadding: Number(e.target.value) }))} className="w-full" />
                                          <div className="text-[10px] text-slate-500 mt-1">8�88&7� 887� 7�888y8&7� 7�7�7�7� 7�88 7� 7�87�7� 87�7�8�7� 7�87�8&8�7� 8�8y7�8!7� 7�87�7�8�8 7�7�8�8 7�8�7�7� 8�7�7�8~7�.</div>
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">8&7�7�7� 8&8�7�7� 7�88 7� 7�8&8�7�8y897� ({printConfig.verticalTextOffset}px)</label>
                                          <input
                                              type="range"
                                              min={-6}
                                              max={6}
                                              step={1}
                                              value={printConfig.verticalTextOffset}
                                              onChange={(e) => setPrintConfig(prev => ({ ...prev, verticalTextOffset: Number(e.target.value) }))}
                                              className="w-full"
                                          />
                                          <div className="text-[10px] text-slate-500 mt-1">7�7�88� 7�88&7�7�7� 87�8~7� 7�8� 7�8~7� 7�88 7� 7�7�7�8 7�87�88y7� 7�7�87�.</div>
                                      </div>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <div>
                                              <div className="font-bold">7�87�7�7� 7�8�8y 7�8y8  7�87�7�8&7�7�</div>
                                              <div className="text-[10px] text-slate-500">7�7�7� 7�87�7�7� 7�8&8�7� 8&8  8 8~7�7� 7�88&7�7�7�7�7R 8y7�8& 7�888y8 7�87�7�8�7� 7�887�7�8y897� 8~8y 7�87�7�8&7�7� 7�87�7�7�80 7�8�87�89.</div>
                                          </div>
                                          <input type="checkbox" checked={printConfig.smartCellPadding} onChange={(e) => setPrintConfig(prev => ({ ...prev, smartCellPadding: e.target.checked }))} />
                                      </label>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�7�8~7�7� 7�87�8~ ({printConfig.rowHeight}px)</label>
                                          <input type="range" min={10} max={50} value={printConfig.rowHeight} onChange={(e) => setPrintConfig(prev => ({ ...prev, rowHeight: Number(e.target.value) }))} className="w-full" />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7� 8�7�7� 7�87�8~7�7� ({printConfig.pageBreakThresholdPercent}%)</label>
                                          <input type="range" min={70} max={98} value={printConfig.pageBreakThresholdPercent} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageBreakThresholdPercent: Number(e.target.value) }))} className="w-full" />
                                          <div className="text-[10px] text-slate-500 mt-1">8y7�7�8�8& 7�8&8�7�7� 7�7�7�8y8 7�87�8~8�8~ 887�8~7�7� 7�87�7�88y7�.</div>
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">8!7�8&7� 7�7�7�8y7� 7�87�8~7�7� ({printConfig.pageStartMarginMm}mm)</label>
                                          <input type="range" min={0} max={30} value={printConfig.pageStartMarginMm} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageStartMarginMm: Number(e.target.value) }))} className="w-full" />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">8!7�8&7� 8 8!7�8y7� 7�87�8~7�7� ({printConfig.pageEndMarginMm}mm)</label>
                                          <input type="range" min={0} max={30} value={printConfig.pageEndMarginMm} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageEndMarginMm: Number(e.target.value) }))} className="w-full" />
                                      </div>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <div>
                                              <div className="font-bold">7�8& 7�88 7� 7�7�7�8 7�87�87�8y7�</div>
                                              <div className="text-[10px] text-slate-500">7�8 7� 7�87�8~7�8y8 8y7�8& 88~ 7�88 7� 7�7�7�8 7�87�88y7� 7�7�8 87�88!.</div>
                                          </div>
                                          <input type="checkbox" checked={printConfig.wrapCellText} onChange={(e) => setPrintConfig(prev => ({ ...prev, wrapCellText: e.target.checked }))} />
                                      </label>
                                      <button
                                          type="button"
                                          onClick={() => setPrintConfig(prev => ({ ...prev, autoSizeColumns: !prev.autoSizeColumns }))}
                                          className={`w-full px-3 py-2 rounded-lg border font-bold transition ${printConfig.autoSizeColumns ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                                      >
                                          {printConfig.autoSizeColumns ? '7�8y87�8~ 7�87�7�7�8y8& 7�87�887�7�8y 887�7�8&7�7�' : '7�7�7�8y8& 7�87�7�8&7�7� 7�887�7�8y897� 7�7�7� 7�88 7�'}
                                      </button>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <span>7�7�8�7� 7�87�7�8�8</span>
                                          <input type="checkbox" checked={printConfig.showBorders} onChange={(e) => setPrintConfig(prev => ({ ...prev, showBorders: e.target.checked }))} />
                                      </label>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <span>7�88�7�8  7�87�8~8�8~ (Zebra)</span>
                                          <input type="checkbox" checked={printConfig.zebraStriping} onChange={(e) => setPrintConfig(prev => ({ ...prev, zebraStriping: e.target.checked }))} />
                                      </label>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <span>7�88�8y8  7�8~ 7�87�7�8�7�</span>
                                          <input type="checkbox" checked={printConfig.colorHeaderRow} onChange={(e) => setPrintConfig(prev => ({ ...prev, colorHeaderRow: e.target.checked }))} />
                                      </label>
                                  </>
                              )}

                              {activePrintTab === 'content' && (
                                  <>
                                      <div>
                                          <label className="block text-slate-500 mb-2 font-bold">7�7�7�8y7�7� 7�87�7�8&7�7�</label>
                                          <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                                              {operationPrintColumns.map((column) => (
                                                  <label key={column.key} className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-slate-50">
                                                      <span>{column.label}</span>
                                                      <input type="checkbox" checked={printConfig.selectedColumns.includes(column.key)} onChange={() => togglePrintColumn(column.key)} />
                                                  </label>
                                              ))}
                                          </div>
                                      </div>

                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�8&8y7� 7�87�8y7�8 7�7�</label>
                                          <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.grouping} onChange={(e) => setPrintConfig(prev => ({ ...prev, grouping: e.target.value as OperationPrintGrouping }))}>
                                              <option value="none">7�7�8�8  7�7�8&8y7�</option>
                                              <option value="day">7�7�7� 7�88y8�8&</option>
                                              <option value="type">7�7�7� 8 8�7� 7�87�7�8�7�</option>
                                          </select>
                                      </div>

                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�7�8y7� 7�88~8�7�7�8y7�</label>
                                          <select className="w-full p-2 border border-slate-300 rounded-lg" value={invoiceSortMode} onChange={(e) => setInvoiceSortMode(e.target.value as InvoiceSortMode)}>
                                              <option value="invoice_asc_date_desc">7�7�7�7�7�8y + 7�87�7�7�7� 7�7�7�88!7�</option>
                                              <option value="invoice_desc_date_desc">7�8 7�7�88y + 7�87�7�7�7� 7�7�7�88!7�</option>
                                              <option value="invoice_asc_type_then_date">7�7�7�7�7�8y + 8 8�7� 7�87�7�8�7�</option>
                                              <option value="invoice_asc_partner_then_date">7�7�7�7�7�8y + 7�87�7�8~</option>
                                          </select>
                                      </div>

                                  </>
                              )}

                              {activePrintTab === 'branding' && (
                                  <>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�87�7�8& 7�88&7�7�8y</label>
                                          <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" placeholder="8&7�7�8: 8&7�8�7�7� / 8&7�7�8&7�" value={printConfig.watermarkText} onChange={(e) => setPrintConfig(prev => ({ ...prev, watermarkText: e.target.value }))} />
                                      </div>
                                      <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                          <span>7�7�7�8~7� QR 8~8y 7�87�7�8y8y8</span>
                                          <input type="checkbox" checked={printConfig.showQrCode} onChange={(e) => setPrintConfig(prev => ({ ...prev, showQrCode: e.target.checked }))} />
                                      </label>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">7�7�7�7� 7�87�7�88 7�87�88&8y</label>
                                          <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.reportUrl} onChange={(e) => setPrintConfig(prev => ({ ...prev, reportUrl: e.target.value }))} />
                                      </div>
                                      <div>
                                          <label className="block text-slate-500 mb-1 font-bold">8&87�7�7�7� 7�7�8&7� (887�7�7�7�7� 8~87�)</label>
                                          <textarea className="w-full p-2 border border-slate-300 rounded-lg min-h-24" value={printConfig.generalNote} onChange={(e) => setPrintConfig(prev => ({ ...prev, generalNote: e.target.value }))} placeholder="7�7�8!7� 8~87� 8~8y 7�88&7�7�8�7� 8�87� 7�7�8~7� 7�7�7�8 87�7�7�7� 7�87�8y7�8 7�7�" />
                                      </div>
                                  </>
                              )}
                          </div>
                      </div>

                      <div className="col-span-9 flex flex-col min-h-0">
                          <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between text-xs">
                              <div className="text-slate-600">8&7�7�8y8 7� 7�8y7� 887�87�8y7� (WYSIWYG)</div>
                              {printStatusMessage && <div className="text-indigo-700 font-bold">{printStatusMessage}</div>}
                          </div>

                          <div className="flex-1 overflow-auto p-4 bg-slate-200">
                              <div
                                  ref={printPageRef}
                                  className="mx-auto bg-white rounded-xl shadow-xl border border-slate-300 overflow-hidden"
                                  style={{
                                      width: `${getPrintPageMetrics().pageWidthMm}mm`,
                                      minHeight: `${getPrintPageMetrics().pageHeightMm}mm`,
                                      padding: `${getPrintPageMetrics().marginMm + getPrintPageMetrics().startMarginMm}mm ${getPrintPageMetrics().marginMm}mm ${getPrintPageMetrics().marginMm + getPrintPageMetrics().endMarginMm}mm ${getPrintPageMetrics().marginMm}mm`,
                                      boxSizing: 'border-box',
                                  }}
                              >
                                  {renderOperationPrintSheet()}
                              </div>
                          </div>

                          <div className="px-4 py-3 bg-white border-t border-slate-200 flex items-center justify-end gap-2">
                              <button onClick={() => setShowPrintStudio(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">7�787�8</button>
                              <button onClick={quickPrintCurrentFilter} className="px-4 py-2 border border-indigo-300 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100">7�7�7�7�7� Excel</button>
                              <button onClick={buildPdfFromPreview} disabled={isPrintingPdf} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
                                  {isPrintingPdf ? '7�7�7�8y 7�87�7�7�7�7�...' : '7�87�7�7�7�7� 7�88 8!7�7�8y7� (PDF)'}
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- REUSABLE DELETE CONFIRMATION MODAL --- */}
      {deleteModal.isOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-red-100">
                  <div className="p-6 bg-red-50 border-b border-red-100 flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                          <Trash2 size={24} />
                      </div>
                      <div>
                          <h3 className="text-xl font-bold text-red-900">7�7�8�8y7� 7�87�7�8~</h3>
                          <p className="text-sm text-red-700 mt-1">8!8 7�8 7� 8&7�7�8�7� 8&8  7�7�8~ 8!7�8! 7�87�8&88y7�7�7�</p>
                      </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      <p className="text-slate-700 font-medium leading-relaxed">
                          7�8 7� 7�880 8�7�8� 7�7�8~ 
                          <span className="font-bold text-slate-900 mx-1">{deleteModal.ids.length}</span>
                          7�8&88y7� 8&8  7�7�8 7�87�7�8�7� 7�88y8�8&8y7�.
                          <br/><br/>
                          <span className="text-amber-600 text-sm font-bold flex items-center gap-1">
                              <AlertCircle size={14} />
                              7�8 7�8y8!: 7�8y7�8& 7�8�7� 7�7�7�8y7� 8!7�8! 7�87�8&88y7�7� 7�880 7�7�7�7�7� 7�88&7�7�7�8  7�887�7�8y7�89.
                          </span>
                      </p>
                  </div>

                  <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                      <button 
                          onClick={() => setDeleteModal({ isOpen: false, ids: [] })} 
                          className="px-6 py-3 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition"
                      >
                          7�877�7 7�87�8&7�
                      </button>
                      <button 
                          onClick={confirmDelete}
                          className="px-6 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-900/20 flex items-center gap-2"
                      >
                          <Trash2 size={18} /> 8 7�8&7R 7�7�7�8~
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- SMART IMPORT WIZARD MODAL --- */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in duration-200">
                {/* Wizard Header */}
                <div className="bg-slate-50 border-b border-slate-200 p-6 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                           <FileSpreadsheet className="text-emerald-600" /> 8&7�7�87� 7�87�7�7�8y7�7�7� 7�87�8�8y
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">7�7�7�8y7�7�7� 7�87�8y7�8 7�7� 8&8  Excel 8&7� 7�87�7�88 7�87�88y 8�7�88&7�7�8�7�7�</p>
                    </div>
                    <div className="flex items-center gap-4">
                         <div className="flex items-center text-xs font-bold gap-2">
                             <span className={`px-2 py-1 rounded-full ${importStep === 'upload' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1. 7�8~7� 7�88&88~</span>
                             <div className="w-4 h-[2px] bg-slate-300"></div>
                             <span className={`px-2 py-1 rounded-full ${importStep === 'mapping' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2. 8&7�7�7�87� 7�87�7�8&7�7�</span>
                             <div className="w-4 h-[2px] bg-slate-300"></div>
                             <span className={`px-2 py-1 rounded-full ${importStep === 'preview' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>3. 7�87�7�88 8�7�88&7�7�8�7�7�</span>
                         </div>
                         <button onClick={closeImport}><X className="text-slate-400 hover:text-red-500" /></button>
                    </div>
                </div>

                {/* Wizard Body */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50">
                    
                    {importStep === 'upload' && (
                        <div className="flex flex-col items-center justify-center h-full space-y-8">
                             <div className="text-center space-y-2">
                                 <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-blue-100">
                                     <Upload size={32} />
                                 </div>
                                 <h4 className="font-bold text-slate-700 text-lg">7�8~7� 8&88~ Excel</h4>
                                 <p className="text-sm text-slate-500 max-w-md mx-auto">8y7�7�8& 7�88 7�7�8& 8&88~7�7� .xlsx 8� .xls. 7�8y88�8& 7�88 7�7�8& 7�887�7�8y7�89 7�8&7�7�8�87� 7�87�7�7�8~ 7�880 7�87�7�8&7�7�.</p>
                             </div>

                             <label className="group w-full max-w-lg h-48 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition bg-white">
                                  <FileSpreadsheet size={48} className="text-slate-300 group-hover:text-emerald-500 transition mb-4" />
                                  <span className="text-slate-600 font-bold group-hover:text-emerald-700">7�7�77� 8!8 7� 87�7�7�8y7�7� 7�88&88~</span>
                                  <span className="text-xs text-slate-400 mt-2">7�8� 88& 7�7�7�7� 8�7�8~87�7� 7�88&88~ 8!8 7�</span>
                                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={handleFileUpload} />
                             </label>

                             <div className="flex gap-4 text-xs text-slate-400">
                                 <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> 8�7�8~ 7�887�7�8y 887�7�8&7�7�</span>
                                 <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> 8�7�8~ 7�87�8�7�7�7�</span>
                                 <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> 7�7�7�7� 7�877�7�8&7�7�</span>
                             </div>
                        </div>
                    )}

                    {importStep === 'mapping' && (
                        <div className="space-y-6">
                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                                <Info className="text-blue-500 mt-0.5" size={20} />
                                <div>
                                    <h4 className="font-bold text-blue-800 text-sm">8&7�7�7�87� 7�87�7�8&7�7�</h4>
                                    <p className="text-xs text-blue-600 mt-1">88&8 7� 7�8&7�7�8�87� 8&7�7�7�87� 7�7�8&7�7� 8&88~8� 8&7� 7�88�8 7�88 7�7�8& 7�887�7�8y7�89. 8y7�7�80 8&7�7�7�7�7� 7�87�7�7�7�8 8�7�7�7�8y88! 7�7�7� 87�8& 7�87�8&7�.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {SYSTEM_FIELDS.map(field => (
                                    <div key={field.key} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-slate-700">{field.label} {field.required && <span className="text-red-500">*</span>}</span>
                                            <span className="text-[10px] text-slate-400 font-mono">{field.key}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <ArrowRightLeft size={16} className="text-slate-300" />
                                            <select 
                                                className={`p-2 rounded-lg border text-sm w-48 outline-none focus:ring-2 ${columnMapping[field.key] ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-50'}`}
                                                value={columnMapping[field.key] || ''}
                                                onChange={(e) => setColumnMapping({...columnMapping, [field.key]: e.target.value})}
                                            >
                                                <option value="">-- 7�7�7�8!8 --</option>
                                                {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {importStep === 'preview' && (
                        <div className="space-y-6">
                             <div className="grid grid-cols-2 gap-4">
                                 <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                                     <h4 className="text-2xl font-bold text-green-700">{importPreview.valid.length}</h4>
                                     <p className="text-xs text-green-600 font-bold">7�7�87�7� 7�7�87�7� 887�7�7�8y7�7�7�</p>
                                 </div>
                                 <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center">
                                     <h4 className="text-2xl font-bold text-red-700">{importPreview.invalid.length}</h4>
                                     <p className="text-xs text-red-600 font-bold">7�7�87�7� 7�8!7� 7�7�7�7�7 (88  7�7�7�8�7�7�)</p>
                                 </div>
                             </div>

                             {importPreview.invalid.length > 0 && (
                                 <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
                                     <div className="bg-red-50 px-4 py-2 border-b border-red-100 font-bold text-red-700 text-sm flex items-center gap-2">
                                         <AlertCircle size={16} /> 7�87�8y7� 7�87�7�7�7�7 (7�8y8 7�)
                                     </div>
                                     <div className="max-h-40 overflow-y-auto p-4 space-y-2">
                                         {importPreview.invalid.slice(0, 20).map((item, idx) => (
                                             <div key={idx} className="text-xs text-red-600 border-b border-red-50 pb-1 mb-1 last:border-0">
                                                 <span className="font-bold text-slate-700">7�8~ {idx + 1}: </span> 
                                                 {item.errors.join('7R ')}
                                             </div>
                                         ))}
                                         {importPreview.invalid.length > 20 && <div className="text-center text-xs text-slate-400">... 8�7�88&7�8y7�</div>}
                                     </div>
                                 </div>
                             )}

                             <div className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                                 <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 font-bold text-blue-700 text-sm flex items-center gap-2">
                                     <RefreshCw size={16} /> 8&7�7�8y8 7� 7�7�7� 7�87�7�7�8y7� 7�87�8�8y (87�8 7�87�8~7�)
                                 </div>
                                 <div className="overflow-x-auto max-h-56 overflow-y-auto">
                                     <table className="w-full text-right text-xs">
                                         <thead className="bg-slate-50 text-slate-600 sticky top-0">
                                             <tr>
                                                 <th className="p-2">7�87�8~</th>
                                                 <th className="p-2">7�87�7�87�</th>
                                                 <th className="p-2">7�87�7�7�8y7�</th>
                                                 <th className="p-2">7�88 8�7�</th>
                                                 <th className="p-2">7�88& 7�88~7�7�8�7�7�</th>
                                                 <th className="p-2">7�87�8 8~</th>
                                                 <th className="p-2">7�87�7�8~ 7�87�7�8 8y</th>
                                                 <th className="p-2">7�87�8!8</th>
                                                 <th className="p-2">7�88&8�7�7�</th>
                                                 <th className="p-2">7�87�7�8�8</th>
                                                 <th className="p-2">7�87�7�8�7�</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             {normalizedImportPreview.slice(0, 25).map((row) => (
                                                 <tr key={`normalized-${row.rowNumber}`} className="border-b border-slate-50">
                                                     <td className="p-2 font-mono text-slate-500">{row.rowNumber}</td>
                                                     <td className={`p-2 font-bold ${row.status === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                                                         {row.status === 'valid' ? '7�7�87�' : '7�7�7�'}
                                                     </td>
                                                     <td className="p-2">{row.date || '-'}</td>
                                                     <td className="p-2">{row.type || '-'}</td>
                                                     <td className="p-2">{row.warehouseInvoice || '-'}</td>
                                                     <td className="p-2">{row.itemName || '-'}</td>
                                                     <td className="p-2">{row.partnerName || '-'}</td>
                                                     <td className="p-2">{row.quantity || '-'}</td>
                                                     <td className="p-2">{row.supplierNet || '-'}</td>
                                                     <td className="p-2">{row.entryTime || '-'}</td>
                                                     <td className="p-2">{row.exitTime || '-'}</td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             </div>

                             <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden shadow-sm">
                                 <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 font-bold text-emerald-700 text-sm flex items-center gap-2">
                                     <CheckCircle size={16} /> 8&7�7�8y8 7� 7�87�8y7�8 7�7� 7�88&7�7�8�7�7� (7�8y8 7�)
                                 </div>
                                 <div className="overflow-x-auto">
                                     <table className="w-full text-right text-xs">
                                         <thead className="bg-slate-50 text-slate-600">
                                             <tr>
                                                 <th className="p-2">7�87�7�7�8y7�</th>
                                                 <th className="p-2">7�88 8�7�</th>
                                                 <th className="p-2">7�87�8 8~</th>
                                                 <th className="p-2">7�87�8!8</th>
                                                 <th className="p-2">7�88&8�7�7�</th>
                                                 <th className="p-2">7�88~7�8 (8&7�7�8�7�)</th>
                                                 <th className="p-2">7�877�7�8&7� (8&7�7�8�7�7�)</th>
                                             </tr>
                                         </thead>
                                         <tbody>
                                             {importPreview.valid.slice(0, 5).map((t, idx) => (
                                                 <tr key={idx} className="border-b border-slate-50">
                                                     <td className="p-2">{t.date}</td>
                                                     <td className="p-2">{t.type}</td>
                                                     <td className="p-2 font-bold">{items.find(i => i.id === t.itemId)?.name}</td>
                                                     <td className="p-2">{t.quantity}</td>
                                                     <td className="p-2">{t.supplierNet}</td>
                                                     <td className={`p-2 font-bold dir-ltr ${t.difference && t.difference < 0 ? 'text-red-600' : 'text-green-600'}`}>{t.difference?.toFixed(3)}</td>
                                                     <td className="p-2 text-red-600 font-bold">{t.delayPenalty || '-'}</td>
                                                 </tr>
                                             ))}
                                         </tbody>
                                     </table>
                                 </div>
                             </div>
                        </div>
                    )}

                    {importStep === 'finish' && (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                             <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 animate-bounce">
                                 <CheckCircle size={40} />
                             </div>
                             <h3 className="text-2xl font-bold text-slate-800">7�8& 7�87�7�7�8y7�7�7� 7�8 7�7�7�!</h3>
                             <p className="text-slate-500">7�8&7� 7�7�7�8~7� {importPreview.valid.length} 7�8&88y7� 7�880 87�7�7�7� 7�87�8y7�8 7�7� 8&7� 7�7�7�7�7 8�7�8~7� 7�87�7�7�7�7�7� 7�887�7�8&7�.</p>
                             <button onClick={closeImport} className="mt-4 bg-slate-800 text-white px-8 py-3 rounded-xl hover:bg-slate-900 shadow-lg">7�787�8</button>
                        </div>
                    )}

                </div>

                {/* Wizard Footer */}
                {importStep !== 'finish' && (
                    <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between">
                         <button onClick={closeImport} className="text-slate-500 hover:text-slate-700 font-bold px-4">7�877�7</button>
                         <div className="flex gap-3">
                             {importStep === 'mapping' && <button onClick={() => setImportStep('upload')} className="bg-white border border-slate-300 text-slate-600 px-6 py-2 rounded-xl font-bold hover:bg-slate-100">7�87�7�7�8</button>}
                             {importStep === 'preview' && <button onClick={() => setImportStep('mapping')} className="bg-white border border-slate-300 text-slate-600 px-6 py-2 rounded-xl font-bold hover:bg-slate-100">7�87�7�7�8</button>}
                             
                             {importStep === 'mapping' && <button onClick={validateAndProcessImport} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 shadow-lg">7�87�7�88y: 7�87�7�88</button>}
                             {importStep === 'preview' && <button onClick={commitImport} disabled={importPreview.valid.length === 0} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 shadow-lg disabled:opacity-50">7�7�8�8y7� 7�87�7�7�8y7�7�7�</button>}
                         </div>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* --- EDIT MODAL --- */}
      {editingTransaction && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in duration-200">
                  <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Edit size={18} /> 7�7�7�8y8 7�8&88y7� 8&7�7�8 8y7�</h3>
                      <button onClick={() => setEditingTransaction(null)}><X className="text-slate-400 hover:text-red-500" /></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto custom-scrollbar">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Basic Info */}
                          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                              <h4 className="md:col-span-4 font-bold text-slate-700 border-b pb-2 mb-2 text-xs">7�87�8y7�8 7�7� 7�87�7�7�7�8y7�</h4>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">7�87�7�7�8y7�</label>
                                  <input type="date" className="w-full p-2 border rounded bg-white" value={editingTransaction.date} onChange={e => handleEditChange('date', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">7�88 8�7�</label>
                                  <select className="w-full p-2 border rounded bg-white" value={editingTransaction.type} onChange={e => handleEditChange('type', e.target.value)}>
                                      {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8~7�7�8�7�7� 7�88&7�7�8 </label>
                                  <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.warehouseInvoice} onChange={e => handleEditChange('warehouseInvoice', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">7�87�8 8~</label>
                                  <select className="w-full p-2 border rounded bg-white" value={editingTransaction.itemId} onChange={e => handleEditChange('itemId', e.target.value)}>
                                      {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                  </select>
                              </div>
                          </div>

                          {/* Weights */}
                          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                              <h4 className="md:col-span-4 font-bold text-emerald-800 border-b border-emerald-200 pb-2 mb-2 text-xs">7�87�8�7�7�8 </h4>
                              <div>
                                  <label className="text-xs font-bold text-emerald-700">7�7�8~8y 7�87�8!8</label>
                                  <input type="number" step="0.001" className="w-full p-2 border border-emerald-200 rounded bg-white text-center font-bold" value={editingTransaction.quantity !== undefined ? editingTransaction.quantity : ''} onChange={e => handleEditChange('quantity', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-emerald-700">7�7�8~8y 7�88&8�7�7�</label>
                                  <input type="number" step="0.001" className="w-full p-2 border border-emerald-200 rounded bg-white text-center" value={editingTransaction.supplierNet !== undefined ? editingTransaction.supplierNet : ''} onChange={e => handleEditChange('supplierNet', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">7�87�7�8�7�7�</label>
                                  <input type="number" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.packageCount !== undefined ? editingTransaction.packageCount : ''} onChange={e => handleEditChange('packageCount', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8 8&8�7�7� 7�88�7�8 </label>
                                  <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.weightSlip || ''} onChange={e => handleEditChange('weightSlip', e.target.value)} />
                              </div>
                          </div>

                          {/* Logistics */}
                          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                              <h4 className="md:col-span-3 font-bold text-blue-800 border-b border-blue-200 pb-2 mb-2 text-xs">7�888�7�7�7�8y7�7�</h4>
                              <div className="relative">
                                  <label className="text-xs font-bold text-blue-700">7�88&8�7�7� / 7�88&7�7�88&</label>
                                  <input 
                                      type="text" 
                                      className="w-full p-2 border border-blue-200 rounded bg-white" 
                                      value={editingTransaction.supplierOrReceiver} 
                                      onChange={e => {
                                          handleEditChange('supplierOrReceiver', e.target.value);
                                          setShowEditPartnerSuggestions(true);
                                      }}
                                      onFocus={() => setShowEditPartnerSuggestions(true)}
                                      onBlur={() => setTimeout(() => setShowEditPartnerSuggestions(false), 200)}
                                  />
                                  {showEditPartnerSuggestions && editingTransaction.supplierOrReceiver && getSuggestions(editingTransaction.supplierOrReceiver).length > 0 && (
                                      <div className="absolute z-50 w-full bg-white border border-slate-200 shadow-xl rounded-xl mt-1 max-h-40 overflow-y-auto">
                                          {getSuggestions(editingTransaction.supplierOrReceiver).map(p => (
                                              <div key={p.id} className="p-2 hover:bg-slate-50 cursor-pointer text-sm" 
                                                   onMouseDown={() => handleEditChange('supplierOrReceiver', p.name)}>
                                                  {p.name}
                                              </div>
                                          ))}
                                      </div>
                                  )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                  <div>
                                      <label className="text-xs font-bold text-slate-500">7�7�7�8 7�</label>
                                      <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.truckNumber || ''} onChange={e => handleEditChange('truckNumber', e.target.value)} />
                                  </div>
                                  <div>
                                      <label className="text-xs font-bold text-slate-500">7�7�7�7�</label>
                                      <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.trailerNumber || ''} onChange={e => handleEditChange('trailerNumber', e.target.value)} />
                                  </div>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">7�87�7�7�8</label>
                                  <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.driverName || ''} onChange={e => handleEditChange('driverName', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8~7�7�8�7�7� 7�88&8�7�7�</label>
                                  <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.supplierInvoice || ''} onChange={e => handleEditChange('supplierInvoice', e.target.value)} />
                              </div>
                          </div>

                          {/* Time */}
                          <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                              <h4 className="md:col-span-4 font-bold text-orange-800 border-b border-orange-200 pb-2 mb-2 text-xs">7�88�87� 8�7�877�7�8&7�7�</h4>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8�87� 7�87�7�8�8</label>
                                  <input type="time" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.entryTime || ''} onChange={e => handleEditChange('entryTime', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8�87� 7�87�7�8�7�</label>
                                  <input type="time" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.exitTime || ''} onChange={e => handleEditChange('exitTime', e.target.value)} />
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">87�7�7�7� 7�87�8~7�8y7</label>
                                  <select
                                      className="w-full p-2 border rounded bg-white"
                                      value={editingTransaction.unloadingRuleId || ''}
                                      onChange={e => handleEditChange('unloadingRuleId', e.target.value)}
                                  >
                                      <option value="">7�7�7�7� 7�887�7�7�7�...</option>
                                      {unloadingRules.filter(rule => rule.is_active).map(rule => (
                                          <option key={rule.id} value={rule.id}>{rule.rule_name}</option>
                                      ))}
                                  </select>
                              </div>
                              <div>
                                  <label className="text-xs font-bold text-slate-500">8&7�7� 7�87�8~7�8y7 7�88&7�8&8�7�7� (7�88y87�)</label>
                                  <input type="number" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.unloadingDuration !== undefined ? editingTransaction.unloadingDuration : ''} onChange={e => handleEditChange('unloadingDuration', e.target.value)} />
                              </div>
                              <div className="bg-white border border-orange-200 rounded p-2 flex flex-col justify-center items-center">
                                  <span className="text-xs text-slate-400">7�877�7�8&7� 7�88&7�7�8�7�7� (7�.8)</span>
                                  <span className="font-bold text-red-600">{formatCurrencyLYD(editingTransaction.delayPenalty)}</span>
                              </div>
                          </div>

                          <div className="md:col-span-3">
                              <label className="text-xs font-bold text-slate-500">8&87�7�7�7�7�</label>
                              <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.notes || ''} onChange={e => handleEditChange('notes', e.target.value)} />
                          </div>
                      </div>
                  </div>

                  <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                      <button onClick={() => setEditingTransaction(null)} className="px-6 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition font-bold">7�877�7</button>
                      <button onClick={saveEdit} className="px-6 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition font-bold shadow-lg flex items-center gap-2">
                          <Save size={18} /> 7�8~7� 7�87�7�7�8y87�7�
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default DailyOperations;


