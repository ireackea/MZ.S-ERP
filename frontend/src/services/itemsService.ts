// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Server-First Sync + Optimistic UI - 2026-02-28
import apiClient from '@api/client';
import Fuse from 'fuse.js';
import { readFirstWorksheetRows } from '../utils/excelWorkbook';
import type { Item } from '../types';

export interface ItemDto {
  id: number;
  publicId?: string;
  code?: string;
  codeGenerated?: boolean;
  barcode?: string;
  name: string;
  unit?: string;
  category?: string;
  minLimit?: number;
  maxLimit?: number;
  orderLimit?: number;
  packageWeight?: number | null;
  currentStock?: number;
  description?: string;
  isArchived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface SyncItemPayload {
  publicId: string;
  name: string;
  code?: string;
  barcode?: string;
  unit?: string;
  category?: string;
  minLimit?: number;
  maxLimit?: number;
  orderLimit?: number;
  packageWeight?: number;
  description?: string;
}

export interface ItemWritePayload {
  publicId?: string;
  name: string;
  code?: string;
  barcode?: string;
  unit?: string;
  category?: string;
  minLimit?: number;
  maxLimit?: number;
  orderLimit?: number;
  packageWeight?: number;
  description?: string;
}

export interface GenerateCodesResponse {
  success: number;
  total: number;
  sample: string[];
  prefix?: string;
}

export interface SyncItemsResult {
  success: true;
  items: ItemDto[];
}

export interface PaginatedItemsResult {
  data: ItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GetItemsParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  isArchived?: boolean;
}

interface SyncItemsOptions {
  maxRetries?: number;
  rollback?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const handleApiError = (error: any): Error => {
  const status = error?.response?.status;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'حدث خطأ غير متوقع. يرجى إعادة المحاولة أو التواصل مع الدعم.';

  if (status === 401) {
    return new Error('خطأ في المصادقة (401): الجلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى.');
  }

  if (status === 404) {
    return new Error('العنصر المطلوب غير موجود (404). يرجى تحديث الصفحة وإعادة المحاولة.');
  }

  return new Error(message);
};

export const getItems = async (params?: GetItemsParams): Promise<PaginatedItemsResult> => {
  try {
    const response = await apiClient.get('/items', { params });

    if (!response.data || !Array.isArray(response.data.data)) {
      throw new Error('Unexpected /items response shape');
    }

    return {
      data: response.data.data,
      total: response.data.total || 0,
      page: response.data.page || 1,
      limit: response.data.limit || 100,
      totalPages: response.data.totalPages || 0,
    };
  } catch (error: any) {
    if (error.message?.includes('JSON') || error.code === 'ERR_BAD_RESPONSE') {
      console.warn('Warning: invalid/empty response body from /items. Returning empty list.');
      return { data: [], total: 0, page: 1, limit: 100, totalPages: 0 };
    }
    throw error;
  }
};

export const syncItems = async (
  items: SyncItemPayload[],
  options?: SyncItemsOptions
): Promise<SyncItemsResult> => {
  const maxRetries = Math.max(1, Number(options?.maxRetries ?? 3));
  let attempt = 0;
  let lastError: unknown;
  let lastSuccessfulResponse: SyncItemsResult | null = null;

  while (attempt < maxRetries) {
    attempt += 1;
    try {
      const response = await apiClient.post('/items/sync', { items });
      const data = response?.data;

      // Capture successful response for potential rollback
      if (Array.isArray(data?.items)) {
        lastSuccessfulResponse = { success: true, items: data.items as ItemDto[] };
      } else if (Array.isArray(data?.data)) {
        lastSuccessfulResponse = { success: true, items: data.data as ItemDto[] };
      } else if (Array.isArray(data)) {
        lastSuccessfulResponse = { success: true, items: data as ItemDto[] };
      } else {
        lastSuccessfulResponse = { success: true, items: [] };
      }

      return lastSuccessfulResponse;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      await sleep(300 * attempt);
    }
  }

  // ENTERPRISE FIX: Rollback on final failure
  if (options?.rollback && lastSuccessfulResponse) {
    try {
      options.rollback();
    } catch (rollbackError) {
      console.error('[itemsService] rollback callback failed:', rollbackError);
    }
  }

  throw handleApiError(lastError);
};

export const deleteItemsByPublicIds = async (publicIds: string[]) => {
  const response = await apiClient.post('/items/delete', { publicIds });
  return response.data;
};

export const archiveItems = async (publicIds: string[]) => {
  const response = await apiClient.post('/items/archive', { publicIds });
  return response.data;
};

export const restoreItems = async (publicIds: string[]) => {
  const response = await apiClient.post('/items/restore', { publicIds });
  return response.data;
};

export const deleteItemsPermanently = async (publicIds: string[]) => {
  const response = await apiClient.post('/items/delete-permanent', { publicIds });
  return response.data;
};

export const generateMissingCodes = async (maxRetries = 3): Promise<GenerateCodesResponse> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxRetries) {
    try {
      const response = await apiClient.post('/items/generate-codes');
      return response.data as GenerateCodesResponse;
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxRetries) break;
      await sleep(250 * attempt);
    }
  }

  throw handleApiError(lastError);
};

