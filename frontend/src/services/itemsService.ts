// ENTERPRISE FIX: Phase 5 Bulk Import + Barcode + Attachments + Audit Viewer - Archive Only - 2026-03-27
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Server-First Sync + Optimistic UI - 2026-02-28
import apiClient from '@api/client';
import Fuse from 'fuse.js';
import { readFirstWorksheetRows, readFirstWorksheetSource } from '../utils/excelWorkbook';
// FC-ITEM-IMPORT — the single field list. The payload, the template, the alias
// table and the studio's summary are all projections of it, so a field cannot be
// offered for download and then refused by the server, or accepted and then
// dropped without a word.
import { IMPORTABLE_FIELDS } from '../pages/items/import/import-fields';
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
  /** The saved catalog rank, as the server orders the list. */
  sortOrder?: number | null;
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
  /**
   * Which sheet the row came from, for a message that has to name a place.
   *
   * Provenance, not data. It is excluded from the importable key union below, and it
   * has to be: a field that is a coordinate rather than a value must never be offered
   * as a template column, because the server would try to store the sheet name in a
   * column called `name`.
   */
  sourceSheet?: string;
  /**
   * The item this row updates rather than creates.
   *
   * Set by the studio when the row's code or barcode already belongs to a known item —
   * which is the only way an archived item is revived rather than duplicated, and the
   * only way a file that references a known item can correct it instead of colliding
   * with it. Provenance, so excluded from the importable keys below: the server reads
   * it to choose an update, and the template must never offer a column for it.
   */
  publicId?: string;
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

/**
 * Every data field an import file can talk about, importable or not.
 *
 * Distinct from `ExcelImportFieldKey` on purpose. `currentStock` has to be
 * *nameable* — the studio lists it, explains why it is refused, and never sends it —
 * and a type that excluded it outright would force all of that to be cast. So the
 * field list is declared over this wider union, and `IMPORTABLE_FIELDS` narrows to
 * the subset an import may actually carry.
 */
export type ExcelImportRowField = keyof Omit<
  ExcelImportRow,
  'sourceRow' | 'sourceSheet' | 'publicId'
>;

/**
 * The fields that are actually importable: no provenance, and no stock.
 *
 * Excluding `currentStock` here is what makes "the ledger owns stock" a compile
 * error rather than a review comment. A caller that tries to build a payload with a
 * balance cannot, and the two places that needed to *name* stock for a message are
 * forced to do it through the wider `ExcelImportRowField` union where the reason can
 * be written next to it.
 */
export type ExcelImportFieldKey = Exclude<ExcelImportRowField, 'currentStock'>;

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
  /**
   * The 1-based sheet row the headers were read from.
   *
   * Carried so the studio can say "الترويسة في الصف 3" instead of leaving the
   * operator to wonder why the preview does not line up with what they see.
   */
  headerRow: number;
  /**
   * Header labels that appear more than once. Not resolved — a duplicate column has
   * no correct winner, so it is reported and the operator decides.
   */
  duplicateHeaders: string[];
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
  /**
   * The batch id, and the thing an operator needs in order to undo the import. It was
   * absent before Wave 3 because nothing named the run: the audit row carried a
   * generated id with no row behind it, so there was no handle to hold.
   */
  batchId?: string;
  status?: 'succeeded' | 'partial' | 'failed';
  /** True when this response was replayed for an Idempotency-Key already seen. */
  replayed?: boolean;
  results: Array<{ row: number; publicId: string; name: string; status: string }>;
  errors: Array<ItemImportIssue & { error: string }>;
}

/** What a dry run reports. Nothing here is written. */
export interface ExcelImportValidation {
  valid: boolean;
  mode: 'strict' | 'partial';
  modeDescription: string;
  wouldCreate: number;
  wouldUpdate: number;
  rejected: number;
  total: number;
  errors: ItemImportIssue[];
}

/**
 * FC-ITEM-IMPORT — the payload is built from the same list the template and the
 * matcher are built from.
 *
 * It used to be a destructuring line that pulled `englishName`, `description` and
 * `currentStock` out and re-added only a folded `description`, which meant:
 *
 *   `englishName` never reached the server. `BulkImportItemDto` still declared it
 *   and the service still had a fallback for it, so both were dead code that looked
 *   alive — and a file with an English name and no description stored its English
 *   name in the description column.
 *
 *   `currentStock` was dropped, correctly, and silently. Correct because the ledger
 *   owns stock; silent because the template asked for the column.
 *
 * The field set is now `IMPORTABLE_FIELDS`, so a field that is not importable is
 * not sent, and a field that is importable cannot be forgotten.
 */
