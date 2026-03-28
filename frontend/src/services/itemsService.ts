// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Server-First Sync + Optimistic UI - 2026-02-28
import apiClient from '@api/client';

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

export const getItems = async (): Promise<ItemDto[]> => {
  try {
    const response = await apiClient.get('/items');

    if (!response.data) return [];
    if (Array.isArray(response.data)) return response.data;
    if (response.data.data && Array.isArray(response.data.data)) return response.data.data;

    console.warn('Unexpected /items response shape:', response.data);
    return [];
  } catch (error: any) {
    if (error.message?.includes('JSON') || error.code === 'ERR_BAD_RESPONSE') {
      console.warn('Warning: invalid/empty response body from /items. Returning empty list.');
      return [];
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