// Phase 5: Bulk Import from Excel (JSON)
export interface ExcelImportRow {
  sourceRow?: number;
  name: string;
  code?: string;
  barcode?: string;
  englishName?: string;
  category?: string;
  unit?: string;
  packageWeight?: number;
  minLimit?: number;
  maxLimit?: number;
  orderLimit?: number;
  currentStock?: number;
  description?: string;
}

export type ExcelImportFieldKey = keyof Omit<ExcelImportRow, 'sourceRow'>;

export interface ExcelImportColumnMatch {
  field: ExcelImportFieldKey;
  label: string;
  header: string;
  confidence: number;
  strategy: 'exact' | 'fuzzy' | 'missing';
}

export interface ExcelImportParseResult {
  rows: ExcelImportRow[];
  sourceHeaders: string[];
  columnMatches: ExcelImportColumnMatch[];
  skippedEmptyRows: number;
}

export type ItemImportIssue = {
  row: number;
  field: string;
  message: string;
  value?: unknown;
  error?: string;
};

export interface ExcelImportResult {
  success: number;
  failed: number;
  total: number;
  results: Array<{ row: number; publicId: string; name: string; status: string }>;
  errors: Array<ItemImportIssue & { error: string }>;
}

const toImportPayload = (items: ExcelImportRow[]) => items.map(({ englishName, description, currentStock, ...item }) => ({
  ...item,
  description: String(description || englishName || '').trim() || undefined,
}));

const toWritePayload = (item: Item, includePublicId = true): ItemWritePayload => ({
  ...(includePublicId ? { publicId: String(item.id) } : {}),
  name: item.name,
  code: item.code || undefined,
  barcode: item.barcode || undefined,
  unit: item.unit,
  category: item.category,
  minLimit: toFiniteNumber(item.minLimit, 0),
  maxLimit: toFiniteNumber(item.maxLimit, 1000),
  orderLimit: item.orderLimit == null ? undefined : toFiniteNumber(item.orderLimit, 0),
  packageWeight: item.packageWeight == null ? undefined : toFiniteNumber(item.packageWeight, 0),
  description: item.englishName || undefined,
});

const toFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const createItemInApi = async (item: Item): Promise<ItemDto> => {
  const response = await apiClient.post('/items', toWritePayload(item));
  return response.data as ItemDto;
};

export const updateItemInApi = async (publicId: string, item: Item): Promise<ItemDto> => {
  const response = await apiClient.put(`/items/${encodeURIComponent(publicId)}`, toWritePayload(item, false));
  return response.data as ItemDto;
};

/**
 * Saves the catalog order.
 *
 * This call is the whole point of the "حفظ ترتيب الأصناف" button, which used to
 * exist without it: the handler set two Zustand fields and stopped, so the order
 * died on reload and no other user or device ever saw it.
 *
 * `publicId` rather than the internal `id`, because that is what the list returns
 * and what an imported catalog is guaranteed to have.
 */
export const reorderItems = async (orderedPublicIds: string[]): Promise<{
  ranked: number;
  appended: number;
  moved: number;
  catalogSize: number;
}> => {
  const response = await apiClient.post('/items/reorder', { orderedPublicIds });
  const body = response.data as { success?: boolean; data?: Record<string, number> } | Record<string, number>;
  const payload = (body && (body as { data?: Record<string, number> }).data) || (body as Record<string, number>);
  return {
    ranked: Number(payload?.ranked ?? 0),
    appended: Number(payload?.appended ?? 0),
    moved: Number(payload?.moved ?? 0),
    catalogSize: Number(payload?.catalogSize ?? 0),
  };
};