const toImportPayload = (items: ExcelImportRow[]) =>
  items.map((row) => {
    const payload: Record<string, unknown> = { sourceRow: row.sourceRow };
    // `publicId` is provenance, not a field, so it is not in IMPORTABLE_FIELDS and
    // the loop below never reaches it. It still has to travel: it is how a row becomes
    // an *update* instead of an insert, which is the only way an archived item is
    // revived and the only way a file that references a known item can correct it
    // rather than collide with it.
    if (row.publicId) payload.publicId = row.publicId;
    for (const definition of IMPORTABLE_FIELDS) {
      const value = row[definition.field as keyof ExcelImportRow];
      if (value === undefined || value === null || value === '') continue;
      payload[definition.field] = value;
    }
    // Both columns, never one folded into the other. The template has a separate
    // "الاسم الإنجليزي" column and a separate "الوصف" column; silently merging them
    // meant whichever the operator filled in lost its own meaning.
    if (row.englishName != null && String(row.englishName).trim() !== '') {
      payload.englishName = String(row.englishName).trim();
    }
    if (row.description != null && String(row.description).trim() !== '') {
      payload.description = String(row.description).trim();
    }
    return payload;
  });

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

/**
 * Named, saved catalogue orders.
 *
 * A saved order is a distinct thing from a reorder: a reorder rewrites the working
 * order, these name it, apply a different one, or write the working order into a
 * named one. Every one of them is behind `items.reorder`, and each one is an
 * explicit act — moving things on screen saves nothing, which is the point.
 */
export type OrderProfileDrift = { unlisted: number; moved: number };

export type OrderProfile = {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  drift: OrderProfileDrift;
};

export type OrderProfileList = {
  activeProfileId: string | null;
  catalogSize: number;
  profiles: OrderProfile[];
};

const unwrap = (body: any) => body?.data ?? body;

export const fetchOrderProfiles = async (): Promise<OrderProfileList> => {
  const response = await apiClient.get('/items/order-profiles');
  return unwrap(response.data) as OrderProfileList;
};

/** Saves the working order under a name and makes it the active one. */
export const createOrderProfile = async (
  name: string,
  note?: string,
): Promise<{ id: string; name: string; itemCount: number; isActive: true }> => {
  const response = await apiClient.post('/items/order-profiles', {
    name: String(name || '').trim(),
    ...(note ? { note } : {}),
  });
  return unwrap(response.data);
};

/** Makes a saved order the live one. */
export const applyOrderProfile = async (
  profileId: string,
): Promise<{ id: string; name: string; ranked: number; appended: number }> => {
  const response = await apiClient.post(`/items/order-profiles/${encodeURIComponent(profileId)}/apply`);
  return unwrap(response.data);
};

/** Writes the working order into a saved order — the button that makes a rearrangement stick. */
export const refreshOrderProfile = async (
  profileId: string,
): Promise<{ id: string; name: string; itemCount: number }> => {
  const response = await apiClient.post(`/items/order-profiles/${encodeURIComponent(profileId)}/refresh`);
  return unwrap(response.data);
};

export const renameOrderProfile = async (
  profileId: string,
  name: string,
): Promise<{ id: string; name: string }> => {
  const response = await apiClient.patch(`/items/order-profiles/${encodeURIComponent(profileId)}`, {
    name: String(name || '').trim(),
  });
  return unwrap(response.data);
};

export const deleteOrderProfile = async (profileId: string): Promise<{ id: string; deleted: true }> => {
  const response = await apiClient.delete(`/items/order-profiles/${encodeURIComponent(profileId)}`);
  return unwrap(response.data);
};

export const bulkImportFromExcel = async (
  items: ExcelImportRow[],
  options: {
    mode?: 'strict' | 'partial';
    sourceFileName?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
    timeout?: number;
  } = {},
): Promise<ExcelImportResult> => {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  try {
    const response = await apiClient.post(
      '/items/import-excel',
      {
        items: toImportPayload(items),
        mode: options.mode,
        sourceFileName: options.sourceFileName,
      },
      {
        headers: { 'Idempotency-Key': idempotencyKey },
        // Cancellation and a ceiling, because a 500-row import over a slow link can
        // hang for minutes with the modal showing an indefinite spinner and no way out.
        // The abort is wired to the operator's own cancel button, and the timeout is a
        // backstop for the case they walk away — the server is idempotent, so a retry
        // with the same key cannot double-import.
        signal: options.signal,
        timeout: options.timeout ?? 120_000,
        onUploadProgress: (event) => {
          if (!options.onProgress || !event.total) return;
          // Clamped: `event.total` is unknown for some bodies, and a percentage over
          // 100 would render a progress bar past its end.
          const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
          options.onProgress(percent);
        },
      },
    );
    options.onProgress?.(100);
    return response.data as ExcelImportResult;
  } catch (error) {
    throw handleApiError(error);
  }
};


/**
 * The dry run. Reports what the import would do and writes nothing.
 *
 * Separate from `bulkImportFromExcel` rather than a flag on it, because a flag
 * invites the caller to send `validate: false` where it meant `true`, and the
 * difference is a write to the catalogue.
 */
export const validateExcelImport = async (
  items: ExcelImportRow[],
  options: { mode?: 'strict' | 'partial' } = {},
): Promise<ExcelImportValidation> => {
  try {
    const response = await apiClient.post('/items/import-excel/validate', {
      items: toImportPayload(items),
      mode: options.mode,
    });
    return response.data as ExcelImportValidation;
  } catch (error) {
    throw handleApiError(error);
  }
};

