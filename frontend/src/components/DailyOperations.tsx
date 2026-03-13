// ENTERPRISE FIX: Phase 6.4 - Absolute Final Cleanup & 100% Verification - 2026-03-13

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Item, Transaction, OperationType, Partner, SystemSettings, UnloadingRule, GridColumnPreference } from '../types';
import { OPERATION_TYPES } from '../constants';
import UniversalColumnManager from './UniversalColumnManager';
import { getGridModuleDefinition } from '../services/gridModules';
import {
    Trash2, Save, Download, Upload,
    FileSpreadsheet, Truck, Clock, Scale,
    User, Calendar, AlertTriangle, ArrowRightLeft,
    ShieldCheck, Edit, X, FileText, Hash, Info,
    CheckCircle, Settings, FileUp, Database, RefreshCw, AlertCircle,
    Plus, Layers, Receipt, Calculator, PlayCircle, Search, Loader2, Printer
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import Fuse from 'fuse.js';
import { toast } from '@services/toastService';
import { useInventoryStore } from '../store/useInventoryStore';

interface DailyOperationsProps {
    items?: Item[];
    transactions?: Transaction[];
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
type ExcelPaperSizeValue = 5 | 8 | 9;

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

const OPERATION_PRINT_COLUMNS: { key: keyof OperationPrintableRow; label: string }[] = [
    { key: 'invoiceCounter', label: '#' },
    { key: 'date', label: 'التاريخ' },
    { key: 'type', label: 'نوع العملية' },
    { key: 'warehouseInvoice', label: 'فاتورة المخزن' },
    { key: 'supplierInvoice', label: 'فاتورة المورد' },
    { key: 'itemName', label: 'اسم الصنف' },
    { key: 'supplierOrReceiver', label: 'المورد/العميل' },
    { key: 'quantity', label: 'كمية الدخول' },
    { key: 'supplierNet', label: 'كمية المورد' },
    { key: 'difference', label: 'الفرق' },
    { key: 'packageCount', label: 'العدد (عبوات)' },
    { key: 'weightSlip', label: 'بوليصة الوزن' },
    { key: 'truckNumber', label: 'رقم الشاحنة' },
    { key: 'trailerNumber', label: 'رقم المقطورة' },
    { key: 'driverName', label: 'اسم السائق' },
    { key: 'entryTime', label: 'وقت الدخول' },
    { key: 'exitTime', label: 'وقت الخروج' },
    { key: 'delayPenalty', label: 'غرامة التأخير' },
    { key: 'notes', label: 'ملاحظات' },
];

const OPERATION_PRINT_DEFAULT_CONFIG: OperationPrintConfig = {
    reportTitle: 'تقرير سجل العمليات',
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
    selectedColumns: OPERATION_PRINT_COLUMNS.map((column) => column.key as string),
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
    { key: 'date', label: 'التاريخ (YYYY-MM-DD)', required: true },
    { key: 'type', label: 'نوع العملية', required: true },
    { key: 'warehouseInvoice', label: 'رقم فاتورة المخزن', required: true },
    { key: 'itemName', label: 'اسم الصنف', required: true },
    { key: 'partnerName', label: 'اسم المورد/العميل', required: true },

    // Weights
    { key: 'quantity', label: 'الكمية الفعلية (الكمية)', required: true },
    { key: 'supplierNet', label: 'كمية المورد', required: false },
    { key: 'packageCount', label: 'عدد العبوات', required: false },
    { key: 'weightSlip', label: 'رقم بوليصة الوزن', required: false },

    // Logistics
    { key: 'supplierInvoice', label: 'رقم فاتورة المورد', required: false },
    { key: 'truckNumber', label: 'رقم الشاحنة', required: false },
    { key: 'trailerNumber', label: 'رقم المقطورة/الحاوية', required: false },
    { key: 'driverName', label: 'اسم السائق', required: false },

    // Time
    { key: 'entryTime', label: 'وقت الدخول (HH:MM)', required: false },
    { key: 'exitTime', label: 'وقت الخروج (HH:MM)', required: false },
    { key: 'unloadingRuleName', label: 'اسم قاعدة التفريغ', required: false },

    // Other
    { key: 'notes', label: 'ملاحظات', required: false },
];

const getImportSearchTerms = (field: { key: string; label: string }) => {
    return [
        field.label,
        field.key,
        field.key === 'type' ? 'نوع' : '',
        field.key === 'type' ? 'عملية' : '',
        field.key === 'type' ? 'وارد' : '',
        field.key === 'packageCount' ? 'عبوات' : '',
        field.key === 'packageCount' ? 'عدد' : '',
        field.key === 'weightSlip' ? 'بوليصة' : '',
        field.key === 'weightSlip' ? 'وزن' : '',
        field.key === 'supplierInvoice' ? 'فاتورة مورد' : '',
        field.key === 'trailerNumber' ? 'المقطورة' : '',
        field.key === 'trailerNumber' ? 'الحاوية' : '',
        field.key === 'unloadingRuleName' ? 'قاعدة' : '',
        field.key === 'unloadingRuleName' ? 'تفريغ' : '',
        field.key === 'itemName' ? 'صنف' : '',
        field.key === 'quantity' ? 'كمية' : '',
        field.key === 'quantity' ? 'كمية فعلية' : '',
        field.key === 'partnerName' ? 'عميل' : '',
        field.key === 'partnerName' ? 'مورد' : '',
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

let xlsxLoader: Promise<typeof import('xlsx')> | null = null;

const loadXlsx = async () => {
    try {
        if (!xlsxLoader) {
            xlsxLoader = import('xlsx');
        }
        return await xlsxLoader;
    } catch (error) {
        xlsxLoader = null;
        throw error;
    }
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
    items: itemsProp,
    transactions: transactionsProp,
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
    const storeItems = useInventoryStore((state) => state.items);
    const storeTransactions = useInventoryStore((state) => state.transactions);
    const loadAll = useInventoryStore((state) => state.loadAll);
    const lastLoadedAt = useInventoryStore((state) => state.lastLoadedAt);
    const storedOperationPrintConfig = useInventoryStore((state) => state.operationPrintConfig);
    const setOperationPrintConfig = useInventoryStore((state) => state.setOperationPrintConfig);
    const storedOperationPrintTemplates = useInventoryStore((state) => state.operationPrintTemplates);
    const setOperationPrintTemplates = useInventoryStore((state) => state.setOperationPrintTemplates);
    const getGridPreferences = useInventoryStore((state) => state.getGridPreferences);
    const setGridPreferences = useInventoryStore((state) => state.setGridPreferences);
    const resetGridPreferences = useInventoryStore((state) => state.resetGridPreferences);
    const exportElementToPdf = useInventoryStore((state) => state.exportElementToPdf);
    const exportRowsToExcel = useInventoryStore((state) => state.exportRowsToExcel);
    const exportSheetsToExcel = useInventoryStore((state) => state.exportSheetsToExcel);
    const items = storeItems.length > 0 ? storeItems : (itemsProp || []);
    const transactions = storeTransactions.length > 0 ? storeTransactions : (transactionsProp || []);

    // --- Constants & Config ---
    const ROWS_COUNT = 5;

    useEffect(() => {
        if (!lastLoadedAt) {
            void loadAll();
        }
    }, [lastLoadedAt, loadAll]);

    const getEmptyForm = (): Partial<Transaction> => ({
        date: new Date().toISOString().split('T')[0],
        type: 'وارد',
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
        type: 'وارد',
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
    const [isQuickExportingExcel, setIsQuickExportingExcel] = useState(false);
    const [isSmartExportingExcel, setIsSmartExportingExcel] = useState(false);
    const [printStatusMessage, setPrintStatusMessage] = useState('');
    const printSheetRef = useRef<HTMLDivElement | null>(null);
    const printPageRef = useRef<HTMLDivElement | null>(printSheetRef.current);
    const hasHydratedPrintConfigRef = useRef(false);
    const hasHydratedPrintTemplatesRef = useRef(false);

    useEffect(() => {
        const statePayload = (location.state as { drilldown?: InventoryDrilldownFilter } | null)?.drilldown;
        if (!statePayload) return;

        setActiveDrilldown(statePayload);
        if (statePayload.itemName) {
            setSearchQuery(statePayload.itemName);
        }
    }, [location.state]);

    useEffect(() => {
        if (hasHydratedPrintConfigRef.current) return;

        const parsed = storedOperationPrintConfig as Partial<OperationPrintConfig> | undefined;
        if (parsed && Object.keys(parsed).length > 0) {
            setPrintConfig(prev => ({
                ...prev,
                ...parsed,
                selectedColumns: Array.isArray(parsed.selectedColumns)
                    ? parsed.selectedColumns.filter((key): key is string => OPERATION_PRINT_COLUMNS.some(column => column.key === key))
                    : prev.selectedColumns,
            }));
        }

        hasHydratedPrintConfigRef.current = true;
    }, [storedOperationPrintConfig]);

    useEffect(() => {
        if (hasHydratedPrintTemplatesRef.current) return;

        if (Array.isArray(storedOperationPrintTemplates) && storedOperationPrintTemplates.length > 0) {
            setPrintTemplates(storedOperationPrintTemplates as unknown as OperationPrintTemplate[]);
        }

        hasHydratedPrintTemplatesRef.current = true;
    }, [storedOperationPrintTemplates]);

    useEffect(() => {
        setOperationPrintConfig(printConfig as unknown as Record<string, unknown>);
    }, [printConfig, setOperationPrintConfig]);

    useEffect(() => {
        setOperationPrintTemplates(printTemplates.map((template) => ({ ...template })));
    }, [printTemplates, setOperationPrintTemplates]);

    const inventoryLogDefaultColumns = useMemo(() => {
        const module = getGridModuleDefinition('inventory_log');
        return module?.columns || [];
    }, []);
    const inventoryBatchDefaultColumns = useMemo(() => {
        const module = getGridModuleDefinition('inventory_batch');
        return module?.columns || [];
    }, []);
    const [historyColumns, setHistoryColumns] = useState<GridColumnPreference[]>(() => getGridPreferences('inventory_log', inventoryLogDefaultColumns));
    const [batchColumns, setBatchColumns] = useState<GridColumnPreference[]>(() => getGridPreferences('inventory_batch', inventoryBatchDefaultColumns));

    useEffect(() => {
        setHistoryColumns(getGridPreferences('inventory_log', inventoryLogDefaultColumns));
    }, [getGridPreferences, inventoryLogDefaultColumns]);

    useEffect(() => {
        setBatchColumns(getGridPreferences('inventory_batch', inventoryBatchDefaultColumns));
    }, [getGridPreferences, inventoryBatchDefaultColumns]);

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
    const [importPreview, setImportPreview] = useState<{ valid: Transaction[], invalid: { row: any, errors: string[] }[] }>({ valid: [], invalid: [] });
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
        return `${value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ل`;
    };

    const resolveExportErrorMessage = (error: unknown, fallback: string) => {
        if (typeof error === 'object' && error !== null) {
            const candidate = (error as { response?: { data?: { message?: string } }; message?: string });
            return candidate.response?.data?.message || candidate.message || fallback;
        }
        return fallback;
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
        if (type !== 'صرف' && type !== 'تالف') return true;

        const item = items.find(i => i.id === itemId);
        if (!item) return true;

        let availableStock = item.currentStock;

        // If we are editing an existing transaction, we need to "undo" its effect on the current stock
        // to determine the base available stock before applying the new quantity.
        if (excludeTxId) {
            const originalTx = transactions.find(t => t.id === excludeTxId);
            if (originalTx && originalTx.itemId === itemId) {
                if (originalTx.type === 'صرف' || originalTx.type === 'تالف') {
                    // It was deducted, so add it back to see what's available
                    availableStock += originalTx.quantity;
                } else if (originalTx.type === 'وارد' || originalTx.type === 'مرتجع') {
                    // It was added, so subtract it. If we are changing from 'Import' to 'Export',
                    // we can't use the imported amount as part of the available stock for the export.
                    availableStock -= originalTx.quantity;
                }
            }
        }

        // Allow small floating point margin errors
        const epsilon = 0.0001;
        if (qty > availableStock + epsilon) {
            toast.error(`خطأ: الكمية لا تكفي!\n\nالصنف: ${item.name}\nالكمية المتاحة: ${availableStock.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${item.unit}\nالكمية المطلوبة: ${qty} ${item.unit}`);
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
                if (value === 'مرتجع') newData.supplierOrReceiver = 'مورد المرتجع';
                else if (value === 'تالف') newData.supplierOrReceiver = 'تالف داخلي';
                else if (prev.type === 'مرتجع' || prev.type === 'تالف') newData.supplierOrReceiver = ''; // Clear only if it was auto-filled
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
            type: 'وارد',
            warehouseInvoice: 'DEMO-' + Math.floor(Math.random() * 1000),
            supplierOrReceiver: 'شركة الاستيراد والتصدير',
            supplierInvoice: 'SUP-9988',
            weightSlip: 'WS-' + Math.floor(Math.random() * 10000), // Demo Weight Slip
            truckNumber: 'ط ر ا 123',
            trailerNumber: '456',
            driverName: 'محمد علي',
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
            toast.error('يرجى إضافة أصناف أولاً لاختبار ميزة الملء التلقائي');
        }
    };

    const saveInvoice = () => {
        // 1. Validate Header
        if (!invoiceHeader.date || !invoiceHeader.warehouseInvoice || !invoiceHeader.supplierOrReceiver) {
            toast.error('يرجى تعبئة الحقول الأساسية لترويسة الفاتورة (التاريخ، الفاتورة، المورد/العميل)');
            return;
        }

        if (!isInvoiceUnique(invoiceHeader.warehouseInvoice, invoiceHeader.type)) {
            toast.error(`رقم الفاتورة ${invoiceHeader.warehouseInvoice} مستخدم مسبقاً لنفس نوع العملية`);
            return;
        }

        const invoiceDateValidation = validateTimeContext(invoiceHeader, 'تاريخ الفاتورة');
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
            toast.error('يرجى إضافة صنف واحد على الأقل مع الكمية');
            return;
        }

        // 3. Check Stock Availability (Aggregated)
        if (invoiceHeader.type === 'صرف' || invoiceHeader.type === 'تالف') {
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
            supplierOrReceiver: prev.type === 'تصنيع' ? 'إنتاج داخلي' : (prev.type === 'تالف' ? 'تالف داخلي' : '') // Keep default if type stays
        }));
        setInvoiceItems([{ id: uuidv4(), itemId: '' }]);
        toast.success('تم حفظ بيانات الفاتورة بنجاح');
    };

    const invoiceTotals = useMemo(() => {
        return invoiceItems.reduce((acc, item) => ({
            qty: acc.qty + (Number(item.quantity) || 0),
            count: acc.count + (item.itemId ? 1 : 0)
        }), { qty: 0, count: 0 });
    }, [invoiceItems]);

    const getPartnerLabel = (type: string) => {
        if (type === 'وارد') return 'المورد';
        if (type === 'صرف') return 'العميل';
        if (type === 'مرتجع') return 'جهة الترجيع';
        if (type === 'تالف') return 'طبيعة التالف / ملاحظات';
        return 'العميل / المورد';
    };

    const validateTimeContext = (
        payload: { entryTime?: string; exitTime?: string; unloadingRuleId?: string },
        contextLabel: string
    ) => {
        if (!payload.entryTime && !payload.exitTime) {
            return { ok: true, actualMinutes: 0 };
        }

        if (!payload.entryTime || !payload.exitTime) {
            toast.error(`يرجى إدخال وقت الدخول ووقت الخروج أولاً (${contextLabel}).`);
            return { ok: false, actualMinutes: 0 };
        }

        if (!payload.unloadingRuleId) {
            toast.error(`يرجى تحديد قاعدة التفريغ بدقة (${contextLabel}).`);
            return { ok: false, actualMinutes: 0 };
        }

        const duration = calculateDurationWithRollover(payload.entryTime, payload.exitTime);
        if (!duration.valid) {
            toast.error(`الفترة الزمنية غير صحيحة (${contextLabel}).`);
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
            if (value === 'تصنيع') form.supplierOrReceiver = 'إنتاج داخلي';
            else if (value === 'تالف') form.supplierOrReceiver = 'تالف داخلي';
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
        if (!form.date) return toast.error('التاريخ مطلوب');
        if (!form.type) return toast.error('نوع العملية مطلوب');
        if (!form.itemId) return toast.error('الصنف مطلوب');
        if (form.quantity === undefined || form.quantity === null) return toast.error('الكمية المدخلة مطلوبة');
        if (!form.warehouseInvoice) return toast.error('رقم فاتورة المخزن مطلوب');
        if (!form.supplierOrReceiver) return toast.error('المورد/العميل مطلوب');

        if (!isInvoiceUnique(form.warehouseInvoice, form.type)) {
            return toast.error(`خطأ: فاتورة المخزن "${form.warehouseInvoice}" مستخدمة لنفس العملية ${form.type}`);
        }

        const rowDateValidation = validateTimeContext(form, `تاريخ السطر ${index + 1}`);
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
            toast.error('يرجى التأكد من تعبئة الحقول الأساسية المطلوبة (*)');
            return;
        }
        if (!isInvoiceUnique(editingTransaction.warehouseInvoice, editingTransaction.type, editingTransaction.id)) {
            toast.error('فاتورة المخزن مستخدمة مسبقاً!');
            return;
        }

        const editDateValidation = validateTimeContext(editingTransaction, 'وقت التعديل');
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
            ? [...transactions].sort((a, b) => b.timestamp - a.timestamp)
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
                itemName: item?.name || 'غير معروف',
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
                item: item?.name || 'غير معروف',
                weights: `الكمية: ${formatNumber(quantity)} | المورد: ${formatNumber(supplierNet)} | الفرق: ${formatNumber(difference)}`,
                logistics: `${partner || '-'}${supplierInvoice ? ` | فاتورة المورد: ${supplierInvoice}` : ''}${truckNumber ? ` | رقم الشاحنة: ${truckNumber}` : ''}${trailerNumber ? ` (${trailerNumber})` : ''}${driverName ? ` | اسم السائق: ${driverName}` : ''}`,
                timeFine: `وقت الدخول: ${entryTime || '-'} | وقت الخروج: ${exitTime || '-'} | غرامة التأخير: ${formatCurrencyLYD(delayPenalty)}`,
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

            if (row.type === 'وارد' || row.type === 'مرتجع') {
                acc.netBalance += row.quantity;
            } else if (row.type === 'صرف' || row.type === 'تالف') {
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
                title: 'كل العمليات',
                rows: sortedRows,
                subtotalNet: sortedRows.reduce((sum, row) => sum + row.quantity, 0),
                subtotalSupplier: sortedRows.reduce((sum, row) => sum + row.supplierNet, 0),
            }];
        }

        const groups = new Map<string, OperationPrintableRow[]>();
        operationRowsForPrint.forEach((row) => {
            const key = printConfig.grouping === 'day' ? row.date : row.type;
            const normalizedKey = key || 'غير محدد';
            const bucket = groups.get(normalizedKey) || [];
            bucket.push(row);
            groups.set(normalizedKey, bucket);
        });

        return Array.from(groups.entries()).map(([key, rows]) => {
            const sortedRows = sortRowsByWarehouseInvoice(rows);
            return {
                id: key,
                title: printConfig.grouping === 'day' ? `يوم: ${key}` : `نوع: ${key}`,
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
            toast.error('يرجى إدخال اسم القالب بدقة.');
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

        setPrintStatusMessage(`تم حفظ قالب الطباعة: ${normalizedName}`);
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
        setPrintStatusMessage(`تم تطبيق قالب: ${template.name}`);
    };

    const deleteSelectedPrintTemplate = () => {
        if (!selectedTemplateId) {
            toast.error('يرجى تحديد قالب بدقة.');
            return;
        }

        const template = printTemplates.find(item => item.id === selectedTemplateId);
        if (!template) return;

        toast.warning(`حذف القالب "${template.name}"؟`, {
            action: {
                label: 'تأكيد الحذف',
                onClick: () => {
                    setPrintTemplates(prev => prev.filter(item => item.id !== selectedTemplateId));
                    setSelectedTemplateId('');
                    setPrintStatusMessage(`تم حذف القالب: ${template.name}`);
                    toast.success('تم حذف القالب بنجاح');
                },
            },
        });
    };

    const buildPdfFromPreview = async () => {
        if (!printPageRef.current) {
            toast.error('لا توجد معاينة لطباعة التقرير.');
            return;
        }
        if (operationRowsForPrint.length === 0) {
            toast.error('لا توجد بيانات مطابقة لطباعة التقرير.');
            return;
        }

        setIsPrintingPdf(true);
        setPrintStatusMessage('جاري إنشاء ملف PDF يرجى الانتظار...');
        try {
            await exportElementToPdf({
                element: printPageRef.current,
                fileName: `operation-log-${new Date().toISOString().slice(0, 10)}.pdf`,
                jsPdfOptions: {
                    unit: 'mm',
                    format: printConfig.paperSize,
                    orientation: printConfig.orientation,
                },
            });

            setPrintStatusMessage('تم تصدير ملف PDF بنجاح.');
        } catch {
            setPrintStatusMessage('فشل تصدير ملف PDF.');
            toast.error('حدث خطأ أثناء تصدير PDF. حاول مجدداً.');
        } finally {
            setIsPrintingPdf(false);
        }
    };

    const quickPrintCurrentFilter = async () => {
        if (operationRowsForPrint.length === 0) {
            toast.error('لا توجد بيانات مطابقة للتصدير إلى Excel.');
            return;
        }

        const selectedColumns = getSelectedPrintColumns();
        if (selectedColumns.length === 0) {
            toast.error('يرجى تحديد عمود واحد على الأقل قبل تصدير التقرير.');
            return;
        }

        setIsQuickExportingExcel(true);
        setPrintStatusMessage('جاري إنشاء ملف Excel وإعداد تنسيق التقرير...');
        try {
            const totalColumns = Math.max(1, selectedColumns.length);
            const summaryCards = [
                { label: 'إجمالي كمية الدخول', value: formatNumber(operationSummary.totalNetWeight) },
                { label: 'إجمالي كمية المورد', value: formatNumber(operationSummary.totalSupplierNet) },
                { label: 'الفرق بين كمية الدخول وكمية المورد', value: formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet) },
                { label: 'عدد الفواتير', value: String(operationSummary.invoiceCount) },
                { label: 'إجمالي غرامات التأخير', value: formatCurrencyLYD(operationSummary.totalDelayPenalty) },
            ];

            const splitAt = Math.max(1, Math.floor(totalColumns / 2));
            const hasRightRegion = splitAt < totalColumns;
            const sheetRows: Array<Array<string | number>> = [
                [printConfig.reportTitle || 'تقرير سجل العمليات'],
                [`تم التصدير في ${new Date().toLocaleString('en-GB')} | عدد العمليات: ${operationSummary.totalCount}`],
                [],
            ];

            for (let index = 0; index < summaryCards.length; index += 2) {
                const leftCard = summaryCards[index];
                const rightCard = summaryCards[index + 1];

                sheetRows.push([
                    leftCard.label,
                    leftCard.value,
                    ...(rightCard && hasRightRegion ? [rightCard.label, rightCard.value] : []),
                ]);
            }

            sheetRows.push([]);

            groupedPrintRows.forEach((group) => {
                if (printConfig.grouping !== 'none') {
                    sheetRows.push([`${group.title} | الإجمالي الفرعي: ${formatNumber(group.subtotalNet)}`]);
                }

                sheetRows.push(selectedColumns.map((column) => column.label));

                group.rows.forEach((row) => {
                    sheetRows.push(selectedColumns.map((column) => getPrintCellValue(row, column.key)));
                });

                sheetRows.push([]);
            });

            const columns = selectedColumns.map((column) => {
                const headerLen = Math.max(6, String(column.label || '').length);
                const maxValueLen = operationRowsForPrint.reduce((maxLen, row) => {
                    const value = String(getPrintCellValue(row, column.key));
                    return Math.max(maxLen, value.length);
                }, headerLen);
                return { wch: Math.min(60, Math.max(12, Math.ceil(maxValueLen * 1.2))) };
            });

            await exportSheetsToExcel({
                fileName: `operation-log-filter-${new Date().toISOString().slice(0, 10)}.xlsx`,
                sheets: [{
                    name: 'سجل العمليات',
                    rows: sheetRows,
                    columns,
                }],
            });

            setPrintStatusMessage('تم تصدير ملف Excel بتنسيق متقدم للتقرير.');
            toast.success('تم تصدير ملف Excel للتقرير الحالي بنجاح.');
        } catch (error) {
            setPrintStatusMessage('فشل تصدير ملف Excel.');
            toast.error(resolveExportErrorMessage(error, 'حدث خطأ أثناء تصدير Excel. حاول مجدداً.'));
        } finally {
            setIsQuickExportingExcel(false);
        }
    };


    // --- SMART IMPORT/EXPORT LOGIC ---

    const handleSmartExport = async () => {
        if (!canExport) {
            toast.error('لا تملك صلاحية تصدير العمليات من النظام.');
            return;
        }
        if (transactions.length === 0) {
            toast.error('لا توجد عمليات متاحة للتصدير إلى Excel.');
            return;
        }
        // Advanced Export: Includes calculated fields and readable names
        const data = transactions.map(t => {
            const item = items.find(i => i.id === t.itemId);
            const unloadingRule = unloadingRules.find(rule => rule.id === t.unloadingRuleId);
            return {
                'كود العملية': t.id,
                'التاريخ': t.date,
                'النوع': t.type,
                'رقم الفاتورة': t.warehouseInvoice,
                'كود الصنف': item?.code || '',
                'اسم الصنف': item?.name || 'غير معروف',
                'كمية الدخول': t.quantity,
                'كمية المورد': t.supplierNet || 0,
                'الفرق': t.difference || 0,
                'عدد العبوات': t.packageCount || 0,
                'بوليصة الوزن': t.weightSlip || '',
                'الوحدة': item?.unit || '',
                'المورد/العميل': t.supplierOrReceiver,
                'فاتورة المورد': t.supplierInvoice || '',
                'رقم الشاحنة': t.truckNumber || '',
                'رقم المقطورة': t.trailerNumber || '',
                'اسم السائق': t.driverName || '',
                'وقت الدخول': t.entryTime || '',
                'وقت الخروج': t.exitTime || '',
                'قاعدة التفريغ': unloadingRule?.rule_name || '',
                'مدة البقاء (دقيقة)': t.delayDuration || 0,
                'غرامة التأخير': t.delayPenalty || 0,
                'ملاحظات': t.notes || ''
            };
        });

        setIsSmartExportingExcel(true);
        try {
            await exportRowsToExcel({
                fileName: `Stock_Movement_Export_${new Date().toISOString().split('T')[0]}.xlsx`,
                sheetName: 'حركة المخزون',
                rows: data,
            });
            onExport?.(data.length);
            toast.success('تم تصدير حركة المخزون إلى Excel بنجاح.');
        } catch (error) {
            toast.error(resolveExportErrorMessage(error, 'تعذر تصدير حركة المخزون إلى Excel. حاول مرة أخرى.'));
        } finally {
            setIsSmartExportingExcel(false);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!canImport) {
            toast.error('لا تملك صلاحية استيراد العمليات.');
            return;
        }
        const file = e.target.files?.[0];
        if (!file) return;

        setImportPreview({ valid: [], invalid: [] });
        setNormalizedImportPreview([]);

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                if (typeof bstr !== 'string' || !bstr.length) {
                    toast.error('تعذر قراءة الملف المرفوع.');
                    return;
                }

                const XLSX = await loadXlsx();
                const wb = XLSX.read(bstr, { type: 'binary' });
                const firstSheetName = wb.SheetNames[0];
                const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
                if (!ws) {
                    toast.error('الملف لا يحتوي على ورقة عمل صالحة للاستيراد.');
                    return;
                }

                const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];
                if (!data.length) {
                    toast.error('الملف لا يحتوي بيانات صالحة للاستيراد.');
                    return;
                }

                const normalizedRows = data
                    .map((row) => (Array.isArray(row) ? row : []))
                    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));

                if (!normalizedRows.length) {
                    toast.error('الملف لا يحتوي بيانات صالحة للاستيراد.');
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
            } catch (error) {
                console.error('[DailyOperations] Failed to lazy-load XLSX import flow:', error);
                toast.error('تعذر تحميل مكتبة الاستيراد أو قراءة الملف. حاول مرة أخرى.');
            }
        };
        reader.onerror = () => {
            toast.error('تعذر قراءة الملف المرفوع.');
        };
        reader.readAsBinaryString(file);
    };

    const normalizeCellText = (raw: unknown) => {
        if (raw === null || raw === undefined) return '';
        return String(raw)
            .replace(/[ظ -ظ©]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
            .replace(/[ظ -ظ©]/g, '.')
            .replace(/[٬]/g, ',')
            .trim();
    };

    const parseFlexibleNumber = (raw: unknown): number | undefined => {
        if (raw === null || raw === undefined || raw === '') return undefined;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;

        const normalized = normalizeCellText(raw)
            .replace(/د.ل|ج.م|ر.س|كجم|kg|KG|د.ل|د.ل.|LYD/gi, '')
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
        if (['1', 'in', 'import', 'وارد', 'مشتريات', 'شراء'].some(s => v.includes(s))) return 'وارد';
        if (['2', 'out', 'export', 'صرف', 'مبيعات', 'بيع'].some(s => v.includes(s))) return 'صرف';
        if (['3', 'prod', 'production', 'تصنيع', 'إنتاج'].some(s => v.includes(s))) return 'تصنيع';
        if (['4', 'waste', 'damaged', 'تالف', 'هالك'].some(s => v.includes(s))) return 'تالف';

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
        const invalidRows: { row: any, errors: string[] }[] = [];
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

            if (!partnerName && type === 'تصنيع') partnerName = 'إنتاج داخلي';
            if (!partnerName && type === 'تالف') partnerName = 'تالف داخلي';

            // Check Required
            if (!date) errors.push('التاريخ غير موجود');
            if (!type) errors.push(`نوع العملية غير معروف: ${rawType}`);
            if (!invoice) errors.push('رقم الفاتورة غير موجود');
            if (!importedItemToken) errors.push('اسم الصنف غير موجود');
            if (!partnerName) errors.push('المورد/العميل غير موجود');
            if (quantity === undefined || Number.isNaN(quantity)) errors.push('الكمية غير صحيحة');

            let unloadingRuleId = '';
            if (unloadingRuleName) {
                const matchedRule = findUnloadingRuleByImportedValue(unloadingRuleName);
                if (!matchedRule) {
                    errors.push(`قاعدة التفريغ غير متطابقة أو غير مفعلة: ${unloadingRuleName}`);
                } else {
                    unloadingRuleId = matchedRule.id;
                }
            }

            if ((entryDateTime || exitDateTimeRaw) && (!entryDateTime || !exitDateTimeRaw)) {
                errors.push('يجب إدخال وقت الدخول ووقت الخروج أولاً');
            }

            if (entryDateTime && exitDateTimeRaw && !unloadingRuleId) {
                errors.push('يجب إدخال قاعدة التفريغ لحساب الغرامة');
            }

            if (entryDateTime && exitDateTimeRaw) {
                const duration = calculateDurationWithRollover(entryDateTime, exitDateTimeRaw);
                if (!duration.valid) {
                    errors.push('الصيغة الزمنية غير صحيحة (HH:MM)');
                }
            }

            // 2. Logic Validation (Relations)
            let itemId = '';
            if (importedItemToken) {
                const item = findItemByImportedValue(importedItemToken);
                if (!item) errors.push(`اسم الصنف غير موجود بالنظام: ${importedItemToken}`);
                else itemId = item.id;
            }

            // 3. Duplicate Invoice Check
            if (invoice && type) {
                const existsInDb = !isInvoiceUnique(String(invoice), type);
                // ALLOW DUPLICATES INSIDE FILE (Multi-line invoices)
                // const existsInFile = invoiceTracker.has(`${type}-${invoice}`);

                if (existsInDb) errors.push(`رقم الفاتورة ${invoice} مستخدم مسبقاً في النظام`);
                // REMOVED CHECK: if (existsInFile) errors.push(`رقم الفاتورة ${invoice} مكرر في نفس الملف`);

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
        setGridPreferences('inventory_log', historyColumns);
        setShowHistoryColumnSettings(false);
    };

    const handleResetHistoryColumns = () => {
        resetGridPreferences('inventory_log', inventoryLogDefaultColumns);
        setHistoryColumns(inventoryLogDefaultColumns);
    };

    const handleSaveBatchColumns = () => {
        setGridPreferences('inventory_batch', batchColumns);
        setShowBatchColumnSettings(false);
    };

    const handleResetBatchColumns = () => {
        resetGridPreferences('inventory_batch', inventoryBatchDefaultColumns);
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
                        <h2 className="font-bold text-xl text-slate-900">{printConfig.reportTitle || 'تقرير سجل العمليات'}</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            تم التصدير في {new Date().toLocaleString('en-GB')} ⬢ عدد العمليات: {operationSummary.totalCount}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="border border-slate-200 rounded-lg p-2">
                            <div className="text-[11px] text-slate-500">إجمالي كمية الدخول</div>
                            <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight)}</div>
                        </div>
                        <div className="border border-slate-200 rounded-lg p-2">
                            <div className="text-[11px] text-slate-500">إجمالي كمية المورد</div>
                            <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalSupplierNet)}</div>
                        </div>
                        <div className="border border-slate-200 rounded-lg p-2">
                            <div className="text-[11px] text-slate-500">الفرق بين كمية الدخول وكمية المورد</div>
                            <div className="font-bold text-slate-800 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet)}</div>
                        </div>
                        <div className="border border-slate-200 rounded-lg p-2">
                            <div className="text-[11px] text-slate-500">عدد الفواتير</div>
                            <div className="font-bold text-slate-800 dir-ltr text-left">{operationSummary.invoiceCount}</div>
                        </div>
                        <div className="border border-slate-200 rounded-lg p-2">
                            <div className="text-[11px] text-slate-500">إجمالي غرامات التأخير</div>
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
                            <div className="text-xs font-bold text-slate-700">توقيع المستلم</div>
                            <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-500">الاسم: __________________________</div>
                        </div>
                        <div className="w-full max-w-[320px] border border-slate-300 rounded-lg p-3 min-h-[128px] flex flex-col justify-between">
                            <div className="text-xs font-bold text-slate-700">توقيع المُسلم</div>
                            <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-500">الاسم: __________________________</div>
                        </div>
                    </div>

                    {(printConfig.generalNote.trim() || printConfig.showQrCode) && (
                        <div className="mt-4 border-t border-slate-200 pt-3 flex items-end justify-between gap-4">
                            <div className="text-xs text-slate-600 whitespace-pre-wrap">
                                {printConfig.generalNote.trim() && (
                                    <>
                                        <div className="font-bold mb-1 text-slate-700">ملاحظات هامة</div>
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
                                    <div className="text-[10px] text-slate-500 mt-1">مسح الرمز للتحقق</div>
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
                        <ArrowRightLeft className="text-emerald-600" /> حركة المخزون اليومية
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">سجل لتتبع حركة المنتجات ومراقبة الاستلام والتسليم مع الغرامات اليومية.</p>
                </div>
                <div className="flex gap-3">
                    <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                        <button onClick={handleSmartExport} disabled={!canExport || isSmartExportingExcel || transactions.length === 0} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-emerald-600 hover:shadow-sm transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed" title={canExport ? 'تصدير Excel' : 'لا تملك صلاحية التصدير'}>
                            {isSmartExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} تصدير Excel
                        </button>
                        <div className="w-[1px] h-6 bg-slate-300"></div>
                        <button onClick={() => { if (canImport) setIsImportOpen(true); else toast.error('لا تملك صلاحية استيراد الملفات.'); }} disabled={!canImport} className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-blue-600 hover:shadow-sm transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed" title={canImport ? 'استيراد إكسل' : 'لا تملك صلاحية استيراد الملفات'}>
                            <FileSpreadsheet size={16} /> استيراد إكسل
                        </button>
                        <div className="w-[1px] h-6 bg-slate-300"></div>
                        <button
                            onClick={() => setShowPrintStudio(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-lg hover:text-indigo-600 hover:shadow-sm transition font-medium text-xs"
                            title="فتح استوديو الطباعة"
                        >
                            <Printer size={16} /> استوديو الطباعة
                        </button>
                        <button
                            onClick={quickPrintCurrentFilter}
                            disabled={isQuickExportingExcel || operationRowsForPrint.length === 0}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            title="تصدير Excel بناءً على الفلاتر الحالية"
                        >
                            {isQuickExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} تصدير Excel
                        </button>
                    </div>
                    <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl text-sm font-bold border border-emerald-100 flex items-center">
                        اليوم: {transactions.filter(t => t.date === new Date().toISOString().split('T')[0]).length}
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
                        <Receipt size={18} /> فاتورة فردية (إنشاء)
                    </button>
                    <button
                        onClick={() => setEntryMode('batch')}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${entryMode === 'batch' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-500/20' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <Layers size={18} /> إدخال متعدد (Batch)
                    </button>
                </div>
            </div>

            {/* --- INVOICE BUILDER MODE --- */}
            {entryMode === 'invoice' && (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden mt-8 animate-in slide-in-from-bottom-2">
                    <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <h3 className="font-bold flex items-center gap-2">
                                <Receipt className="text-emerald-400" /> إنشاء فاتورة فردية
                            </h3>
                            <button
                                onClick={fillDemoInvoice}
                                className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs hover:bg-emerald-600 hover:text-white transition flex items-center gap-1"
                                title="تعبئة الفاتورة ببيانات افتراضية للتجربة"
                            >
                                <PlayCircle size={14} /> تعبئة بيانات تجريبية
                            </button>
                        </div>
                        <div className="text-xs bg-slate-700 px-3 py-1 rounded-full text-slate-300">
                            يتم حفظ العمليات المدخلة تحت رقم فاتورة واحد
                        </div>
                    </div>

                    <div className="p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
                        {/* HEADER SECTION (Left Panel) */}
                        <div className="lg:col-span-1 space-y-4 border-l pl-0 lg:pl-2 border-slate-100">
                            <h4 className="font-bold text-slate-700 border-b pb-2 mb-2 text-sm flex items-center gap-2">
                                <Info size={16} className="text-blue-500" /> بيانات الفاتورة
                            </h4>

                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">نوع العملية</label>
                                    <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                                        value={invoiceHeader.type} onChange={e => handleInvoiceHeaderChange('type', e.target.value)}>
                                        {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">التاريخ</label>
                                    <input type="date" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                                        value={invoiceHeader.date} onChange={e => handleInvoiceHeaderChange('date', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">رقم الفاتورة (رقم المخزن)</label>
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
                                        placeholder="ابحث..."
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
                                    <label className="text-xs font-bold text-slate-500 block mb-1">فاتورة المورد (اختياري)</label>
                                    <input type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                        value={invoiceHeader.supplierInvoice || ''} onChange={e => handleInvoiceHeaderChange('supplierInvoice', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">بوليصة الوزن (اختياري)</label>
                                    <input type="text" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                                        placeholder="رقم البوليصة"
                                        value={invoiceHeader.weightSlip || ''} onChange={e => handleInvoiceHeaderChange('weightSlip', e.target.value)} />
                                </div>
                            </div>

                            <h4 className="font-bold text-slate-700 border-b pb-2 mb-2 mt-6 text-sm flex items-center gap-2">
                                <Truck size={16} className="text-orange-500" /> اللوجستيات (اختياري)
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                                <input type="text" placeholder="رقم الشاحنة" className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                                    value={invoiceHeader.truckNumber || ''} onChange={e => handleInvoiceHeaderChange('truckNumber', e.target.value)} />
                                <input type="text" placeholder="رقم المقطورة" className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                                    value={invoiceHeader.trailerNumber || ''} onChange={e => handleInvoiceHeaderChange('trailerNumber', e.target.value)} />
                                <input type="text" placeholder="اسم السائق" className="col-span-2 p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
                                    value={invoiceHeader.driverName || ''} onChange={e => handleInvoiceHeaderChange('driverName', e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <label className="text-[10px] text-slate-400 block">دخول</label>
                                    <input type="time" className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                                        value={invoiceHeader.entryTime || ''} onChange={e => handleInvoiceHeaderChange('entryTime', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-400 block">خروج</label>
                                    <input type="time" className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                                        value={invoiceHeader.exitTime || ''} onChange={e => handleInvoiceHeaderChange('exitTime', e.target.value)} />
                                </div>
                            </div>
                            <div className="mt-2">
                                <label className="text-[10px] text-slate-400 block mb-1">قاعدة التفريغ</label>
                                <select
                                    className="w-full p-1 bg-slate-50 border border-slate-200 rounded text-xs"
                                    value={invoiceHeader.unloadingRuleId || ''}
                                    onChange={e => handleInvoiceHeaderChange('unloadingRuleId', e.target.value)}
                                >
                                    <option value="">اختر قاعدة...</option>
                                    {unloadingRules.filter(rule => rule.is_active).map(rule => (
                                        <option key={rule.id} value={rule.id}>
                                            {rule.rule_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mt-2 bg-red-50 border border-red-100 rounded-lg p-2">
                                <label className="text-[10px] text-red-700 block mb-1">غرامة التأخير (د.ل)</label>
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
                                    <div className="col-span-4 text-right">الصنف</div>
                                    <div className="col-span-2">الكمية</div>
                                    <div className="col-span-2">كمية المورد</div>
                                    <div className="col-span-1">الفرق</div>
                                    <div className="col-span-2">العدد</div>
                                    <div className="col-span-1">حذف</div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                    {invoiceItems.map((item, idx) => (
                                        <div key={item.id} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-right-2">
                                            <div className="col-span-4">
                                                <select className="w-full p-2 bg-slate-50 border-none rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
                                                    value={item.itemId} onChange={e => handleInvoiceItemChange(item.id, 'itemId', e.target.value)}>
                                                    <option value="">اختر الصنف...</option>
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
                                        <Plus size={18} /> إضافة صنف جديد للفاتورة
                                    </button>
                                </div>

                                {/* SUMMARY FOOTER */}
                                <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
                                    <div className="flex gap-6 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Calculator size={16} className="text-emerald-400" />
                                            <span className="text-slate-400">إجمالي الأصناف:</span>
                                            <span className="font-bold text-xl">{invoiceTotals.count}</span>
                                        </div>
                                        <div className="w-[1px] h-6 bg-slate-600"></div>
                                        <div className="flex items-center gap-2">
                                            <Scale size={16} className="text-emerald-400" />
                                            <span className="text-slate-400">إجمالي الكمية:</span>
                                            <span className="font-bold text-xl">{invoiceTotals.qty.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <button onClick={saveInvoice} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-900/50 flex items-center gap-2 transition transform hover:-translate-y-1">
                                        <Save size={18} /> حفظ الفاتورة بالكامل
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
                            <FileSpreadsheet size={18} className="text-emerald-400" /> إدخال متعدد (Batch Entry)
                        </h3>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowBatchColumnSettings(true)}
                                className="flex items-center gap-2 bg-white/10 border border-white/20 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-white/20"
                                title="تخصيص أعمدة الإدخال المتعدد"
                            >
                                <Settings size={14} /> تخصيص الأعمدة
                            </button>
                            <div className="flex gap-4 text-xs text-slate-300">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span> عادي</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> دخول</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span> خروج</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400"></span> نقل</span>
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
                                                {column.key === 'delayPenalty' && (settings.defaultDelayPenalty || 0) === 0 && <span title="لم يتم تحديد غرامة تأخير افتراضية في الإعدادات"><Info size={12} className="text-slate-400" /></span>}
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
                                                    return <td key={column.key} className="p-1 border-l" style={getBatchColumnStyle(column)}><input type="text" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-emerald-500 outline-none font-mono text-center font-bold" value={form.warehouseInvoice} onChange={e => handleBatchChange(idx, 'warehouseInvoice', e.target.value)} placeholder="الرقم" /></td>;
                                                }

                                                if (column.key === 'supplierOrReceiver') {
                                                    return (
                                                        <td key={column.key} className="p-1 border-l bg-blue-50/10 relative" style={getBatchColumnStyle(column)}>
                                                            <input type="text" className="w-full bg-transparent p-1 rounded focus:bg-white border border-transparent focus:border-blue-500 outline-none" value={form.supplierOrReceiver || ''} onChange={e => handleBatchChange(idx, 'supplierOrReceiver', e.target.value)} onFocus={() => setActiveSuggestionRow(idx)} placeholder={form.type === 'دخول' ? 'جهة التوريد' : form.type === 'خروج' ? 'جهة الصرف' : 'ابحث...'} />
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
                                                                <option value="">اختر...</option>
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
                                                                <option value="">اختر...</option>
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
                                                    return <td key={column.key} className="p-1 border-l sticky left-0 bg-slate-50 shadow-lg text-center" style={getBatchColumnStyle(column)}><button title="حفظ الصف" onClick={() => saveBatchRow(idx)} className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition"><Save size={14} /></button></td>;
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
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings size={18} /> تخصيص عرض الأعمدة - الإدخال المتعدد</h3>
                            <button onClick={() => setShowBatchColumnSettings(false)} className="text-slate-500 hover:text-red-600" title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <UniversalColumnManager
                                columns={batchColumns}
                                onChange={setBatchColumns}
                                onReset={handleResetBatchColumns}
                            />
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                            <button onClick={() => setShowBatchColumnSettings(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">إغلاق</button>
                            <button onClick={handleSaveBatchColumns} className="px-4 py-2 rounded-lg bg-slate-900 text-white">حفظ</button>
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
                                <ShieldCheck size={20} className="text-emerald-600" /> سجل العمليات السابقة
                            </h3>
                            {isSearching && <div className="flex items-center text-xs text-slate-400 gap-1"><Loader2 size={12} className="animate-spin" /> جاري البحث...</div>}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative w-full sm:w-96 group">
                                <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                <input
                                    type="text"
                                    placeholder="بحث ذكي (رقم الفاتورة، اسم الصنف، اسم السائق، رقم الشاحنة...)"
                                    className="w-full pl-4 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>

                            <button
                                onClick={() => setShowHistoryColumnSettings(true)}
                                className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold hover:bg-slate-50"
                                title="تخصيص العرض"
                            >
                                <Settings size={14} /> تخصيص العرض
                            </button>

                            {selectedIds.size > 0 && (
                                <button onClick={() => setDeleteModal({ isOpen: true, ids: Array.from(selectedIds) })} className="flex items-center gap-2 text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 text-xs font-bold hover:bg-red-100 transition">
                                    <Trash2 size={14} /> حذف ({selectedIds.size})
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
                                title="فلترة حسب نوع العملية"
                            >
                                <option value="all">كل أنواع العمليات</option>
                                {OPERATION_TYPES.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>

                            <input
                                type="date"
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationDateFromFilter}
                                onChange={(e) => setOperationDateFromFilter(e.target.value)}
                                title="من تاريخ"
                            />

                            <input
                                type="date"
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationDateToFilter}
                                onChange={(e) => setOperationDateToFilter(e.target.value)}
                                title="إلى تاريخ"
                            />

                            <input
                                type="text"
                                placeholder="المورد/العميل"
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationPartnerFilter}
                                onChange={(e) => setOperationPartnerFilter(e.target.value)}
                                title="فلترة حسب المورد/العميل"
                            />

                            <input
                                type="number"
                                step="0.001"
                                placeholder="الحد الأدنى للكمية"
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationMinQuantityFilter}
                                onChange={(e) => setOperationMinQuantityFilter(e.target.value)}
                                title="الحد الأدنى للكمية"
                            />

                            <input
                                type="number"
                                step="0.001"
                                placeholder="الحد الأقصى للكمية"
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationMaxQuantityFilter}
                                onChange={(e) => setOperationMaxQuantityFilter(e.target.value)}
                                title="الحد الأقصى للكمية"
                            />

                            <select
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={operationPenaltyFilter}
                                onChange={(e) => setOperationPenaltyFilter(e.target.value as 'all' | 'with_penalty' | 'without_penalty')}
                                title="فلترة بغرامة التأخير"
                            >
                                <option value="all">كل الحالات (بغرامة/بدون)</option>
                                <option value="with_penalty">مع غرامة تأخير</option>
                                <option value="without_penalty">بدون غرامة تأخير</option>
                            </select>

                            <select
                                className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
                                value={invoiceSortMode}
                                onChange={(e) => setInvoiceSortMode(e.target.value as InvoiceSortMode)}
                                title="ترتيب الفواتير"
                            >
                                <option value="invoice_asc_date_desc">ترتيب: تصاعدي بالفاتورة + تنازلي بالتاريخ</option>
                                <option value="invoice_desc_date_desc">ترتيب: تنازلي بالفاتورة + تنازلي بالتاريخ</option>
                                <option value="invoice_asc_type_then_date">ترتيب: تصاعدي بالفاتورة + نوع العملية</option>
                                <option value="invoice_asc_partner_then_date">ترتيب: تصاعدي بالفاتورة + المورد</option>
                            </select>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="text-[11px] text-slate-500">
                                عدد العمليات المطابقة: <span className="font-bold text-slate-700">{filteredTransactions.length}</span>
                                {hasAdvancedOperationFilters && <span className="text-emerald-700 font-bold mr-2">⬢ فلاتر متقدمة نشطة</span>}
                            </div>
                            <button
                                onClick={resetOperationAdvancedFilters}
                                disabled={!hasAdvancedOperationFilters}
                                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                إعادة ضبط الفلاتر المتقدمة
                            </button>
                        </div>
                    </div>
                </div>
                {activeDrilldown && (
                    <div className="px-5 py-3 border-b border-blue-100 bg-blue-50 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-800 font-bold">
                        <div>
                            تحليل تفصيلي: {activeDrilldown.itemName || 'الصنف'} / {activeDrilldown.type} / {activeDrilldown.monthKey}
                        </div>
                        <button
                            onClick={() => setActiveDrilldown(null)}
                            className="px-2.5 py-1 rounded border border-blue-300 bg-white hover:bg-blue-100"
                        >
                            الرجوع للوحة الرئيسية
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
                                                title="تحديد/إلغاء تحديد الكل"
                                                aria-label="تحديد/إلغاء تحديد الكل"
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
                                                            فاتورة مجمعة #{invoiceKey} ⬢ عدد العمليات: {groupSummary.count}
                                                        </div>
                                                        <div className="flex items-center gap-3 text-slate-600">
                                                            <span>الكمية: {formatNumber(groupSummary.totalQuantity)}</span>
                                                            <span>كمية المورد: {formatNumber(groupSummary.totalSupplierNet)}</span>
                                                            <span>غرامة التأخير: {formatCurrencyLYD(groupSummary.totalDelayPenalty)}</span>
                                                            <button
                                                                onClick={() => setCollapsedInvoiceGroups((prev) => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(invoiceKey)) next.delete(invoiceKey);
                                                                    else next.add(invoiceKey);
                                                                    return next;
                                                                })}
                                                                className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 font-bold text-[10px]"
                                                                title={isCollapsed ? 'توسيع التفاصيل' : 'طي التفاصيل'}
                                                            >
                                                                {isCollapsed ? 'إظهار التفاصيل' : 'إخفاء التفاصيل'}
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
                                                                <input type="checkbox" title="تحديد العملية" aria-label="تحديد العملية" checked={selectedIds.has(t.id)} onChange={() => { const s = new Set(selectedIds); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); setSelectedIds(s); }} className="rounded border-slate-300 accent-emerald-600" />
                                                            </td>
                                                        );
                                                    }

                                                    if (column.key === 'dateInvoice') {
                                                        return (
                                                            <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                                                <div className="font-bold text-slate-700 dir-ltr text-right">{new Date(t.date).toLocaleDateString('en-GB')}</div>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${t.type === 'دخول' ? 'bg-green-50 text-green-700 border-green-200' :
                                                                        t.type === 'خروج' ? 'bg-red-50 text-red-700 border-red-200' :
                                                                            'bg-blue-50 text-blue-700 border-blue-200'
                                                                        }`}>{t.type}</span>
                                                                    <span className="font-mono text-slate-500 bg-slate-100 px-1 rounded">#<Highlighter text={t.warehouseInvoice} highlight={debouncedQuery} /></span>
                                                                    {rowMeta.isDuplicateInvoice && (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-600">تجميع {rowMeta.groupNo}</span>
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
                                                                    <div className="flex justify-between w-32"><span className="text-slate-500">الكمية:</span> <span className="font-bold">{t.quantity}</span></div>
                                                                    {t.supplierNet && <div className="flex justify-between w-32"><span className="text-slate-500">للمورد:</span> <span>{t.supplierNet}</span></div>}
                                                                    {t.difference !== 0 && <div className={`flex justify-between w-32 pt-1 border-t border-slate-100 ${t.difference && t.difference < 0 ? 'text-red-600' : 'text-green-600'}`}><span>الفرق:</span> <span className="font-bold dir-ltr">{formatNumber(t.difference)}</span></div>}
                                                                    {t.weightSlip && <div className="flex justify-between w-32 text-slate-600"><span>بوليصة الوزن:</span> <span className="font-mono"><Highlighter text={t.weightSlip} highlight={debouncedQuery} /></span></div>}
                                                                </div>
                                                            </td>
                                                        );
                                                    }

                                                    if (column.key === 'logistics') {
                                                        return (
                                                            <td key={column.key} className="p-3 align-top" style={getColumnStyle(column)}>
                                                                <div className="font-bold text-slate-700"><Highlighter text={t.supplierOrReceiver} highlight={debouncedQuery} /></div>
                                                                <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
                                                                    {t.truckNumber && <div><Truck size={10} className="inline ml-1" /><Highlighter text={t.truckNumber} highlight={debouncedQuery} /> {t.trailerNumber && `(${t.trailerNumber})`}</div>}
                                                                    {t.driverName && <div><User size={10} className="inline ml-1" /><Highlighter text={t.driverName} highlight={debouncedQuery} /></div>}
                                                                    {t.supplierInvoice && <div><Receipt size={10} className="inline ml-1" />فاتورة المورد: <Highlighter text={t.supplierInvoice} highlight={debouncedQuery} /></div>}
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
                                                                        <span className="text-slate-400">وقت الدخول:</span>
                                                                        <span className="dir-ltr">{t.entryTime || '-'}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-slate-400">وقت الخروج:</span>
                                                                        <span className="dir-ltr">{t.exitTime || '-'}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-slate-400">قاعدة التفريغ:</span>
                                                                        <span className="font-medium text-slate-600">
                                                                            {t.unloadingRuleId ? (unloadingRules.find(rule => rule.id === t.unloadingRuleId)?.rule_name || t.unloadingRuleId) : '-'}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                <div className="mt-2 pt-1 border-t border-slate-100">
                                                                    {t.delayPenalty ? (
                                                                        <div className="text-red-600 font-bold text-[11px] bg-red-50 border border-red-100 px-2 py-1 rounded w-fit">
                                                                            <AlertTriangle size={10} className="inline ml-1" />غرامة: {formatCurrencyLYD(t.delayPenalty)}
                                                                        </div>
                                                                    ) : <span className="text-green-600 text-[10px] block">لا توجد غرامة تأخير</span>}
                                                                </div>
                                                            </td>
                                                        );
                                                    }

                                                    return (
                                                        <td key={column.key} className="p-3 align-top text-center" style={getColumnStyle(column)}>
                                                            <div className="flex justify-center gap-1">
                                                                <button onClick={() => handleEditClick(t)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded border border-blue-100 transition" title="تعديل"><Edit size={14} /></button>
                                                                <button onClick={() => setDeleteModal({ isOpen: true, ids: [t.id] })} className="p-1.5 text-red-500 hover:bg-red-50 rounded border border-red-100 transition" title="حذف"><Trash2 size={14} /></button>
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
                                    <td colSpan={Math.max(visibleHistoryColumns.length, 1)} className="p-8 text-center text-slate-400">لا توجد عمليات تطابق معايير البحث</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="sticky bottom-0 z-20 bg-slate-900 text-white border-t border-slate-700 px-4 py-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                        <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                            <div className="text-slate-300">إجمالي كمية الصنف</div>
                            <div className="font-bold text-emerald-300 dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight)}</div>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                            <div className="text-slate-300">إجمالي كمية المورد</div>
                            <div className="font-bold text-blue-200 dir-ltr text-left">{formatNumber(operationSummary.totalSupplierNet)}</div>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                            <div className="text-slate-300">الفرق بين كمية الصنف وكمية المورد</div>
                            <div className="font-bold text-white dir-ltr text-left">{formatNumber(operationSummary.totalNetWeight - operationSummary.totalSupplierNet)}</div>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                            <div className="text-slate-300">عدد الفواتير</div>
                            <div className="font-bold text-white dir-ltr text-left">{operationSummary.invoiceCount}</div>
                        </div>
                        <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                            <div className="text-slate-300">إجمالي غرامات التأخير</div>
                            <div className="font-bold text-red-300 dir-ltr text-left">{formatCurrencyLYD(operationSummary.totalDelayPenalty)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {showHistoryColumnSettings && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings size={18} /> تخصيص عرض الأعمدة - سجل العمليات السابقة</h3>
                            <button onClick={() => setShowHistoryColumnSettings(false)} className="text-slate-500 hover:text-red-600" title="إغلاق" aria-label="إغلاق"><X size={18} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <UniversalColumnManager
                                columns={historyColumns}
                                onChange={setHistoryColumns}
                                onReset={handleResetHistoryColumns}
                            />
                        </div>
                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                            <button onClick={() => setShowHistoryColumnSettings(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">إغلاق</button>
                            <button onClick={handleSaveHistoryColumns} className="px-4 py-2 rounded-lg bg-slate-900 text-white">حفظ</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed -left-[200vw] top-0 w-[1200px] min-h-[1400px] pointer-events-none opacity-0" aria-hidden="true">
                {renderOperationPrintSheet()}
            </div>

            {showPrintStudio && (
                <div className="fixed inset-0 z-[99] bg-slate-950/85 backdrop-blur-sm">
                    <div className="h-full w-full bg-slate-100 flex flex-col">
                        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Printer size={18} className="text-indigo-600" /> استوديو الطباعة المتقدمة - سجل العمليات</h3>
                                <p className="text-xs text-slate-500">معاينة للطباعة WYSIWYG مع إمكانية تصدير للـ PDF أو Excel وطباعة QR.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={printTemplateName}
                                    onChange={(e) => setPrintTemplateName(e.target.value)}
                                    placeholder="اسم القالب (مثال: الشحن السريع)"
                                    className="px-3 py-2 border border-slate-300 rounded-lg text-xs min-w-52"
                                />
                                <button onClick={savePrintTemplate} className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg hover:bg-slate-50">حفظ كقالب</button>
                                <select
                                    className="px-3 py-2 border border-slate-300 rounded-lg text-xs"
                                    value={selectedTemplateId}
                                    onChange={(e) => applyPrintTemplate(e.target.value)}
                                >
                                    <option value="">تطبيق قالب محفوظ...</option>
                                    {printTemplates.map((template) => (
                                        <option key={template.id} value={template.id}>{template.name}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={deleteSelectedPrintTemplate}
                                    className="px-3 py-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg hover:bg-red-100"
                                    title="حذف القالب المحدد"
                                >
                                    حذف القالب
                                </button>
                                <button onClick={() => setShowPrintStudio(false)} className="p-2 rounded-lg border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300" title="إغلاق"><X size={16} /></button>
                            </div>
                        </div>

                        <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
                            <div className="col-span-3 border-r border-slate-200 bg-white overflow-y-auto">
                                <div className="p-3 border-b border-slate-200 bg-slate-50 flex gap-2">
                                    <button onClick={() => setActivePrintTab('layout')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'layout' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>التخطيط</button>
                                    <button onClick={() => setActivePrintTab('content')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'content' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>المحتوى</button>
                                    <button onClick={() => setActivePrintTab('branding')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${activePrintTab === 'branding' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>العلامة التجارية</button>
                                </div>

                                <div className="p-4 space-y-4 text-xs">
                                    {activePrintTab === 'layout' && (
                                        <>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">عنوان التقرير المطبوع</label>
                                                <input
                                                    type="text"
                                                    className="w-full p-2 border border-slate-300 rounded-lg"
                                                    placeholder="أدخل عنوان التقرير"
                                                    value={printConfig.reportTitle}
                                                    onChange={(e) => setPrintConfig(prev => ({ ...prev, reportTitle: e.target.value }))}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">اتجاه الصفحة</label>
                                                <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.orientation} onChange={(e) => setPrintConfig(prev => ({ ...prev, orientation: e.target.value as OperationPrintOrientation }))}>
                                                    <option value="portrait">عمودي</option>
                                                    <option value="landscape">أفقي</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">حجم الورق</label>
                                                <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.paperSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, paperSize: e.target.value as OperationPrintPaperSize }))}>
                                                    <option value="a4">A4</option>
                                                    <option value="a3">A3</option>
                                                    <option value="legal">Legal</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">الهوامش</label>
                                                <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.margins} onChange={(e) => setPrintConfig(prev => ({ ...prev, margins: e.target.value as OperationPrintMargins }))}>
                                                    <option value="narrow">ضيقة</option>
                                                    <option value="normal">عادية</option>
                                                    <option value="wide">عريضة</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">حجم الخط ({printConfig.fontSize}px)</label>
                                                <input type="range" min={8} max={14} value={printConfig.fontSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, fontSize: Number(e.target.value) }))} className="w-full" />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">حجم خط الجدول ({printConfig.tableFontSize}px)</label>
                                                <input type="range" min={8} max={16} value={printConfig.tableFontSize} onChange={(e) => setPrintConfig(prev => ({ ...prev, tableFontSize: Number(e.target.value) }))} className="w-full" />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">المسافة المتروكة داخل الخلايا ({printConfig.cellPadding}px)</label>
                                                <input type="range" min={0} max={12} value={printConfig.cellPadding} onChange={(e) => setPrintConfig(prev => ({ ...prev, cellPadding: Number(e.target.value) }))} className="w-full" />
                                                <div className="text-[10px] text-slate-500 mt-1">إذا كانت المسافة المتروكة كبيرة جداً قد تتداخل النصوص.</div>
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">إزاحة النص عمودياً ({printConfig.verticalTextOffset}px)</label>
                                                <input
                                                    type="range"
                                                    min={-6}
                                                    max={6}
                                                    step={1}
                                                    value={printConfig.verticalTextOffset}
                                                    onChange={(e) => setPrintConfig(prev => ({ ...prev, verticalTextOffset: Number(e.target.value) }))}
                                                    className="w-full"
                                                />
                                                <div className="text-[10px] text-slate-500 mt-1">للتحكم بمحاذاة النص داخل الخلية.</div>
                                            </div>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <div>
                                                    <div className="font-bold">مسافة ذكية لعنوان العمود</div>
                                                    <div className="text-[10px] text-slate-500">تترك مسافة إضافية لتوضيح الفرز.</div>
                                                </div>
                                                <input type="checkbox" checked={printConfig.smartCellPadding} onChange={(e) => setPrintConfig(prev => ({ ...prev, smartCellPadding: e.target.checked }))} />
                                            </label>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">ارتفاع الصف ({printConfig.rowHeight}px)</label>
                                                <input type="range" min={10} max={50} value={printConfig.rowHeight} onChange={(e) => setPrintConfig(prev => ({ ...prev, rowHeight: Number(e.target.value) }))} className="w-full" />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">نقطة فاصل الصفحة ({printConfig.pageBreakThresholdPercent}%)</label>
                                                <input type="range" min={70} max={98} value={printConfig.pageBreakThresholdPercent} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageBreakThresholdPercent: Number(e.target.value) }))} className="w-full" />
                                                <div className="text-[10px] text-slate-500 mt-1">يحدد متى يتم نقل الجدول لصفحة جديدة.</div>
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">هامش بداية الصفحة ({printConfig.pageStartMarginMm}mm)</label>
                                                <input type="range" min={0} max={30} value={printConfig.pageStartMarginMm} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageStartMarginMm: Number(e.target.value) }))} className="w-full" />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">هامش نهاية الصفحة ({printConfig.pageEndMarginMm}mm)</label>
                                                <input type="range" min={0} max={30} value={printConfig.pageEndMarginMm} onChange={(e) => setPrintConfig(prev => ({ ...prev, pageEndMarginMm: Number(e.target.value) }))} className="w-full" />
                                            </div>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <div>
                                                    <div className="font-bold">التفاف النص داخل الجدول</div>
                                                    <div className="text-[10px] text-slate-500">يسمح بإظهار النصوص الطويلة.</div>
                                                </div>
                                                <input type="checkbox" checked={printConfig.wrapCellText} onChange={(e) => setPrintConfig(prev => ({ ...prev, wrapCellText: e.target.checked }))} />
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setPrintConfig(prev => ({ ...prev, autoSizeColumns: !prev.autoSizeColumns }))}
                                                className={`w-full px-3 py-2 rounded-lg border font-bold transition ${printConfig.autoSizeColumns ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                                            >
                                                {printConfig.autoSizeColumns ? 'إلغاء الملاءمة التلقائية للأعمدة' : 'ملاءمة تلقائية لعرض الأعمدة بناءً على المحتوى'}
                                            </button>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <span>إظهار حدود الجدول</span>
                                                <input type="checkbox" checked={printConfig.showBorders} onChange={(e) => setPrintConfig(prev => ({ ...prev, showBorders: e.target.checked }))} />
                                            </label>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <span>تباين ألوان الصفوف (Zebra)</span>
                                                <input type="checkbox" checked={printConfig.zebraStriping} onChange={(e) => setPrintConfig(prev => ({ ...prev, zebraStriping: e.target.checked }))} />
                                            </label>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <span>تلوين صف العنوان</span>
                                                <input type="checkbox" checked={printConfig.colorHeaderRow} onChange={(e) => setPrintConfig(prev => ({ ...prev, colorHeaderRow: e.target.checked }))} />
                                            </label>
                                        </>
                                    )}

                                    {activePrintTab === 'content' && (
                                        <>
                                            <div>
                                                <label className="block text-slate-500 mb-2 font-bold">الأعمدة المرئية</label>
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
                                                <label className="block text-slate-500 mb-1 font-bold">تجميع البيانات</label>
                                                <select className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.grouping} onChange={(e) => setPrintConfig(prev => ({ ...prev, grouping: e.target.value as OperationPrintGrouping }))}>
                                                    <option value="none">بدون تجميع</option>
                                                    <option value="day">حسب اليوم</option>
                                                    <option value="type">حسب نوع العملية</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">ترتيب الفواتير</label>
                                                <select className="w-full p-2 border border-slate-300 rounded-lg" value={invoiceSortMode} onChange={(e) => setInvoiceSortMode(e.target.value as InvoiceSortMode)}>
                                                    <option value="invoice_asc_date_desc">تصاعدي بالفاتورة + تنازلي بالتاريخ</option>
                                                    <option value="invoice_desc_date_desc">تنازلي بالفاتورة + تنازلي بالتاريخ</option>
                                                    <option value="invoice_asc_type_then_date">تصاعدي بالفاتورة + نوع العملية</option>
                                                    <option value="invoice_asc_partner_then_date">تصاعدي بالفاتورة + المورد</option>
                                                </select>
                                            </div>

                                        </>
                                    )}

                                    {activePrintTab === 'branding' && (
                                        <>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">نص العلامة المائية</label>
                                                <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" placeholder="مثال: مسودة / معتمدة" value={printConfig.watermarkText} onChange={(e) => setPrintConfig(prev => ({ ...prev, watermarkText: e.target.value }))} />
                                            </div>
                                            <label className="flex items-center justify-between p-2 border border-slate-200 rounded-lg">
                                                <span>تضمين QR رمز التحقق</span>
                                                <input type="checkbox" checked={printConfig.showQrCode} onChange={(e) => setPrintConfig(prev => ({ ...prev, showQrCode: e.target.checked }))} />
                                            </label>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">رابط التقرير للرمز المربع</label>
                                                <input type="text" className="w-full p-2 border border-slate-300 rounded-lg" value={printConfig.reportUrl} onChange={(e) => setPrintConfig(prev => ({ ...prev, reportUrl: e.target.value }))} />
                                            </div>
                                            <div>
                                                <label className="block text-slate-500 mb-1 font-bold">ملاحظة عامة (تظهر أسفل التقرير)</label>
                                                <textarea className="w-full p-2 border border-slate-300 rounded-lg min-h-24" value={printConfig.generalNote} onChange={(e) => setPrintConfig(prev => ({ ...prev, generalNote: e.target.value }))} placeholder="أدخل ملاحظة للطباعة في أسفل الصفحة كتعليق عام لجميع تقارير العمليات" />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="col-span-9 flex flex-col min-h-0">
                                <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center justify-between text-xs">
                                    <div className="text-slate-600">معاينة حية لشكل التقرير (WYSIWYG)</div>
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
                                    <button onClick={() => setShowPrintStudio(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">إغلاق</button>
                                    <button onClick={quickPrintCurrentFilter} disabled={isQuickExportingExcel || operationRowsForPrint.length === 0} className="px-4 py-2 border border-indigo-300 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed">{isQuickExportingExcel ? 'جاري التصدير...' : 'تصدير Excel'}</button>
                                    <button onClick={buildPdfFromPreview} disabled={isPrintingPdf} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">
                                        {isPrintingPdf ? 'جاري التصدير...' : 'طباعة/تصدير للملف الكتروني (PDF)'}
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
                                <h3 className="text-xl font-bold text-red-900">تأكيد الحذف</h3>
                                <p className="text-sm text-red-700 mt-1">هل أنت متأكد من حذف هذه العمليات؟</p>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <p className="text-slate-700 font-medium leading-relaxed">
                                هل أنت على وشك حذف
                                <span className="font-bold text-slate-900 mx-1">{deleteModal.ids.length}</span>
                                عملية من سجل العمليات اليومية.
                                <br /><br />
                                <span className="text-amber-600 text-sm font-bold flex items-center gap-1">
                                    <AlertCircle size={14} />
                                    تحذير: سيتم التراجع عن كميات هذه العمليات من نظام المخزون بشكل تلقائي.
                                </span>
                            </p>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteModal({ isOpen: false, ids: [] })}
                                className="px-6 py-3 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition"
                            >
                                تراجع، إلغاء
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="px-6 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-900/20 flex items-center gap-2"
                            >
                                <Trash2 size={18} /> نعم، حذف
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
                                    <FileSpreadsheet className="text-emerald-600" /> معالج الاستيراد الذكي
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">استيراد العمليات من Excel مع الذكاء الاصطناعي لمطابقة الأعمدة</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center text-xs font-bold gap-2">
                                    <span className={`px-2 py-1 rounded-full ${importStep === 'upload' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1. رفع الملف</span>
                                    <div className="w-4 h-[2px] bg-slate-300"></div>
                                    <span className={`px-2 py-1 rounded-full ${importStep === 'mapping' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2. مطابقة الأعمدة</span>
                                    <div className="w-4 h-[2px] bg-slate-300"></div>
                                    <span className={`px-2 py-1 rounded-full ${importStep === 'preview' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>3. معاينة البيانات</span>
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
                                        <h4 className="font-bold text-slate-700 text-lg">رفع ملف Excel</h4>
                                        <p className="text-sm text-slate-500 max-w-md mx-auto">يدعم النظام ملفات .xlsx و .xls. سيقوم النظام بمطابقة الأعمدة تلقائياً بعد رفع الملف.</p>
                                    </div>

                                    <label className="group w-full max-w-lg h-48 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition bg-white">
                                        <FileSpreadsheet size={48} className="text-slate-300 group-hover:text-emerald-500 transition mb-4" />
                                        <span className="text-slate-600 font-bold group-hover:text-emerald-700">انقر هنا لاختيار الملف</span>
                                        <span className="text-xs text-slate-400 mt-2">أو قم بسحب وإسقاط الملف هنا</span>
                                        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={handleFileUpload} />
                                    </label>

                                    <div className="flex gap-4 text-xs text-slate-400">
                                        <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> ذكاء اصطناعي للأعمدة</span>
                                        <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> فحص الأخطاء</span>
                                        <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> حساب الخصومات</span>
                                    </div>
                                </div>
                            )}

                            {importStep === 'mapping' && (
                                <div className="space-y-6">
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                                        <Info className="text-blue-500 mt-0.5" size={20} />
                                        <div>
                                            <h4 className="font-bold text-blue-800 text-sm">مطابقة الأعمدة</h4>
                                            <p className="text-xs text-blue-600 mt-1">قمنا بمحاولة مطابقة أعمدة ملفك مع حقول النظام تلقائياً. يرجى مراجعة المطابقة وتعديلها إذا لزم الأمر.</p>
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
                                                        onChange={(e) => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                                                    >
                                                        <option value="">-- تجاهل --</option>
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
                                            <p className="text-xs text-green-600 font-bold">صالحة وجاهزة للاستيراد</p>
                                        </div>
                                        <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center">
                                            <h4 className="text-2xl font-bold text-red-700">{importPreview.invalid.length}</h4>
                                            <p className="text-xs text-red-600 font-bold">غير صالحة (لن يتم استيرادها)</p>
                                        </div>
                                    </div>

                                    {importPreview.invalid.length > 0 && (
                                        <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
                                            <div className="bg-red-50 px-4 py-2 border-b border-red-100 font-bold text-red-700 text-sm flex items-center gap-2">
                                                <AlertCircle size={16} /> العمليات الخاطئة (أمثلة)
                                            </div>
                                            <div className="max-h-40 overflow-y-auto p-4 space-y-2">
                                                {importPreview.invalid.slice(0, 20).map((item, idx) => (
                                                    <div key={idx} className="text-xs text-red-600 border-b border-red-50 pb-1 mb-1 last:border-0">
                                                        <span className="font-bold text-slate-700">صف {idx + 1}: </span>
                                                        {item.errors.join('، ')}
                                                    </div>
                                                ))}
                                                {importPreview.invalid.length > 20 && <div className="text-center text-xs text-slate-400">... والمزيد</div>}
                                            </div>
                                        </div>
                                    )}

                                    <div className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                                        <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 font-bold text-blue-700 text-sm flex items-center gap-2">
                                            <RefreshCw size={16} /> معاينة خام للبيانات المستوردة (أول الصفوف)
                                        </div>
                                        <div className="overflow-x-auto max-h-56 overflow-y-auto">
                                            <table className="w-full text-right text-xs">
                                                <thead className="bg-slate-50 text-slate-600 sticky top-0">
                                                    <tr>
                                                        <th className="p-2">الصف</th>
                                                        <th className="p-2">الحالة</th>
                                                        <th className="p-2">التاريخ</th>
                                                        <th className="p-2">النوع</th>
                                                        <th className="p-2">رقم الفاتورة</th>
                                                        <th className="p-2">الصنف</th>
                                                        <th className="p-2">الطرف المعني</th>
                                                        <th className="p-2">الكمية</th>
                                                        <th className="p-2">المورد</th>
                                                        <th className="p-2">وقت الدخول</th>
                                                        <th className="p-2">وقت الخروج</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {normalizedImportPreview.slice(0, 25).map((row) => (
                                                        <tr key={`normalized-${row.rowNumber}`} className="border-b border-slate-50">
                                                            <td className="p-2 font-mono text-slate-500">{row.rowNumber}</td>
                                                            <td className={`p-2 font-bold ${row.status === 'valid' ? 'text-green-600' : 'text-red-600'}`}>
                                                                {row.status === 'valid' ? 'صالح' : 'خطأ'}
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
                                            <CheckCircle size={16} /> معاينة البيانات المعتمدة (أمثلة)
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-right text-xs">
                                                <thead className="bg-slate-50 text-slate-600">
                                                    <tr>
                                                        <th className="p-2">التاريخ</th>
                                                        <th className="p-2">النوع</th>
                                                        <th className="p-2">الصنف</th>
                                                        <th className="p-2">الكمية</th>
                                                        <th className="p-2">المورد</th>
                                                        <th className="p-2">الفرق (معتمد)</th>
                                                        <th className="p-2">الغرامة (معتمدة)</th>
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
                                    <h3 className="text-2xl font-bold text-slate-800">تم الاستيراد بنجاح!</h3>
                                    <p className="text-slate-500">لقد أضفت {importPreview.valid.length} عملية إلى قاعدة البيانات مع حساب الخصومات تلقائياً.</p>
                                    <button onClick={closeImport} className="mt-4 bg-slate-800 text-white px-8 py-3 rounded-xl hover:bg-slate-900 shadow-lg">إغلاق</button>
                                </div>
                            )}

                        </div>

                        {/* Wizard Footer */}
                        {importStep !== 'finish' && (
                            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between">
                                <button onClick={closeImport} className="text-slate-500 hover:text-slate-700 font-bold px-4">إلغاء</button>
                                <div className="flex gap-3">
                                    {importStep === 'mapping' && <button onClick={() => setImportStep('upload')} className="bg-white border border-slate-300 text-slate-600 px-6 py-2 rounded-xl font-bold hover:bg-slate-100">السابق</button>}
                                    {importStep === 'preview' && <button onClick={() => setImportStep('mapping')} className="bg-white border border-slate-300 text-slate-600 px-6 py-2 rounded-xl font-bold hover:bg-slate-100">السابق</button>}

                                    {importStep === 'mapping' && <button onClick={validateAndProcessImport} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 shadow-lg">التالي: معاينة</button>}
                                    {importStep === 'preview' && <button onClick={commitImport} disabled={importPreview.valid.length === 0} className="bg-emerald-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-emerald-700 shadow-lg disabled:opacity-50">تأكيد الاستيراد</button>}
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
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Edit size={18} /> تعديل عملية يدوية</h3>
                            <button onClick={() => setEditingTransaction(null)}><X className="text-slate-400 hover:text-red-500" /></button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Basic Info */}
                                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <h4 className="md:col-span-4 font-bold text-slate-700 border-b pb-2 mb-2 text-xs">البيانات الأساسية</h4>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">التاريخ</label>
                                        <input type="date" className="w-full p-2 border rounded bg-white" value={editingTransaction.date} onChange={e => handleEditChange('date', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">النوع</label>
                                        <select className="w-full p-2 border rounded bg-white" value={editingTransaction.type} onChange={e => handleEditChange('type', e.target.value)}>
                                            {OPERATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">فاتورة المخزن</label>
                                        <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.warehouseInvoice} onChange={e => handleEditChange('warehouseInvoice', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">الصنف</label>
                                        <select className="w-full p-2 border rounded bg-white" value={editingTransaction.itemId} onChange={e => handleEditChange('itemId', e.target.value)}>
                                            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Weights */}
                                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <h4 className="md:col-span-4 font-bold text-emerald-800 border-b border-emerald-200 pb-2 mb-2 text-xs">الأوزان</h4>
                                    <div>
                                        <label className="text-xs font-bold text-emerald-700">إجمالي الكمية</label>
                                        <input type="number" step="0.001" className="w-full p-2 border border-emerald-200 rounded bg-white text-center font-bold" value={editingTransaction.quantity !== undefined ? editingTransaction.quantity : ''} onChange={e => handleEditChange('quantity', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-emerald-700">إجمالي المورد</label>
                                        <input type="number" step="0.001" className="w-full p-2 border border-emerald-200 rounded bg-white text-center" value={editingTransaction.supplierNet !== undefined ? editingTransaction.supplierNet : ''} onChange={e => handleEditChange('supplierNet', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">العبوات</label>
                                        <input type="number" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.packageCount !== undefined ? editingTransaction.packageCount : ''} onChange={e => handleEditChange('packageCount', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">كرت الميزان</label>
                                        <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.weightSlip || ''} onChange={e => handleEditChange('weightSlip', e.target.value)} />
                                    </div>
                                </div>

                                {/* Logistics */}
                                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <h4 className="md:col-span-3 font-bold text-blue-800 border-b border-blue-200 pb-2 mb-2 text-xs">اللوجستيات</h4>
                                    <div className="relative">
                                        <label className="text-xs font-bold text-blue-700">المورد / المستلم</label>
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
                                            <label className="text-xs font-bold text-slate-500">شاحنة</label>
                                            <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.truckNumber || ''} onChange={e => handleEditChange('truckNumber', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500">مقطورة</label>
                                            <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.trailerNumber || ''} onChange={e => handleEditChange('trailerNumber', e.target.value)} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">السائق</label>
                                        <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.driverName || ''} onChange={e => handleEditChange('driverName', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">فاتورة المورد</label>
                                        <input type="text" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.supplierInvoice || ''} onChange={e => handleEditChange('supplierInvoice', e.target.value)} />
                                    </div>
                                </div>

                                {/* Time */}
                                <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <h4 className="md:col-span-4 font-bold text-orange-800 border-b border-orange-200 pb-2 mb-2 text-xs">الوقت وقواعد التفريغ</h4>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">وقت الدخول</label>
                                        <input type="time" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.entryTime || ''} onChange={e => handleEditChange('entryTime', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">وقت الخروج</label>
                                        <input type="time" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.exitTime || ''} onChange={e => handleEditChange('exitTime', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">قاعدة التفريغ</label>
                                        <select
                                            className="w-full p-2 border rounded bg-white"
                                            value={editingTransaction.unloadingRuleId || ''}
                                            onChange={e => handleEditChange('unloadingRuleId', e.target.value)}
                                        >
                                            <option value="">اختر قاعدة...</option>
                                            {unloadingRules.filter(rule => rule.is_active).map(rule => (
                                                <option key={rule.id} value={rule.id}>{rule.rule_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500">مدة التفريغ المتوقعة (دقيقة)</label>
                                        <input type="number" className="w-full p-2 border rounded bg-white text-center" value={editingTransaction.unloadingDuration !== undefined ? editingTransaction.unloadingDuration : ''} onChange={e => handleEditChange('unloadingDuration', e.target.value)} />
                                    </div>
                                    <div className="bg-white border border-orange-200 rounded p-2 flex flex-col justify-center items-center">
                                        <span className="text-xs text-slate-400">غرامة التأخير المعتمدة (د.ل)</span>
                                        <span className="font-bold text-red-600">{formatCurrencyLYD(editingTransaction.delayPenalty)}</span>
                                    </div>
                                </div>

                                <div className="md:col-span-3">
                                    <label className="text-xs font-bold text-slate-500">ملاحظات</label>
                                    <input type="text" className="w-full p-2 border rounded bg-white" value={editingTransaction.notes || ''} onChange={e => handleEditChange('notes', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setEditingTransaction(null)} className="px-6 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition font-bold">إلغاء</button>
                            <button onClick={saveEdit} className="px-6 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition font-bold shadow-lg flex items-center gap-2">
                                <Save size={18} /> حفظ التعديلات
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default DailyOperations;