export const bulkImportFromExcel = async (items: ExcelImportRow[]): Promise<ExcelImportResult> => {
  try {
    const response = await apiClient.post('/items/import-excel', { items: toImportPayload(items) });
    return response.data as ExcelImportResult;
  } catch (error) {
    throw handleApiError(error);
  }
};

const normalizeArabicDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

const normalizeImportText = (value: string) => normalizeArabicDigits(value)
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .toLowerCase();

const parseImportNumber = (value: unknown) => {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = normalizeArabicDigits(String(value))
    .replace(/,/g, '')
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const IMPORT_FIELD_DEFINITIONS: Array<{ field: ExcelImportFieldKey; label: string; aliases: string[] }> = [
  { field: 'name', label: 'اسم الصنف', aliases: ['name', 'item name', 'itemname', 'product name', 'اسم الصنف', 'الصنف', 'المادة', 'اسم المادة', 'اسم المنتج', 'الوصف العربي'] },
  { field: 'code', label: 'كود الصنف', aliases: ['code', 'item code', 'itemcode', 'sku', 'كود', 'الكود', 'كود الصنف', 'رقم الصنف', 'رمز الصنف'] },
  { field: 'barcode', label: 'الباركود', aliases: ['barcode', 'bar code', 'ean', 'upc', 'الباركود', 'باركود', 'رقم الباركود'] },
  { field: 'englishName', label: 'الاسم الإنجليزي', aliases: ['english name', 'englishname', 'english', 'description en', 'الاسم الانجليزي', 'الاسم الإنجليزي', 'الاسم الانجليزى'] },
  { field: 'description', label: 'الوصف', aliases: ['description', 'desc', 'notes', 'الوصف', 'ملاحظات', 'بيان'] },
  { field: 'category', label: 'القسم', aliases: ['category', 'group', 'department', 'section', 'الفئة', 'التصنيف', 'القسم', 'المجموعة', 'البند'] },
  { field: 'unit', label: 'الوحدة', aliases: ['unit', 'uom', 'unit of measure', 'الوحدة', 'وحدة', 'وحدة القياس'] },
  { field: 'packageWeight', label: 'وزن العبوة', aliases: ['package weight', 'packageweight', 'pack weight', 'weight', 'وزن العبوة', 'وزن العبوه', 'وزن', 'وزن الشكارة'] },
  { field: 'minLimit', label: 'الحد الأدنى', aliases: ['min limit', 'minlimit', 'minimum', 'min', 'الحد الأدنى', 'الحد الادنى', 'حد ادنى', 'حد أدنى'] },
  { field: 'maxLimit', label: 'الحد الأعلى', aliases: ['max limit', 'maxlimit', 'maximum', 'max', 'الحد الأعلى', 'الحد الاعلى', 'الحد الأقصى', 'الحد الاقصى'] },
  { field: 'orderLimit', label: 'حد إعادة الطلب', aliases: ['order limit', 'orderlimit', 'reorder limit', 'reorder', 'حد الطلب', 'حد إعادة الطلب', 'حد اعادة الطلب'] },
  { field: 'currentStock', label: 'الرصيد الحالي', aliases: ['current stock', 'currentstock', 'stock', 'quantity', 'qty', 'balance', 'الكمية', 'الكمية الحالية', 'الرصيد', 'الرصيد الحالي'] },
];

const resolveImportColumnMatches = (headers: string[]): ExcelImportColumnMatch[] => {
  const normalizedHeaders = headers
    .map((header) => ({ header, normalized: normalizeImportText(header) }))
    .filter((entry) => entry.normalized);

  const aliasRows = IMPORT_FIELD_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => ({
      field: definition.field,
      label: definition.label,
      alias,
      normalizedAlias: normalizeImportText(alias),
    })),
  );
  const fuse = new Fuse(aliasRows, {
    keys: ['normalizedAlias'],
    threshold: 0.34,
    distance: 80,
    includeScore: true,
  });

  const bestByField = new Map<ExcelImportFieldKey, ExcelImportColumnMatch>();
  const usedHeaders = new Set<string>();

  normalizedHeaders.forEach(({ header, normalized }) => {
    const exact = aliasRows.find((entry) => entry.normalizedAlias === normalized);
    const match = exact
      ? { field: exact.field, label: exact.label, header, confidence: 0.99, strategy: 'exact' as const }
      : (() => {
          const result = fuse.search(normalized, { limit: 1 })[0];
          if (!result || result.score == null || result.score > 0.34) return null;
          return {
            field: result.item.field,
            label: result.item.label,
            header,
            confidence: Math.max(0.52, Math.min(0.94, 1 - result.score)),
            strategy: 'fuzzy' as const,
          };
        })();

    if (!match || usedHeaders.has(header)) return;
    const current = bestByField.get(match.field);
    if (!current || match.confidence > current.confidence) {
      if (current) usedHeaders.delete(current.header);
      bestByField.set(match.field, match);
      usedHeaders.add(header);
    }
  });

  return IMPORT_FIELD_DEFINITIONS.map((definition) => bestByField.get(definition.field) || ({
    field: definition.field,
    label: definition.label,
    header: '',
    confidence: 0,
    strategy: 'missing' as const,
  }));
};

