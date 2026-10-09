import apiClient from '@api/client';

export type ReferenceDataPayload = {
  categories: string[];
  units: string[];
};

/**
 * Gate 4.4 — the panel used to count usage from the loaded catalogue, which is
 * capped at 1000 rows. Past that a referenced value looked unreferenced and its
 * Delete button was enabled next to a banner claiming it was unused. The count
 * comes from the database instead, so it is the same number the server deletes
 * against.
 */
export type ReferenceDataUsageCounts = {
  categories: Record<string, number>;
  units: Record<string, number>;
};

const unwrapData = <T,>(payload: any): T => (payload?.data ?? payload) as T;

const normalizePayload = (payload: any): ReferenceDataPayload => ({
  categories: Array.isArray(payload?.categories) ? payload.categories.map((entry: unknown) => String(entry || '').trim()).filter(Boolean) : [],
  units: Array.isArray(payload?.units) ? payload.units.map((entry: unknown) => String(entry || '').trim()).filter(Boolean) : [],
});

const handleApiError = (error: any): Error => {
  const status = error?.response?.status;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'حدث خطأ غير متوقع أثناء حفظ الأقسام ووحدات القياس.';
  const requestUrl = String(error?.config?.url || '');
  const isReferenceRoute = /\/reference-data(?:\/|$)/i.test(requestUrl);
  const isMissingEndpoint = /^Cannot\s+(GET|POST|PUT|PATCH|DELETE)\s+/i.test(String(message));
  const isMissingTable =
    status === 500 &&
    /(reference_data_values|referenceDataValue|does not exist|relation .* does not exist|table .* does not exist)/i.test(String(message));

  if (status === 401) {
    return new Error('خطأ في المصادقة (401): الجلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى.');
  }

  if (status === 403) {
    return new Error('لا تملك صلاحية تعديل الأقسام ووحدات القياس.');
  }

  if (isMissingTable) {
    return new Error('خدمة الأقسام ووحدات القياس مفعلة، لكن جدولها غير موجود بعد. نفّذ Prisma migration بعد النسخ الاحتياطي ثم أعد تشغيل الخادم.');
  }

  if (status === 404 && isReferenceRoute && isMissingEndpoint) {
    return new Error('خدمة الأقسام ووحدات القياس غير مفعلة على الخادم الحالي. أعد تشغيل backend أو انشر آخر التعديلات ثم أعد المحاولة.');
  }

  return new Error(String(message));
};

export const fetchReferenceData = async (): Promise<ReferenceDataPayload> => {
  try {
    const response = await apiClient.get('/reference-data');
    return normalizePayload(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

const normalizeUsageCounts = (payload: any): ReferenceDataUsageCounts => {
  const read = (raw: unknown): Record<string, number> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const normalizedKey = String(key ?? '').trim().toLowerCase();
      const count = Number(value);
      if (!normalizedKey || !Number.isFinite(count) || count <= 0) continue;
      counts[normalizedKey] = count;
    }
    return counts;
  };

  return {
    categories: read(payload?.categories),
    units: read(payload?.units),
  };
};

export const fetchReferenceDataUsageCounts = async (): Promise<ReferenceDataUsageCounts> => {
  try {
    const response = await apiClient.get('/reference-data/usage-counts');
    return normalizeUsageCounts(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const createCategoryInApi = async (value: string): Promise<ReferenceDataPayload> => {
  try {
    const response = await apiClient.post('/reference-data/categories', { value });
    return normalizePayload(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const createUnitInApi = async (value: string): Promise<ReferenceDataPayload> => {
  try {
    const response = await apiClient.post('/reference-data/units', { value });
    return normalizePayload(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const deleteCategoryInApi = async (value: string): Promise<ReferenceDataPayload> => {
  try {
    const response = await apiClient.post('/reference-data/categories/delete', { value });
    return normalizePayload(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};

export const deleteUnitInApi = async (value: string): Promise<ReferenceDataPayload> => {
  try {
    const response = await apiClient.post('/reference-data/units/delete', { value });
    return normalizePayload(unwrapData<any>(response.data));
  } catch (error) {
    throw handleApiError(error);
  }
};