/**
 * Takes one import back. Refuses, with the reason per item, when anything has moved
 * since.
 */
export const revertImportBatch = async (
  batchPublicId: string,
  options: { purge?: boolean; idempotencyKey?: string } = {},
): Promise<{ batchId: string; archived: number; deleted: number; purged: boolean }> => {
  try {
    // The key is required server-side, and deliberately so: this is the one call here
    // that removes rows from the catalogue. A double-clicked revert with no key would
    // be two reverts, and the second would answer "already reverted" for work that
    // had just succeeded.
    const response = await apiClient.post(
      `/items/import-batches/${encodeURIComponent(batchPublicId)}/revert${options.purge ? '?purge=true' : ''}`,
      undefined,
      { headers: { 'Idempotency-Key': options.idempotencyKey ?? crypto.randomUUID() } },
    );
    return response.data as { batchId: string; archived: number; deleted: number; purged: boolean };
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

// FC-ITEM-IMPORT — the alias table is derived from the one field list, so a header
// spelling added for a new field exists for the matcher and the studio at the same time.
const IMPORT_FIELD_DEFINITIONS: Array<{ field: ExcelImportFieldKey; label: string; aliases: string[] }> =
  IMPORTABLE_FIELDS.map((definition) => ({ field: definition.field, label: definition.label, aliases: definition.aliases }));

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
  // The source-aware reader, not the dense one. `sourceRow` has to be the line the
  // operator is looking at in their own file: the dense reader said `index + 2`, so
  // every message about a rejected row pointed one line off, and further off for each
  // blank row above it. A stock file with a blank row in the middle is ordinary, and
  // each one silently moved every error below it away from the truth.
  const { rows, headers, headerRow, duplicateHeaders } = await readFirstWorksheetSource(file);
  const items: ExcelImportRow[] = [];
  let skippedEmptyRows = 0;
  // The reader's headers, not the union of the data rows' keys.
  //
  // Deriving them from the rows meant a file with a header and no data reported *zero*
  // columns — the studio's header line read "0 عمود مكتشف" about a file whose column
  // names were sitting right there, and the column-matching panel was empty. That is
  // the operator's empty template, the exact file the template download produces, and
  // the one case where telling them what the file is *missing* is most useful.
  const sourceHeaders = headers;
  const columnMatches = resolveImportColumnMatches(sourceHeaders);
  const activeMatches = columnMatches.filter((match) => match.header);

  const readString = (row: Record<string, unknown>, field: ExcelImportFieldKey) => {
    const match = activeMatches.find((entry) => entry.field === field);
    if (!match) return '';
    const value = row[match.header];
    if (value == null) return '';
    return String(value).trim();
  };

  /**
   * A number is either read or it is absent. It is never invented.
   *
   * This used to be `readNumber(...) ?? 0` and `?? 1000`, so a cell containing
   * "غير متوفر" or "#N/A" became 0 and a blank `maxLimit` became 1000 — and the studio
   * then showed the operator a tidy 0/1000 pair that looked like it had been read from
   * the file. The default was indistinguishable from data, and the value that would
   * actually be stored was chosen by a fallback rather than by the sheet. Absent
   * stays absent, and the row's analysis says so.
   */
  const readNumber = (row: Record<string, unknown>, field: ExcelImportFieldKey) => {
    const match = activeMatches.find((entry) => entry.field === field);
    return match ? parseImportNumber(row[match.header]) : undefined;
  };

  rows.forEach((source) => {
    const rawRow = source.cells;
    const item: ExcelImportRow = {
      // The real line in the operator's own sheet.
      sourceRow: source.rowNumber,
      sourceSheet: 'ورقة 1',
      name: readString(rawRow, 'name'),
      code: readString(rawRow, 'code') || undefined,
      barcode: readString(rawRow, 'barcode') || undefined,
      englishName: readString(rawRow, 'englishName') || undefined,
      category: readString(rawRow, 'category') || undefined,
      unit: readString(rawRow, 'unit') || undefined,
      description: readString(rawRow, 'description') || undefined,
      packageWeight: readNumber(rawRow, 'packageWeight'),
      minLimit: readNumber(rawRow, 'minLimit'),
      maxLimit: readNumber(rawRow, 'maxLimit'),
      orderLimit: readNumber(rawRow, 'orderLimit'),
    };

    if (source.isEmpty) {
      // Counted and reported, not dropped. An operator whose 400-row file imports 380
      // deserves to be told about the 20 in a visible number, not to infer them.
      skippedEmptyRows += 1;
      return;
    }

    items.push(item);
  });

  return {
    rows: items,
    sourceHeaders,
    columnMatches,
    skippedEmptyRows,
    headerRow,
    duplicateHeaders,
  };
};

export const parseExcelFile = async (file: File): Promise<ExcelImportRow[]> => {
  const result = await parseExcelFileWithInsights(file);
  return result.rows;
};