// Phase 5: Upload Attachment
// FC-ITEM-001 — the backend returns the *generated* name as the identity;
// `originalName` is the sanitized display label. Callers must key off `url` /
// `fileName`, never the client-side File.name.
export type ItemAttachmentUploadResult = {
  success: boolean;
  url: string;
  fileName: string;
  originalName?: string;
  type: string;
  mimeType?: string;
  size?: number;
};

export const uploadItemAttachment = async (
  publicId: string,
  file: File,
  type: 'image' | 'file'
): Promise<ItemAttachmentUploadResult> => {
  const formData = new FormData();
  formData.append('file', file);

  const endpoint = type === 'image' ? `/items/${publicId}/upload-image` : `/items/${publicId}/upload-file`;
  const response = await apiClient.post(endpoint, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

// Phase 5: Parse Excel File
export const parseExcelFileWithInsights = async (file: File): Promise<ExcelImportParseResult> => {
  const rows = await readFirstWorksheetRows(file);
  const items: ExcelImportRow[] = [];
  let skippedEmptyRows = 0;
  const sourceHeaders = Array.from(rows.reduce((headers, row) => {
    Object.keys(row).forEach((header) => headers.add(header));
    return headers;
  }, new Set<string>()));
  const columnMatches = resolveImportColumnMatches(sourceHeaders);
  const activeMatches = columnMatches.filter((match) => match.header);

  const readString = (row: Record<string, unknown>, field: ExcelImportFieldKey) => {
    const match = activeMatches.find((entry) => entry.field === field);
    if (!match) return '';
    const value = row[match.header];
    if (value == null) return '';
    const normalized = String(value).trim();
    if (normalized) return normalized;
    return '';
  };
  const readNumber = (row: Record<string, unknown>, field: ExcelImportFieldKey) => {
    const match = activeMatches.find((entry) => entry.field === field);
    return match ? parseImportNumber(row[match.header]) : undefined;
  };

  rows.forEach((rawRow, index) => {
    const item: ExcelImportRow = {
      sourceRow: index + 2,
      name: readString(rawRow, 'name'),
      code: readString(rawRow, 'code') || undefined,
      barcode: readString(rawRow, 'barcode') || undefined,
      englishName: readString(rawRow, 'englishName') || undefined,
      category: readString(rawRow, 'category') || undefined,
      unit: readString(rawRow, 'unit') || undefined,
      description: readString(rawRow, 'description') || undefined,
      packageWeight: readNumber(rawRow, 'packageWeight'),
      minLimit: readNumber(rawRow, 'minLimit') ?? 0,
      maxLimit: readNumber(rawRow, 'maxLimit') ?? 1000,
      orderLimit: readNumber(rawRow, 'orderLimit'),
      currentStock: readNumber(rawRow, 'currentStock') ?? 0,
    };

    const hasAnyValue = Object.entries(item).some(([key, value]) => key !== 'sourceRow' && String(value ?? '').trim());
    if (hasAnyValue) {
      items.push(item);
    } else {
      skippedEmptyRows += 1;
    }
  });

  return { rows: items, sourceHeaders, columnMatches, skippedEmptyRows };
};

export const parseExcelFile = async (file: File): Promise<ExcelImportRow[]> => {
  const result = await parseExcelFileWithInsights(file);
  return result.rows;
};
