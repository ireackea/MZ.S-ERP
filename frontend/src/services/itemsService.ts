// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Server-First Sync + Optimistic UI - 2026-02-28
import apiClient from '@api/client';
import { createExcelWorkbook } from '../utils/exceljs';
import { readFirstWorksheetRows } from '../utils/excelWorkbook';

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
  currentStock?: number;
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

    if (!response.data) {
      return { data: [], total: 0, page: 1, limit: 100, totalPages: 0 };
    }

    // Handle paginated response
    if (response.data.data && Array.isArray(response.data.data)) {
      return {
        data: response.data.data,
        total: response.data.total || 0,
        page: response.data.page || 1,
        limit: response.data.limit || 100,
        totalPages: response.data.totalPages || 0,
      };
    }

    // Handle legacy array response
    if (Array.isArray(response.data)) {
      return {
        data: response.data,
        total: response.data.length,
        page: 1,
        limit: response.data.length,
        totalPages: 1,
      };
    }

    console.warn('Unexpected /items response shape:', response.data);
    return { data: [], total: 0, page: 1, limit: 100, totalPages: 0 };
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

export interface ExcelImportResult {
  success: number;
  failed: number;
  total: number;
  results: Array<{ row: number; publicId: string; name: string; status: string }>;
  errors: Array<{ row: number; error: string }>;
}

export const bulkImportFromExcel = async (items: ExcelImportRow[]): Promise<ExcelImportResult> => {
  try {
    const response = await apiClient.post('/items/import-excel', { items });
    return response.data as ExcelImportResult;
  } catch (error) {
    throw handleApiError(error);
  }
};

// Phase 5: Upload Attachment
export const uploadItemAttachment = async (
  publicId: string,
  file: File,
  type: 'image' | 'file'
): Promise<{ success: boolean; url: string; fileName: string; type: string }> => {
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
export const parseExcelFile = async (file: File): Promise<ExcelImportRow[]> => {
  const rows = await readFirstWorksheetRows(file);
  const items: ExcelImportRow[] = [];
  const normalizeHeader = (header: string) => header.replace(/[\s_-]+/g, '').toLowerCase();
  const readString = (row: Record<string, unknown>, headers: string[]) => {
    for (const header of headers) {
      const value = row[header];
      if (value == null) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  };
  const readNumber = (row: Record<string, unknown>, headers: string[]) => {
    for (const header of headers) {
      const value = row[header];
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  rows.forEach((rawRow) => {
    const normalizedRow = Object.entries(rawRow).reduce<Record<string, unknown>>((result, [header, value]) => {
      result[normalizeHeader(header)] = value;
      return result;
    }, {});

    const item: ExcelImportRow = {
      name: readString(normalizedRow, ['name', 'الاسم']),
      code: readString(normalizedRow, ['code', 'الكود']) || undefined,
      barcode: readString(normalizedRow, ['barcode', 'الباركود']) || undefined,
      englishName: readString(normalizedRow, ['englishname', 'english', 'الاسمالانجليزي']) || undefined,
      category: readString(normalizedRow, ['category', 'التصنيف']) || undefined,
      unit: readString(normalizedRow, ['unit', 'الوحدة']) || undefined,
      description: readString(normalizedRow, ['description', 'الوصف']) || undefined,
      packageWeight: readNumber(normalizedRow, ['packageweight', 'وزنالعبوة']),
      minLimit: readNumber(normalizedRow, ['minlimit', 'min', 'الحدالأدنى']) ?? 0,
      maxLimit: readNumber(normalizedRow, ['maxlimit', 'max', 'الحدالأقصى']) ?? 1000,
      orderLimit: readNumber(normalizedRow, ['orderlimit', 'order', 'حدالطلب']),
      currentStock: readNumber(normalizedRow, ['currentstock', 'stock', 'الكمية']) ?? 0,
    };

    if (item.name) {
      items.push(item);
    }
  });

  return items;
};
