import React from 'react';
import type { Item, Transaction, OperationType, Partner, SystemSettings, UnloadingRule } from '../../types';

export interface DailyOperationsProps {
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

export interface InventoryDrilldownFilter {
    itemId: string;
    itemName?: string;
    type: OperationType;
    monthKey: string;
}

export const Highlighter: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
    if (!highlight.trim()) return <>{text}</>;

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

export const isExcelTimeFractionNoise = (value?: string) => {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (!trimmed) return false;

    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return false;

    return numeric > 0 && numeric < 1 && /^\d+\.\d+$/.test(trimmed);
};

export type ImportStep = 'upload' | 'mapping' | 'preview' | 'finish';

export type ImportPreviewRow = {
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

export type OperationPrintOrientation = 'portrait' | 'landscape';
export type OperationPrintPaperSize = 'a4' | 'a3' | 'legal';
export type OperationPrintMargins = 'narrow' | 'normal' | 'wide';
export type OperationPrintGrouping = 'none' | 'day' | 'type';
export type OperationPrintTab = 'layout' | 'content' | 'branding';
export type InvoiceSortMode = 'invoice_asc_date_desc' | 'invoice_desc_date_desc' | 'invoice_asc_type_then_date' | 'invoice_asc_partner_then_date';
export type ExcelPaperSizeValue = 5 | 8 | 9;

export interface OperationPrintableRow {
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

export interface OperationPrintConfig {
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

export interface OperationPrintTemplate {
    id: string;
    name: string;
    config: OperationPrintConfig;
    updatedAt: number;
}

export const OPERATION_PRINT_COLUMNS: { key: keyof OperationPrintableRow; label: string }[] = [
    { key: 'invoiceCounter', label: '#' },
    { key: 'date', label: 'التاريخ' },
    { key: 'type', label: 'نوع العملية' },
    { key: 'warehouseInvoice', label: 'فاتورة المخزن' },
    { key: 'supplierInvoice', label: 'فاتورة المورد' },
    { key: 'itemName', label: 'اسم الصنف' },
    { key: 'supplierOrReceiver', label: 'المورد/العميل' },
    { key: 'quantity', label: 'كمية الدخول' },
    { key: 'supplierNet', label: 'صافي المورد' },
    { key: 'difference', label: 'الفرق' },
    { key: 'packageCount', label: 'العدد (عبوات)' },
    { key: 'weightSlip', label: 'رقم نموذج الوزن' },
    { key: 'truckNumber', label: 'رقم الشاحنة' },
    { key: 'trailerNumber', label: 'رقم الجرار/المقطورة' },
    { key: 'driverName', label: 'اسم السائق' },
    { key: 'entryTime', label: 'وقت الدخول' },
    { key: 'exitTime', label: 'وقت الخروج' },
    { key: 'delayPenalty', label: 'غرامة التأخير' },
    { key: 'notes', label: 'الملاحضات' },
];

export const OPERATION_PRINT_DEFAULT_CONFIG: OperationPrintConfig = {
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

export const SYSTEM_FIELDS: { key: string; label: string; required: boolean }[] = [
    { key: 'date', label: 'التاريخ (YYYY-MM-DD)', required: true },
    { key: 'type', label: 'نوع العملية', required: true },
    { key: 'warehouseInvoice', label: 'رقم فاتورة المخزن', required: true },
    { key: 'itemName', label: 'اسم الصنف', required: true },
    { key: 'partnerName', label: 'اسم المورد/العميل', required: true },
    { key: 'quantity', label: 'صافي السهل', required: true },
    { key: 'supplierNet', label: 'صافي المورد', required: false },
    { key: 'packageCount', label: 'عدد العبوات', required: false },
    { key: 'weightSlip', label: 'رقم نموذج الوزن', required: false },
    { key: 'supplierInvoice', label: 'رقم فاتورة المورد', required: false },
    { key: 'truckNumber', label: 'رقم الشاحنة', required: false },
    { key: 'trailerNumber', label: 'رقم الجرار/المقطورة', required: false },
    { key: 'driverName', label: 'اسم السائق', required: false },
    { key: 'entryTime', label: 'وقت الدخول (HH:MM)', required: false },
    { key: 'exitTime', label: 'وقت الخروج (HH:MM)', required: false },
    { key: 'unloadingRuleName', label: 'اسم قاعدة التفريغ', required: false },
    { key: 'notes', label: 'الملاحضات', required: false },
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
        field.key === 'weightSlip' ? 'رقم نموذج الوزن' : '',
        field.key === 'weightSlip' ? 'رقم نموذج' : '',
        field.key === 'weightSlip' ? 'رقم بوليصة الوزن' : '',
        field.key === 'weightSlip' ? 'بوليصة' : '',
        field.key === 'weightSlip' ? 'وزن' : '',
        field.key === 'supplierInvoice' ? 'فاتورة مورد' : '',
        field.key === 'trailerNumber' ? 'رقم الجرار/المقطورة' : '',
        field.key === 'trailerNumber' ? 'الجرار' : '',
        field.key === 'trailerNumber' ? 'المقطورة' : '',
        field.key === 'trailerNumber' ? 'رقم المقورة/الحاوية' : '',
        field.key === 'trailerNumber' ? 'المقورة' : '',
        field.key === 'trailerNumber' ? 'الحاوية' : '',
        field.key === 'notes' ? 'الملاحضات' : '',
        field.key === 'notes' ? 'ملاحات' : '',
        field.key === 'notes' ? 'الملاحظات' : '',
        field.key === 'unloadingRuleName' ? 'قاعدة' : '',
        field.key === 'unloadingRuleName' ? 'تفريغ' : '',
        field.key === 'itemName' ? 'صنف' : '',
        field.key === 'quantity' ? 'صافي السهل' : '',
        field.key === 'quantity' ? 'صافي السهل (الكمية)' : '',
        field.key === 'quantity' ? 'الكمية الفعلية (الكمية)' : '',
        field.key === 'quantity' ? 'كمية' : '',
        field.key === 'quantity' ? 'كمية فعلية' : '',
        field.key === 'supplierNet' ? 'صافي المورد' : '',
        field.key === 'supplierNet' ? 'كمية المورد' : '',
        field.key === 'partnerName' ? 'المورد/العميل' : '',
        field.key === 'partnerName' ? 'اسم المورد' : '',
        field.key === 'partnerName' ? 'اسم العميل' : '',
    ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
};

export const autoMapImportHeaders = (headers: string[]) => {
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

export const detectHeaderRowIndex = (rows: unknown[][]) => {
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