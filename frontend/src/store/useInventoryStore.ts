// ENTERPRISE FIX: Phase 4 Audit Logging + Soft Delete Backend + Pagination - Archive Only - 2026-03-27
// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 1 – PostgreSQL Pivot + Zustand Single Source of Truth - 2026-03-13
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 0 - التنظيف الأساسي والتحضير - 2026-03-13
import { create } from 'zustand';
import { toast } from '@services/toastService';
import {
  deleteItemsByPublicIds,
  archiveItems,
  restoreItems,
  deleteItemsPermanently,
  getItems as getItemsFromApi,
  reorderItems,
  applyOrderProfile as applyOrderProfileApi,
  createOrderProfile as createOrderProfileApi,
  deleteOrderProfile as deleteOrderProfileApi,
  fetchOrderProfiles,
  refreshOrderProfile as refreshOrderProfileApi,
  renameOrderProfile as renameOrderProfileApi,
  type OrderProfileList,
  syncItems,
  type ItemDto,
  type SyncItemPayload,
  type PaginatedItemsResult,
} from '@services/itemsService';
import {
  getFinancialYearFromDate,
  getOpeningBalances as getOpeningBalancesFromApi,
} from '@services/openingBalanceService';
import { getTransactionsFromApi } from '@services/transactionsService';
import {
  createUnloadingRuleInApi,
  deleteUnloadingRulesInApi,
  fetchUnloadingRules,
  updateUnloadingRuleInApi,
} from '@services/unloadingRulesService';
import {
  createCategoryInApi,
  createUnitInApi,
  deleteCategoryInApi,
  deleteUnitInApi,
} from '@services/referenceDataService';
import { fetchRoles, fetchUsers, type RoleDto, type UserDto } from '@services/usersService';
import { loadSystemSettingsForm } from '@services/systemSettingsApi';
import apiClient from '@api/client';
import { normalizeUsers } from '../services/iamService';
import {
  getOperationPrintConfig,
  getOperationPrintTemplates,
  getStocktakingPrintConfig,
  getStocktakingPrintTemplates,
  saveOperationPrintConfig,
  saveOperationPrintTemplates,
  saveStocktakingPrintConfig,
  saveStocktakingPrintTemplates,
  getUserGridPreferences,
  upsertGridPreferenceForUser,
  resetGridPreferenceForUser,
} from '../services/storage';
import {
  exportRowsToExcel as exportRowsToExcelFile,
  exportSheetsToExcel as exportSheetsToExcelFile,
} from '../utils/excelWorkbook';
import { saveElementPdfDocument } from '../utils/elementPdf';
import { isInboundOperationType, isOutboundOperationType } from '../utils/operationTypes';
import type {
  Formula,
  GridColumnPreference,
  Item,
  ItemSortMode,
  ReportColumnConfig,
  RoleDefinition,
  SystemSettings,
  Transaction,
  UnloadingRuleDraft,
  UnloadingRule,
  User,
} from '../types';

type SoftMap = Record<string, { deletedAt: number; deletedBy: string }>;
type SortState = { mode: ItemSortMode; manualOrder: string[] };
type ItemForm = { id?: string; name: string; code: string; category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string; currentStock: string };
type BulkForm = { category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string };
type InventoryAction = 'add' | 'remove' | 'update';
type ActorInfo = { id: string; name: string };
type OpeningBalanceMap = Record<string, number>;
type OpeningBalanceRow = { itemId: string; quantity: number };
type GridDisplayPolicy = { forceUnified: boolean };
type GridPreferenceMap = Record<string, GridColumnPreference[]>;
type GridDisplayPolicyMap = Record<string, GridDisplayPolicy>;
type SyncTarget = 'all' | 'items' | 'transactions' | 'openingBalances' | 'users' | 'formulas' | 'unloadingRules';
type LoaderOptions = { force?: boolean; staleMs?: number };
type ExportSheet = {
  name: string;
  rows: unknown[][];
  columns?: Array<{ wch: number }>;
};

type OpeningBalanceApiRow = {
  id?: unknown;
  itemPublicId?: unknown;
  item?: { publicId?: unknown; name?: unknown } | null;
  item_id?: unknown;
  itemId?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  financialYear?: unknown;
};

type FormulaApiItem = {
  itemId?: unknown;
  percentage?: unknown;
  weightPerTon?: unknown;
};

type FormulaApiRow = {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  targetProductId?: unknown;
  targetItemId?: unknown;
  isActive?: unknown;
  notes?: unknown;
  items?: unknown;
};

type OpeningBalanceStoreRow = {
  id: number;
  itemId: string;
  itemPublicId?: string;
  financialYear: number;
  quantity: number;
  unitCost?: number | null;
  item?: { name: string; publicId?: string };
};

type OpeningBalanceSyncResult = {
  openingBalances: OpeningBalanceMap;
  openingBalanceRows: OpeningBalanceStoreRow[];
};

type Store = {
  items: Item[];
  balances: Record<string, number>;
  transactions: Transaction[];
  openingBalances: OpeningBalanceMap;
  openingBalanceRows: OpeningBalanceStoreRow[];
  openingBalancesYear: number | null;
  openingBalancesLoading: boolean;
  openingBalancesError: string | null;
  users: User[];
  roles: RoleDefinition[];
  systemSettings: SystemSettings;
  unloadingRules: UnloadingRule[];
  reportConfig: ReportColumnConfig[];
  openingBalanceReportConfig: ReportColumnConfig[];
  formulas: Formula[];
  units: string[];
  categories: string[];
  gridPreferences: GridPreferenceMap;
  gridDisplayPolicies: GridDisplayPolicyMap;
  operationPrintConfig: Record<string, unknown>;
  operationPrintTemplates: Array<Record<string, unknown>>;
  stocktakingPrintConfig: Record<string, unknown>;
  stocktakingPrintTemplates: Array<Record<string, unknown>>;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  inventoryCoreLoadedAt: number | null;
  transactionsLoadedAt: number | null;
  usersAndRolesLoadedAt: number | null;
  unloadingRulesLoadedAt: number | null;
  /** When the company settings were last read from the server. */
  systemSettingsLoadedAt: number | null;
  /**
   * Why the company settings could not be read.
   *
   * Separate from the shared "error" field, which the offline settings screen reads:
   * one screen's failure must not be reported in another's slot.
   */
  systemSettingsLoadError: string | null;
  formulasLoadedAt: number | null;
  soft: SoftMap;
  sortMode: ItemSortMode;
  /** True while a catalog-order save is in flight, so the button can say so. */
  savingItemOrder: boolean;
  /**
   * The named, saved orders, and which one is active.
   *
   * `orderProfiles` is null until loaded rather than an empty list, because the
   * two mean different things: "there are no saved orders" and "we have not asked
   * yet". Showing an empty list for the second would tell the operator their
   * arrangements are gone.
   */
  orderProfiles: OrderProfileList | null;
  /**
   * Set when the loaded catalogue is a prefix of the real one.
   *
   * The list endpoint caps at 1000 rows. Above that the store holds a prefix,
   * which is safe to save — the server appends the unlisted rows by their existing
   * rank — but the operator cannot see or reorder the rest, and that has to be
   * said rather than discovered later.
   */
  catalogTruncation: { truncated: boolean; total: number } | null;
  /** True while a saved-order action is in flight, so the buttons can say so. */
  applyingOrderProfile: boolean;
  manualOrder: string[];
  load: () => Promise<void>;
  loadAll: () => Promise<void>;
  loadInventoryCore: (options?: LoaderOptions) => Promise<void>;
  loadTransactions: (options?: LoaderOptions) => Promise<void>;
  loadUsersAndRoles: (options?: LoaderOptions) => Promise<void>;
  loadOpeningBalances: (financialYear?: number, options?: LoaderOptions) => Promise<void>;
  loadFormulas: () => Promise<void>;
  loadUnloadingRules: (options?: LoaderOptions) => Promise<void>;
  /**
   * Reads the company settings from the server into the store.
   *
   * It used to be that the store held `DEFAULT_SYSTEM_SETTINGS` — every field empty —
   * until an administrator saved from the settings screen, and that save was blocked by
   * a bug in the reader. So every report header printed a blank company name while the
   * real one sat in the database. Loaded at boot now, because a printed document is
   * exactly the thing that must not depend on someone visiting a screen first.
   */
  loadSystemSettings: (options?: LoaderOptions) => Promise<void>;
  syncFromServer: (target?: SyncTarget) => Promise<void>;
  setTransactions: (transactions: Transaction[]) => void;
  setOpeningBalances: (financialYear: number, rows: OpeningBalanceRow[]) => void;
  setOpeningBalanceRows: (financialYear: number, rows: OpeningBalanceStoreRow[]) => void;
  setUsers: (users: User[]) => void;
  setRoles: (roles: RoleDefinition[]) => void;
  setSystemSettings: (settings: SystemSettings) => void;
  setUnloadingRules: (rules: UnloadingRule[]) => void;
  setReportConfig: (config: ReportColumnConfig[]) => void;
  setOpeningBalanceReportConfig: (config: ReportColumnConfig[]) => void;
  setFormulas: (formulas: Formula[]) => void;
  createUnloadingRule: (rule: UnloadingRuleDraft) => Promise<UnloadingRule>;
  updateUnloadingRule: (rule: UnloadingRule) => Promise<UnloadingRule>;
  deleteUnloadingRule: (id: string) => Promise<void>;
  createFormula: (formula: Formula) => Promise<Formula>;
  updateFormula: (formula: Formula) => Promise<Formula>;
  deleteFormula: (id: string) => Promise<void>;
  setReferenceData: (data: { units?: string[]; categories?: string[] }) => void;
  getGridPreferences: (moduleKey: string, defaults: GridColumnPreference[]) => GridColumnPreference[];
  setGridPreferences: (moduleKey: string, columns: GridColumnPreference[]) => void;
  resetGridPreferences: (moduleKey: string, defaults: GridColumnPreference[]) => void;
  getGridDisplayPolicy: (moduleKey: string) => GridDisplayPolicy;
  setGridDisplayPolicy: (moduleKey: string, policy: GridDisplayPolicy) => void;
  setOperationPrintConfig: (config: Record<string, unknown>) => void;
  setOperationPrintTemplates: (templates: Array<Record<string, unknown>>) => void;
  setStocktakingPrintConfig: (config: Record<string, unknown>) => void;
  setStocktakingPrintTemplates: (templates: Array<Record<string, unknown>>) => void;
  exportRowsToExcel: (options: { fileName: string; sheetName?: string; rows: Array<Record<string, unknown>> }) => Promise<void>;
  exportSheetsToExcel: (options: { fileName: string; sheets: ExportSheet[] }) => Promise<void>;
  exportPdfReport: (options: { endpoint: string; payload: unknown; fileName: string }) => Promise<void>;
  exportElementToPdf: (options: { element: HTMLElement; fileName: string; jsPdfOptions?: Record<string, unknown> }) => Promise<void>;
  addUnit: (unit: string) => Promise<void>;
  deleteUnit: (unit: string) => Promise<void>;
  addCategory: (category: string) => Promise<void>;
  deleteCategory: (category: string) => Promise<void>;
  addItems: (items: Item[], actor?: ActorInfo) => Promise<void>;
  updateItems: (items: Item[], actor?: ActorInfo) => Promise<void>;
  deleteItems: (ids: string[], actor?: ActorInfo) => Promise<void>;
  setSortMode: (mode: ItemSortMode) => void;
  saveItemOrder: (actor?: ActorInfo) => Promise<void>;
  loadOrderProfiles: () => Promise<void>;
  createOrderProfile: (name: string, note?: string) => Promise<void>;
  applyOrderProfile: (profileId: string) => Promise<void>;
  refreshOrderProfile: (profileId: string) => Promise<void>;
  renameOrderProfile: (profileId: string, name: string) => Promise<void>;
  deleteOrderProfile: (profileId: string) => Promise<void>;
  moveItemManually: (id: string, d: 'up' | 'down', visibleIds?: string[]) => void;
  createItem: (item: Item, actorId: string, actorName: string) => Promise<void>;
  updateItem: (item: Item, actorId: string, actorName: string) => Promise<void>;
  bulkUpdate: (ids: string[], patch: Partial<Item>, actorId: string, actorName: string) => Promise<void>;
  updateStockFromTransaction: (transaction: Transaction, action: InventoryAction, oldTransaction?: Transaction) => void;
  softDelete: (ids: string[], actorName: string) => void;
  restore: (ids: string[]) => void;
  purge: (ids: string[], actorId: string, actorName: string) => Promise<void>;
};

export const clearLegacyInventoryBootstrapState = () => {
  return;
};

const DEFAULT_ACTOR: ActorInfo = { id: 'system', name: 'InventoryStore' };

const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  companyName: '',
  currency: '',
  address: '',
  phone: '',
};

const n = (v: unknown, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);

const uniqueStrings = (values: string[]) => {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
const cmp = (a: unknown, b: unknown) => String(a || '').localeCompare(String(b || ''), 'ar-EG', { numeric: true, sensitivity: 'base' });

const toDelta = (type: string, quantity: number): number => {
  if (!Number.isFinite(quantity)) return 0;
  if (isInboundOperationType(type)) return Math.abs(quantity);
  if (isOutboundOperationType(type)) return -Math.abs(quantity);

  return 0;
};

const normOrder = (items: Item[], order: string[]) => {
  const ids = items.map((i) => String(i.id));
  const set = new Set(ids);
  const clean = order.filter((id, idx) => set.has(id) && order.indexOf(id) === idx);
  return [...clean, ...ids.filter((id) => !clean.includes(id))];
};

const sortItems = (items: Item[], mode: ItemSortMode, order: string[]) => {
  const list = [...items];
  if (mode === 'manual_locked') {
    const rank = new Map(normOrder(items, order).map((id, i) => [id, i]));
    return list.sort((a, b) => (rank.get(String(a.id)) ?? 999999) - (rank.get(String(b.id)) ?? 999999));
  }
  if (mode === 'name_asc') return list.sort((a, b) => cmp(a.name, b.name));
  if (mode === 'name_desc') return list.sort((a, b) => cmp(b.name, a.name));
  if (mode === 'code_asc') return list.sort((a, b) => cmp(a.code || '', b.code || '') || cmp(a.name, b.name));
  return list.sort((a, b) => cmp(a.category, b.category) || cmp(a.name, b.name));
};

const dto = (r: ItemDto): Item => ({
  id: String(r.publicId || r.id),
  publicId: r.publicId ? String(r.publicId) : undefined,
  name: r.name,
  // The saved catalog rank. The order also survives as array position, but
  // without this the client cannot answer "where is this item?", which is the
  // question an operator asks when an item they placed is not where they left it.
  sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : undefined,
  code: r.code || undefined,
  barcode: r.barcode || undefined,
  category: r.category || 'تصنيف عام',
  unit: r.unit || 'وحدة',
  minLimit: n(r.minLimit, 0),
  maxLimit: n(r.maxLimit, 1000),
  orderLimit: r.orderLimit == null ? undefined : n(r.orderLimit, 0),
  packageWeight: r.packageWeight == null ? undefined : n(r.packageWeight, 0),
  currentStock: n(r.currentStock, 0),
  englishName: r.description || undefined,
  lastUpdated: new Date().toISOString(),
});

const syncPayload = (i: Item): SyncItemPayload => ({
  publicId: String(i.publicId || i.id),
  name: i.name.trim(),
  code: i.code?.trim() || undefined,
  barcode: i.barcode?.trim() || undefined,
  category: i.category,
  unit: i.unit,
  minLimit: n(i.minLimit, 0),
  maxLimit: n(i.maxLimit, 1000),
  orderLimit: i.orderLimit == null ? undefined : n(i.orderLimit, 0),
  packageWeight: i.packageWeight == null ? undefined : n(i.packageWeight, 0),
  description: i.englishName || undefined,
});

const deriveBalances = (items: Item[]) =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[String(item.id)] = n(item.currentStock, 0);
    return acc;
  }, {});

const deriveReferenceData = (items: Item[], categories: string[], units: string[]) => ({
  categories: uniqueStrings([...categories, ...items.map((item) => item.category)]),
  units: uniqueStrings([...units, ...items.map((item) => item.unit)]),
});

const normalizeUnloadingRule = (rule: Partial<UnloadingRule>): UnloadingRule => ({
  id: String(rule.id || ''),
  rule_name: String(rule.rule_name ?? rule.name ?? '').trim(),
  allowed_duration_minutes: n(rule.allowed_duration_minutes ?? rule.durationMinutes ?? rule.unloading_duration_minutes, 0),
  penalty_rate_per_minute: n(rule.penalty_rate_per_minute ?? rule.delayPenaltyPerMinute, 0),
  is_active: rule.is_active ?? true,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

const normalizeUnloadingRulesCollection = (rules: UnloadingRule[]) => {
  const normalized = rules
    .map((rule) => normalizeUnloadingRule(rule))
    .filter((rule) => rule.id && rule.rule_name);

  const unique = new Map<string, UnloadingRule>();
  normalized.forEach((rule) => {
    unique.set(rule.id, rule);
  });

  return [...unique.values()].sort((left, right) => {
    const activeDelta = Number(Boolean(right.is_active)) - Number(Boolean(left.is_active));
    if (activeDelta !== 0) return activeDelta;
    return cmp(left.rule_name || '', right.rule_name || '') || cmp(left.id, right.id);
  });
};

const normalizeCollections = (items: Item[], mode: ItemSortMode, manualOrder: string[], categories: string[], units: string[]) => {
  const nextManualOrder = normOrder(items, manualOrder);
  const sorted = sortItems(items, mode, nextManualOrder);
  const referenceData = deriveReferenceData(sorted, categories, units);
  return {
    items: sorted,
    manualOrder: nextManualOrder,
    balances: deriveBalances(sorted),
    categories: referenceData.categories,
    units: referenceData.units,
  };
};

const applyDelta = (items: Item[], transaction: Transaction, multiplier: 1 | -1) => {
  const delta = toDelta(transaction.type, Number(transaction.quantity)) * multiplier;
  if (delta === 0) return items;

  return items.map((item) =>
    String(item.id) === String(transaction.itemId)
      ? { ...item, currentStock: n(item.currentStock, 0) + delta, lastUpdated: new Date().toISOString() }
      : item
  );
};

const mapUserDto = (row: UserDto): User => ({
  id: row.id,
  username: row.username,
  email: row.email ?? undefined,
  firstName: row.firstName ?? undefined,
  lastName: row.lastName ?? undefined,
  name: row.fullName || row.username,
  role: row.role?.name || 'User',
  roleId: row.roleId || row.role?.id,
  permissions: row.role?.permissions || [],
  active: row.isActive,
  isActive: row.isActive,
  // FC-SEC-012 — this reported every inactive account as "suspended", a third
  // word for the same state. The server now distinguishes a security lock from a
  // deactivation, so the client does too.
  status: row.isActive ? 'active' : row.isLocked ? 'locked' : 'inactive',
  scope: 'all',
  twoFactorEnabled: false,
  twoFaEnabled: false,
  // FC-SEC-010 — this was hardcoded false, so the forced-change flag the server
  // had just started sending was discarded on the way into the store.
  mustChangePassword: Boolean(row.mustChangePassword),
});

const mapRoleDto = (row: RoleDto): RoleDefinition => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  // FC-SEC-014 — the JSON.parse fallback existed only because `permissions` used
  // to be the raw column. The field is an array now, so the parse is gone rather
  // than kept as a second way to read the same value.
  permissionIds: row.permissions || [],
});

const normalizeOpeningBalanceRows = (rows: Array<{ item_id?: string; itemId?: string; quantity?: number }>) =>
  rows.reduce<OpeningBalanceMap>((acc, row) => {
    const itemId = String(row.itemId || row.item_id || '').trim();
    const quantity = Number(row.quantity || 0);
    if (!itemId || !Number.isFinite(quantity)) return acc;
    acc[itemId] = quantity;
    return acc;
  }, {});

const normalizeOpeningBalanceStoreRows = (rows: OpeningBalanceApiRow[], financialYear: number): OpeningBalanceStoreRow[] => {
  const rawList = rows.reduce<OpeningBalanceStoreRow[]>((acc, row, index) => {
    const itemPublicId = String(row?.itemPublicId ?? row?.item?.publicId ?? row?.item_id ?? row?.itemId ?? '').trim();
    const itemId = itemPublicId;
    const quantity = Number(row?.quantity ?? 0);
    const unitCost = row?.unitCost == null ? null : Number(row.unitCost);
    if (!itemId || !Number.isFinite(quantity)) return acc;

    acc.push({
      id: Number.isFinite(Number(row?.id)) ? Number(row.id) : index + 1,
      itemId,
      itemPublicId: itemPublicId || undefined,
      financialYear: Number.isFinite(Number(row?.financialYear)) ? Number(row.financialYear) : financialYear,
      quantity,
      unitCost: unitCost != null && Number.isFinite(unitCost) ? unitCost : null,
      item: row?.item?.name
        ? { name: String(row.item.name), publicId: row?.item?.publicId ? String(row.item.publicId) : undefined }
        : undefined,
    });
    return acc;
  }, []);

  // إزالة التكرار بـ itemId+financialYear؛ آخر سجل يفوز (يعكس آخر upsert).
  const dedupeMap = new Map<string, OpeningBalanceStoreRow>();
  for (const row of rawList) {
    dedupeMap.set(`${row.itemId}_${row.financialYear}`, row);
  }
  return Array.from(dedupeMap.values());
};

const mapApiOpeningBalances = (rows: OpeningBalanceApiRow[]) =>
  rows.reduce<OpeningBalanceMap>((acc, row) => {
    const itemId = String(row?.itemPublicId ?? row?.item?.publicId ?? row?.itemId ?? '').trim();
    const quantity = Number(row?.quantity ?? 0);
    if (!itemId || !Number.isFinite(quantity)) return acc;
    acc[itemId] = quantity;
    return acc;
  }, {});

const normalizeFormula = (raw: FormulaApiRow): Formula => ({
  id: String(raw?.id || crypto.randomUUID()),
  code: String(raw?.code || ''),
  name: String(raw?.name || ''),
  targetProductId: String(raw?.targetProductId || raw?.targetItemId || ''),
  isActive: raw?.isActive !== false,
  notes: raw?.notes ? String(raw.notes) : undefined,
  items: Array.isArray(raw?.items)
    ? raw.items.map((entry) => {
        const item = (entry || {}) as FormulaApiItem;
        return {
        itemId: String(entry?.itemId || ''),
        percentage: Number(entry?.percentage || 0),
        weightPerTon: Number(entry?.weightPerTon || 0),
        };
      })
    : [],
});

const toFormulaPayload = (formula: Formula) => ({
  id: formula.id,
  code: formula.code,
  name: formula.name,
  targetProductId: formula.targetProductId,
  targetItemId: formula.targetProductId,
  isActive: formula.isActive,
  notes: formula.notes || '',
  items: formula.items.map((entry) => ({
    itemId: entry.itemId,
    percentage: Number(entry.percentage || 0),
    weightPerTon: Number(entry.weightPerTon || 0),
  })),
});

const extractArrayPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return [];
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const currentFinancialYear = () => getFinancialYearFromDate();

const syncItemsFromServer = async () => {
  // The list endpoint caps at 1000 rows, and the store asks for all of them.
  //
  // Above that cap the store holds a *prefix* of the catalogue. A partial save is
  // still safe — the server appends the unlisted rows by their existing rank — but
  // the operator cannot see or reorder the ones past the cap, and nothing said so.
  // `onCatalogTruncated` is how that becomes visible instead of silent.
  const result = await getItemsFromApi({ page: 1, limit: 1000, isArchived: false });
  onCatalogTruncated(Number(result.total) > result.data.length, Number(result.total));
  return result.data.map(dto);
};

/**
 * Set when the loaded catalogue is a prefix of the real one.
 *
 * A module-level flag rather than store state, because this is discovered inside
 * a pure mapping helper that runs before the store exists, and because it is a
 * property of the last fetch rather than something a screen sets. It is read by
 * the page to raise a notice, and cleared on every load so a smaller catalogue
 * stops being reported.
 */
let catalogTruncation: { truncated: boolean; total: number } = { truncated: false, total: 0 };

const onCatalogTruncated = (truncated: boolean, total: number) => {
  catalogTruncation = { truncated, total };
};

export const catalogTruncationNotice = () => catalogTruncation;

const syncTransactionsFromServer = async () => {
  return getTransactionsFromApi();
};

const syncOpeningBalancesFromServer = async (financialYear: number, options?: LoaderOptions) => {
  const cached = openingBalanceSyncCache.get(financialYear);
  if (hasFreshOpeningBalanceCache(financialYear, options) && cached) {
    return cached.data;
  }

  const inFlight = openingBalanceSyncInFlight.get(financialYear);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
      const rows = await getOpeningBalancesFromApi(financialYear);
      const data: OpeningBalanceSyncResult = {
        openingBalances: Array.isArray(rows) ? mapApiOpeningBalances(rows) : {},
        openingBalanceRows: Array.isArray(rows) ? normalizeOpeningBalanceStoreRows(rows, financialYear) : [],
      };
      openingBalanceSyncCache.set(financialYear, { loadedAt: Date.now(), data });
      return data;
    } catch (error) {
      if (!options?.force && cached) {
        return cached.data;
      }
      throw error;
    } finally {
      openingBalanceSyncInFlight.delete(financialYear);
    }
  })();

  openingBalanceSyncInFlight.set(financialYear, request);
  return request;
};

const syncUsersFromServer = async () => {
  const response = await fetchUsers({ page: 1, limit: 500 });
  return normalizeUsers(response.data.map(mapUserDto));
};

const syncRolesFromServer = async () => {
  const roles = await fetchRoles();
  return roles.map(mapRoleDto);
};

const syncFormulasFromServer = async () => {
  const response = await apiClient.get('/formulations');
  return extractArrayPayload(response.data).map((entry) =>
    normalizeFormula((entry && typeof entry === 'object' ? entry : {}) as FormulaApiRow),
  );
};

const buildInitialGridPreferences = (): Record<string, GridColumnPreference[]> => {
  const map: Record<string, GridColumnPreference[]> = {};
  try {
    getUserGridPreferences()
      .filter((row) => row.user_id === '0')
      .forEach((row) => {
        try {
          const cols = JSON.parse(row.config_json || '[]') as GridColumnPreference[];
          if (Array.isArray(cols) && cols.length > 0) {
            map[row.module_key] = cols;
          }
        } catch {
          // ignore malformed row
        }
      });
  } catch {
    // ignore storage errors
  }
  return map;
};

const normalizeGridPreferences = (defaults: GridColumnPreference[], stored: GridColumnPreference[] = []) => {
  if (!defaults.length) return [...stored];

  const storedMap = new Map(stored.map((column) => [column.key, column]));
  return defaults.map((column, index) => {
    const persisted = storedMap.get(column.key);
    return {
      ...column,
      ...persisted,
      order: persisted?.order ?? column.order ?? index,
    };
  });
};

const triggerBlobDownload = (blob: Blob, fileName: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const normalizePdfPayload = (payload: unknown, fileName: string) => {
  const candidate = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (candidate.type && candidate.data) {
    return candidate;
  }

  const rows = Array.isArray(candidate.rows) ? candidate.rows : [];
  const inferredType = String(candidate.title || fileName).toLowerCase().includes('dashboard')
    ? 'dashboard'
    : rows.some((row) => {
        const entry = row as Record<string, unknown>;
        return 'date' in entry || 'quantity' in entry || 'type' in entry;
      })
      ? 'transactions'
      : 'items';

  return {
    type: inferredType,
    data: {
      columns: Array.isArray(candidate.columns) ? candidate.columns : [],
      rows,
      summary: Array.isArray(candidate.summary) ? candidate.summary : [],
    },
    title: candidate.title,
    subtitle: candidate.subtitle,
    generatedBy: candidate.generatedBy,
    filename: candidate.filename,
  };
};

const DEFAULT_LOADER_STALE_MS = 30 * 1000;
const DEFAULT_OPENING_BALANCE_STALE_MS = 20 * 1000;

const openingBalanceSyncCache = new Map<number, { loadedAt: number; data: OpeningBalanceSyncResult }>();
const openingBalanceSyncInFlight = new Map<number, Promise<OpeningBalanceSyncResult>>();

// لماذا: single-flight guard لمنع طلبات HTTP متزامنة لجلب المستخدمين والأدوار.
// بدونه يُطلق useAppBootstrap + UnifiedIAM + أي مكوّن آخر طلبات مستقلة في نفس الوقت،
// مما رصدناه كـ 13 req/min على /api/users. النمط مطابق لـ openingBalanceSyncInFlight.
type UsersAndRolesResult = { users: ReturnType<typeof mapUserDto>[]; roles: ReturnType<typeof mapRoleDto>[] };
let usersAndRolesInFlight: Promise<UsersAndRolesResult> | null = null;
let unloadingRulesInFlight: Promise<UnloadingRule[]> | null = null;

const syncUsersAndRolesFromServer = async (): Promise<UsersAndRolesResult> => {
  if (usersAndRolesInFlight) return usersAndRolesInFlight;

  usersAndRolesInFlight = (async () => {
    try {
      const [usersResponse, roles] = await Promise.all([
        fetchUsers({ page: 1, limit: 500 }),
        fetchRoles(),
      ]);
      return {
        users: usersResponse.data.map(mapUserDto),
        roles: roles.map(mapRoleDto),
      };
    } finally {
      usersAndRolesInFlight = null;
    }
  })();

  return usersAndRolesInFlight;
};

const syncUnloadingRulesFromServer = async (): Promise<UnloadingRule[]> => {
  if (unloadingRulesInFlight) return unloadingRulesInFlight;

  unloadingRulesInFlight = (async () => {
    try {
      return await fetchUnloadingRules();
    } finally {
      unloadingRulesInFlight = null;
    }
  })();

  return unloadingRulesInFlight;
};

const shouldReload = (loadedAt: number | null, options?: LoaderOptions) => {
  if (options?.force) return true;
  if (!loadedAt) return true;
  const staleMs = Math.max(0, Number(options?.staleMs ?? DEFAULT_LOADER_STALE_MS));
  return Date.now() - loadedAt >= staleMs;
};

const hasFreshOpeningBalanceCache = (financialYear: number, options?: LoaderOptions) => {
  if (options?.force) return false;
  const cached = openingBalanceSyncCache.get(financialYear);
  if (!cached) return false;
  const staleMs = Math.max(0, Number(options?.staleMs ?? DEFAULT_OPENING_BALANCE_STALE_MS));
  return Date.now() - cached.loadedAt < staleMs;
};

const initialSort: SortState = { mode: 'manual_locked', manualOrder: [] };

export const useInventoryStore = create<Store>()(
  (set, get) => ({
      items: [],
      balances: {},
      transactions: [],
      openingBalances: {},
      openingBalanceRows: [],
      openingBalancesYear: null,
      openingBalancesLoading: false,
      openingBalancesError: null,
      users: [],
      roles: [],
      systemSettings: DEFAULT_SYSTEM_SETTINGS,
      unloadingRules: [],
      reportConfig: [],
      openingBalanceReportConfig: [],
      formulas: [],
      units: [],
      categories: [],
      gridPreferences: buildInitialGridPreferences(),
      gridDisplayPolicies: {},
      operationPrintConfig: getOperationPrintConfig(),
      operationPrintTemplates: getOperationPrintTemplates(),
      stocktakingPrintConfig: getStocktakingPrintConfig(),
      stocktakingPrintTemplates: getStocktakingPrintTemplates(),
      loading: false,
      syncing: false,
      error: null,
      lastLoadedAt: null,
      inventoryCoreLoadedAt: null,
      transactionsLoadedAt: null,
      usersAndRolesLoadedAt: null,
      unloadingRulesLoadedAt: null,
      systemSettingsLoadedAt: null,
      systemSettingsLoadError: null,
      formulasLoadedAt: null,
      soft: {},
      sortMode: initialSort.mode,
  savingItemOrder: false,
  orderProfiles: null,
  catalogTruncation: null,
  applyingOrderProfile: false,
      manualOrder: initialSort.manualOrder,

      load: async () => {
        set({ loading: true, error: null });
        try {
          const result = await getItemsFromApi();
          const mappedItems = result.data.map(dto);
          const normalized = normalizeCollections(mappedItems, get().sortMode, get().manualOrder, get().categories, get().units);

          set({
            items: normalized.items,
            balances: normalized.balances,
            categories: normalized.categories,
            units: normalized.units,
            manualOrder: normalized.manualOrder,
            loading: false,
            lastLoadedAt: Date.now(),
          });
        } catch (error: unknown) {
          set({ loading: false, error: getErrorMessage(error, 'Failed to load items') });
        }
      },

      loadAll: async () => {
        const openingBalancesYear = get().openingBalancesYear ?? currentFinancialYear();

        set({
          loading: true,
          error: null,
          openingBalancesYear,
          openingBalancesError: null,
        });

        try {
          await get().syncFromServer('all');
        } finally {
          set({ loading: false, lastLoadedAt: Date.now() });
        }
      },

      loadInventoryCore: async (options) => {
        const current = get();
        if (!shouldReload(current.inventoryCoreLoadedAt, options)) {
          return;
        }

        set({ syncing: true, error: null });
        try {
          const nextItems = await syncItemsFromServer();
          const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder, get().categories, get().units);
          const loadedAt = Date.now();

          set({
            items: normalized.items,
            balances: normalized.balances,
            categories: normalized.categories,
            units: normalized.units,
            manualOrder: normalized.manualOrder,
            syncing: false,
            inventoryCoreLoadedAt: loadedAt,
            lastLoadedAt: loadedAt,
            // Mirrored into store state rather than left in a module variable: a
            // component reading a module getter does not re-render when it changes,
            // so the notice would be computed correctly and never displayed.
            catalogTruncation: catalogTruncationNotice(),
          });
        } catch (error: unknown) {
          set({ syncing: false, error: getErrorMessage(error, 'تعذر تحميل بيانات الأصناف من الخادم.') });
          throw error;
        }
      },

      loadTransactions: async (options) => {
        const current = get();
        if (!shouldReload(current.transactionsLoadedAt, options)) {
          return;
        }

        set({ syncing: true, error: null });
        try {
          const transactions = await syncTransactionsFromServer();
          const loadedAt = Date.now();

          set({
            transactions,
            syncing: false,
            transactionsLoadedAt: loadedAt,
            lastLoadedAt: loadedAt,
          });
        } catch (error: unknown) {
          set({ syncing: false, error: getErrorMessage(error, 'تعذر تحميل الحركات من الخادم.') });
          throw error;
        }
      },

      loadUsersAndRoles: async (options) => {
        const current = get();
        if (!shouldReload(current.usersAndRolesLoadedAt, options)) {
          return;
        }

        // لماذا: نستخدم syncUsersAndRolesFromServer (التي تملك single-flight guard)
        // بدلاً من استدعاء syncUsersFromServer + syncRolesFromServer بشكل مستقل.
        // هذا يضمن أنه حتى لو نادَى N مكوّنات loadUsersAndRoles في آنٍ واحد،
        // ينتج طلب HTTP واحد فقط لكل من /api/users و /api/users/roles.
        set({ syncing: true, error: null });
        try {
          const { users: rawUsers, roles: rawRoles } = await syncUsersAndRolesFromServer();
          const users = normalizeUsers(rawUsers);
          const roles = rawRoles;
          const loadedAt = Date.now();

          set({
            users,
            roles,
            syncing: false,
            usersAndRolesLoadedAt: loadedAt,
            lastLoadedAt: loadedAt,
          });
        } catch (error: unknown) {
          set({ syncing: false, error: getErrorMessage(error, 'تعذر تحميل المستخدمين والأدوار من الخادم.') });
          throw error;
        }
      },

      loadOpeningBalances: async (financialYear = currentFinancialYear(), options) => {
        if (!hasFreshOpeningBalanceCache(financialYear, options)) {
          set({ openingBalancesLoading: true, openingBalancesError: null });
        }

        try {
          const synced = await syncOpeningBalancesFromServer(financialYear, options);

          set({
            openingBalances: synced.openingBalances,
            openingBalanceRows: synced.openingBalanceRows,
            openingBalancesYear: financialYear,
            openingBalancesLoading: false,
            openingBalancesError: null,
          });
        } catch {
          set({
            openingBalances: {},
            openingBalanceRows: [],
            openingBalancesYear: financialYear,
            openingBalancesLoading: false,
            openingBalancesError: 'تعذر مزامنة أرصدة بداية المدة من الخادم.',
          });
        }
      },

      loadFormulas: async () => {
        try {
          const formulas = await syncFormulasFromServer();
          set({ formulas: [...formulas], formulasLoadedAt: Date.now(), lastLoadedAt: Date.now() });
        } catch (error: unknown) {
          set({ error: getErrorMessage(error, 'تعذر تحميل التركيبات من الخادم.') });
          throw error;
        }
      },

      loadUnloadingRules: async (options) => {
        const current = get();
        if (!shouldReload(current.unloadingRulesLoadedAt, options)) {
          return;
        }

        set({ syncing: true, error: null });
        try {
          const unloadingRules = await syncUnloadingRulesFromServer();
          const loadedAt = Date.now();
          set({
            unloadingRules: normalizeUnloadingRulesCollection(unloadingRules),
            syncing: false,
            unloadingRulesLoadedAt: loadedAt,
            lastLoadedAt: loadedAt,
          });
        } catch (error: unknown) {
          set({ syncing: false, error: getErrorMessage(error, 'تعذر تحميل قواعد التفريغ من الخادم.') });
          throw error;
        }
      },

      loadSystemSettings: async (options) => {
        const current = get();
        if (!shouldReload(current.systemSettingsLoadedAt, options)) {
          return;
        }

        try {
          const form = await loadSystemSettingsForm();
          const loadedAt = Date.now();
          // The server's answer, merged over the defaults rather than replacing them, so
          // a key it has never heard of leaves the field as the client already had it.
          set({
            systemSettings: { ...current.systemSettings, ...form },
            systemSettingsLoadError: null,
            systemSettingsLoadedAt: loadedAt,
          });
        } catch (error: unknown) {
          // Deliberately NOT the shared `error`: that field is read by the offline
          // settings screen, so a company-settings failure would surface there as a
          // message about something else — the same defect shape this whole change is
          // about, just with the two screens swapped.
          set({ systemSettingsLoadError: getErrorMessage(error, 'تعذر تحميل إعدادات الشركة من الخادم.') });
          throw error;
        }
      },

      syncFromServer: async (target = 'all') => {
        if (get().syncing) return;
        set({ syncing: true, error: null });

        const openingBalanceYear = get().openingBalancesYear ?? currentFinancialYear();
        const shouldLoadItems = target === 'all' || target === 'items';
        const shouldLoadTransactions = target === 'all' || target === 'transactions';
        const shouldLoadOpeningBalances = target === 'all' || target === 'openingBalances';
        const shouldLoadUsers = target === 'all' || target === 'users';
        const shouldLoadFormulas = target === 'all' || target === 'formulas';
        const shouldLoadUnloadingRules = target === 'all' || target === 'unloadingRules';
        const shouldFetchUnloadingRules = shouldLoadUnloadingRules && shouldReload(get().unloadingRulesLoadedAt, { staleMs: DEFAULT_LOADER_STALE_MS });

        // لماذا: دمجنا syncUsersFromServer + syncRolesFromServer في syncUsersAndRolesFromServer
        // الواحدة لتشترك في الـ single-flight guard وتُصدر طلبَي HTTP معًا في Promise.all
        // بدلاً من طلبَين مستقلَّين قد يُضاعَفان عند الاستدعاء المتزامن.
        // إضافة 2026: نتحقق من usersAndRolesLoadedAt قبل الاستدعاء حتى تحترم loadAll
        // نافذة الـ stale وتوقف اندفاع /api/users عند التنقل بين الصفحات.
        const [itemsResult, transactionsResult, openingBalancesResult, usersAndRolesResult, formulasResult, unloadingRulesResult] = await Promise.allSettled([
          shouldLoadItems ? syncItemsFromServer() : Promise.resolve(null),
          shouldLoadTransactions ? syncTransactionsFromServer() : Promise.resolve(null),
          shouldLoadOpeningBalances
            ? syncOpeningBalancesFromServer(openingBalanceYear, { staleMs: DEFAULT_OPENING_BALANCE_STALE_MS })
            : Promise.resolve(null),
          shouldLoadUsers && shouldReload(get().usersAndRolesLoadedAt, { staleMs: DEFAULT_LOADER_STALE_MS })
            ? syncUsersAndRolesFromServer()
            : Promise.resolve(null),
          shouldLoadFormulas ? syncFormulasFromServer() : Promise.resolve(null),
          shouldFetchUnloadingRules ? syncUnloadingRulesFromServer() : Promise.resolve(null),
        ]);

        const current = get();
        const nextItems = shouldLoadItems && itemsResult.status === 'fulfilled' && Array.isArray(itemsResult.value)
          ? itemsResult.value
          : current.items;
        const nextTransactions = shouldLoadTransactions && transactionsResult.status === 'fulfilled' && Array.isArray(transactionsResult.value)
          ? transactionsResult.value
          : current.transactions;
        const nextOpeningBalances = shouldLoadOpeningBalances && openingBalancesResult.status === 'fulfilled' && openingBalancesResult.value
          ? openingBalancesResult.value.openingBalances
          : current.openingBalances;
        const nextOpeningBalanceRows = shouldLoadOpeningBalances && openingBalancesResult.status === 'fulfilled' && openingBalancesResult.value
          ? openingBalancesResult.value.openingBalanceRows
          : current.openingBalanceRows;

        const usersAndRolesData = shouldLoadUsers && usersAndRolesResult.status === 'fulfilled' && usersAndRolesResult.value;
        const nextUsers = usersAndRolesData
          ? normalizeUsers(usersAndRolesData.users)
          : current.users;
        const nextRoles = usersAndRolesData
          ? usersAndRolesData.roles
          : current.roles;

        const nextFormulas = shouldLoadFormulas && formulasResult.status === 'fulfilled' && Array.isArray(formulasResult.value)
          ? formulasResult.value
          : current.formulas;
        const nextUnloadingRules = shouldFetchUnloadingRules && unloadingRulesResult.status === 'fulfilled' && Array.isArray(unloadingRulesResult.value)
          ? normalizeUnloadingRulesCollection(unloadingRulesResult.value)
          : current.unloadingRules;

        const normalized = normalizeCollections(nextItems, current.sortMode, current.manualOrder, current.categories, current.units);
        const failures = [
          shouldLoadItems ? itemsResult : null,
          shouldLoadTransactions ? transactionsResult : null,
          shouldLoadOpeningBalances ? openingBalancesResult : null,
          shouldLoadUsers ? usersAndRolesResult : null,
          shouldLoadFormulas ? formulasResult : null,
          shouldFetchUnloadingRules ? unloadingRulesResult : null,
        ].flatMap((result) => (result && result.status === 'rejected' ? [result] : []));

        set({
          items: normalized.items,
          balances: normalized.balances,
          transactions: nextTransactions,
          openingBalances: nextOpeningBalances,
          openingBalanceRows: nextOpeningBalanceRows,
          openingBalancesYear: openingBalanceYear,
          openingBalancesError: shouldLoadOpeningBalances && openingBalancesResult.status === 'rejected'
            ? 'تعذر مزامنة أرصدة بداية المدة من الخادم.'
            : current.openingBalancesError,
          users: nextUsers,
          roles: nextRoles,
          unloadingRules: nextUnloadingRules,
          formulas: nextFormulas,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
          syncing: false,
          error: failures.length > 0 ? 'تعذر تحميل بعض البيانات من الخادم.' : null,
          lastLoadedAt: Date.now(),
          inventoryCoreLoadedAt: shouldLoadItems && itemsResult.status === 'fulfilled' ? Date.now() : current.inventoryCoreLoadedAt,
          transactionsLoadedAt: shouldLoadTransactions && transactionsResult.status === 'fulfilled' ? Date.now() : current.transactionsLoadedAt,
          usersAndRolesLoadedAt: shouldLoadUsers && usersAndRolesResult.status === 'fulfilled' && usersAndRolesResult.value !== null
            ? Date.now()
            : current.usersAndRolesLoadedAt,
          unloadingRulesLoadedAt: shouldFetchUnloadingRules && unloadingRulesResult.status === 'fulfilled' ? Date.now() : current.unloadingRulesLoadedAt,
          formulasLoadedAt: shouldLoadFormulas && formulasResult.status === 'fulfilled' ? Date.now() : current.formulasLoadedAt,
        });
      },

      setTransactions: (transactions) => {
        set({ transactions: [...transactions] });
      },

      setOpeningBalances: (financialYear, rows) => {
        const nextOpeningBalances = normalizeOpeningBalanceRows(
          rows.map((row) => ({ item_id: row.itemId, quantity: row.quantity }))
        );
        const nextOpeningBalanceRows = rows.map((row, index) => ({
          id: index + 1,
          itemId: row.itemId,
          itemPublicId: row.itemId,
          financialYear,
          quantity: row.quantity,
          unitCost: null,
        }));

        set({
          openingBalances: nextOpeningBalances,
          openingBalanceRows: nextOpeningBalanceRows,
          openingBalancesYear: financialYear,
          openingBalancesError: null,
        });
      },

      setOpeningBalanceRows: (financialYear, rows) => {
        const nextOpeningBalanceRows = rows.map((row, index) => ({
          ...row,
          id: Number.isFinite(Number(row.id)) ? Number(row.id) : index + 1,
          financialYear,
          itemId: String(row.itemPublicId || row.itemId),
          itemPublicId: String(row.itemPublicId || row.itemId),
          quantity: Number(row.quantity || 0),
          unitCost: row.unitCost == null ? null : Number(row.unitCost),
        }));

        const nextOpeningBalances = nextOpeningBalanceRows.reduce<OpeningBalanceMap>((acc, row) => {
          if (Number.isFinite(row.quantity)) {
            acc[String(row.itemPublicId || row.itemId)] = Number(row.quantity);
          }
          return acc;
        }, {});

        set({
          openingBalances: nextOpeningBalances,
          openingBalanceRows: nextOpeningBalanceRows,
          openingBalancesYear: financialYear,
          openingBalancesError: null,
        });
      },

      setUsers: (users) => {
        set({ users: normalizeUsers(users) });
      },

      setRoles: (roles) => {
        set({ roles: [...roles] });
      },

      setSystemSettings: (settings) => {
        set({
          systemSettings: { ...DEFAULT_SYSTEM_SETTINGS, ...settings },
          systemSettingsLoadedAt: Date.now(),
        });
      },

      setUnloadingRules: (rules) => {
        set({ unloadingRules: normalizeUnloadingRulesCollection(rules), unloadingRulesLoadedAt: Date.now() });
      },

      setReportConfig: (config) => {
        set({ reportConfig: [...config] });
      },

      setOpeningBalanceReportConfig: (config) => {
        set({ openingBalanceReportConfig: [...config] });
      },

      setFormulas: (formulas) => {
        set({ formulas: [...formulas] });
      },

      createUnloadingRule: async (rule) => {
        const saved = normalizeUnloadingRule(await createUnloadingRuleInApi(rule));
        set((state) => ({
          unloadingRules: normalizeUnloadingRulesCollection([saved, ...state.unloadingRules]),
          unloadingRulesLoadedAt: Date.now(),
        }));
        return saved;
      },

      updateUnloadingRule: async (rule) => {
        const saved = normalizeUnloadingRule(
          await updateUnloadingRuleInApi(String(rule.id), {
            rule_name: String(rule.rule_name || ''),
            allowed_duration_minutes: n(rule.allowed_duration_minutes, 0),
            penalty_rate_per_minute: n(rule.penalty_rate_per_minute, 0),
            is_active: rule.is_active ?? true,
          })
        );
        set((state) => ({
          unloadingRules: normalizeUnloadingRulesCollection(
            state.unloadingRules.map((entry) => (String(entry.id) === String(saved.id) ? saved : entry))
          ),
          unloadingRulesLoadedAt: Date.now(),
        }));
        return saved;
      },

      deleteUnloadingRule: async (id) => {
        await deleteUnloadingRulesInApi([String(id)]);
        set((state) => ({
          unloadingRules: state.unloadingRules.filter((entry) => String(entry.id) !== String(id)),
          unloadingRulesLoadedAt: Date.now(),
        }));
      },

      createFormula: async (formula) => {
        const response = await apiClient.post('/formulations', toFormulaPayload(formula));
        const saved = normalizeFormula(response.data?.data ?? response.data);
        set((state) => ({ formulas: [saved, ...state.formulas.filter((entry) => String(entry.id) !== String(saved.id))] }));
        return saved;
      },

      updateFormula: async (formula) => {
        const response = await apiClient.put(`/formulations/${encodeURIComponent(String(formula.id))}`, toFormulaPayload(formula));
        const saved = normalizeFormula(response.data?.data ?? response.data);
        set((state) => ({
          formulas: state.formulas.map((entry) => (String(entry.id) === String(saved.id) ? saved : entry)),
        }));
        return saved;
      },

      deleteFormula: async (id) => {
        await apiClient.post('/formulations/delete', { ids: [id] });
        set((state) => ({
          formulas: state.formulas.filter((entry) => String(entry.id) !== String(id)),
        }));
      },

      getGridPreferences: (moduleKey, defaults) => {
        const stored = get().gridPreferences[moduleKey] || [];
        return normalizeGridPreferences(defaults, stored);
      },

      setGridPreferences: (moduleKey, columns) => {
        const normalizedColumns = columns.map((column, index) => ({
          ...column,
          order: Number.isFinite(Number(column.order)) ? Number(column.order) : index,
        }));
        set((state) => ({
          gridPreferences: {
            ...state.gridPreferences,
            [moduleKey]: normalizedColumns,
          },
        }));
        upsertGridPreferenceForUser('0', moduleKey, normalizedColumns);
      },

      resetGridPreferences: (moduleKey, defaults) => {
        set((state) => ({
          gridPreferences: {
            ...state.gridPreferences,
            [moduleKey]: normalizeGridPreferences(defaults, defaults),
          },
        }));
        resetGridPreferenceForUser('0', moduleKey);
      },

      getGridDisplayPolicy: (moduleKey) => get().gridDisplayPolicies[moduleKey] || { forceUnified: false },

      setGridDisplayPolicy: (moduleKey, policy) => {
        set((state) => ({
          gridDisplayPolicies: {
            ...state.gridDisplayPolicies,
            [moduleKey]: { forceUnified: !!policy.forceUnified },
          },
        }));
      },

      setOperationPrintConfig: (config) => {
        const nextConfig = { ...config };
        saveOperationPrintConfig(nextConfig);
        set({ operationPrintConfig: nextConfig });
      },

      setOperationPrintTemplates: (templates) => {
        const nextTemplates = [...templates];
        saveOperationPrintTemplates(nextTemplates);
        set({ operationPrintTemplates: nextTemplates });
      },

      setStocktakingPrintConfig: (config) => {
        const nextConfig = { ...config };
        saveStocktakingPrintConfig(nextConfig);
        set({ stocktakingPrintConfig: nextConfig });
      },

      setStocktakingPrintTemplates: (templates) => {
        const nextTemplates = [...templates];
        saveStocktakingPrintTemplates(nextTemplates);
        set({ stocktakingPrintTemplates: nextTemplates });
      },

      exportRowsToExcel: async ({ fileName, sheetName = 'Sheet1', rows }) => {
        await exportRowsToExcelFile({ fileName, sheetName: sheetName.slice(0, 31), rows });
      },

      exportSheetsToExcel: async ({ fileName, sheets }) => {
        await exportSheetsToExcelFile({ fileName, sheets });
      },

      exportPdfReport: async ({ endpoint, payload, fileName }) => {
        const response = await apiClient.post(endpoint, normalizePdfPayload(payload, fileName), { responseType: 'blob' });
        const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/pdf' });
        triggerBlobDownload(blob, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
      },

      exportElementToPdf: async ({ element, fileName, jsPdfOptions = {} }) => {
        await saveElementPdfDocument({
          element,
          fileName,
          marginMm: 8,
          paperSize: String(jsPdfOptions.format || 'a4') as 'a3' | 'a4' | 'legal' | 'letter',
          orientation: String(jsPdfOptions.orientation || 'landscape') as 'portrait' | 'landscape',
          scale: 2,
        });
      },

      setReferenceData: ({ units, categories }) => {
        set((state) => {
          const nextUnits = units ? uniqueStrings(units) : state.units;
          const nextCategories = categories ? uniqueStrings(categories) : state.categories;
          return { units: nextUnits, categories: nextCategories };
        });
      },

      addUnit: async (unit) => {
        const normalized = String(unit || '').trim();
        if (!normalized) return;
        const referenceData = await createUnitInApi(normalized);
        get().setReferenceData(referenceData);
      },

      deleteUnit: async (unit) => {
        const target = String(unit || '').trim().toLowerCase();
        if (!target) return;
        const referenceData = await deleteUnitInApi(unit);
        get().setReferenceData(referenceData);
      },

      addCategory: async (category) => {
        const normalized = String(category || '').trim();
        if (!normalized) return;
        const referenceData = await createCategoryInApi(normalized);
        get().setReferenceData(referenceData);
      },

      deleteCategory: async (category) => {
        const target = String(category || '').trim().toLowerCase();
        if (!target) return;
        const referenceData = await deleteCategoryInApi(category);
        get().setReferenceData(referenceData);
      },

      addItems: async (items, actor = DEFAULT_ACTOR) => {
        for (const item of items) {
          await get().createItem(item, actor.id, actor.name);
        }
      },

      updateItems: async (items, actor = DEFAULT_ACTOR) => {
        for (const item of items) {
          await get().updateItem(item, actor.id, actor.name);
        }
      },

      deleteItems: async (ids, actor = DEFAULT_ACTOR) => {
        await get().purge(ids, actor.id, actor.name);
      },

      /**
       * Saves the catalog order.
       *
       * This replaces `lockCurrentItemOrder`, which set `sortMode` and
       * `manualOrder` in memory and stopped. The button said the order was saved;
       * it was not, and there was no endpoint to save it to. Now there is one, and
       * a failure is reported rather than swallowed — a save that fails silently
       * leaves the operator looking at an order that was never written.
       */
      saveItemOrder: async (actor = DEFAULT_ACTOR) => {
        const currentItems = get().items;
        if (currentItems.length === 0) return;

        // Switching to the manual mode first is what the button means: "this is
        // the order from now on". Doing it before the request keeps the screen
        // consistent while the request is in flight.
        const order = normOrder(currentItems, get().manualOrder);
        set({ sortMode: 'manual_locked', manualOrder: order, items: sortItems(currentItems, 'manual_locked', order), savingItemOrder: true });
        try {
          const result = await reorderItems(order.map((id) => String(id)));
          toast.success(`تم حفظ ترتيب الأصناف (${result.ranked} صنف)`);
          set({ savingItemOrder: false });
        } catch (error) {
          // The order on screen is now the user's unsaved arrangement. Saying so
          // is the honest outcome; leaving it looking saved is the bug this whole
          // change exists to remove.
          toast.error(getErrorMessage(error, 'تعذّر حفظ ترتيب الأصناف'));
          set({ savingItemOrder: false });
        }
        void actor;
      },

      /**
       * Switching the view never rewrites the saved order.
       *
       * The previous version rebuilt `manualOrder` from the current on-screen
       * array whenever the mode became `manual_locked`. If the operator was
       * looking at "sort by name", that array was alphabetical, so coming back to
       * manual replaced the saved order with the alphabet in memory — and the
       * next press of the save button wrote it to the database. An order the
       * operator had arranged, including one that came from a spreadsheet import,
       * was destroyed by looking at the list a different way.
       *
       * Manual mode therefore reads `manualOrder` and only ever re-derives it from
       * the server, which is where the truth lives. Reordering is a separate
       * action with its own entry point.
       */
      // ── named, saved orders ────────────────────────────────────────────────
      //
      // The distinction these preserve: moving things on screen changes what the
      // catalogue looks like, and saves nothing. Only an explicit act here keeps
      // an arrangement. Each action reloads the list afterwards, because the
      // drift figures it returns are the only way the interface can say whether
      // what is on screen is what is saved — and a stale figure is worse than
      // none, because it says "saved" about an arrangement that is not.

      loadOrderProfiles: async () => {
        try {
          set({ orderProfiles: await fetchOrderProfiles() });
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر تحميل الترتيبات المحفوظة'));
        }
      },

      createOrderProfile: async (name, note) => {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
          toast.error('اكتب اسمًا للترتيب قبل الحفظ.');
          return;
        }
        set({ applyingOrderProfile: true });
        try {
          const saved = await createOrderProfileApi(trimmed, note);
          toast.success(`تم حفظ الترتيب باسم "${saved.name}"`);
          await get().loadOrderProfiles();
          // The saved order is the one on screen, and it is the active one, so
          // the working order and the catalogue agree with no reload.
          await get().loadInventoryCore({ force: true, staleMs: 0 } as any);
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر حفظ الترتيب'));
        } finally {
          set({ applyingOrderProfile: false });
        }
      },

      applyOrderProfile: async (profileId) => {
        set({ applyingOrderProfile: true });
        try {
          const applied = await applyOrderProfileApi(profileId);
          toast.success(`تم تفعيل الترتيب "${applied.name}"`);
          await get().loadOrderProfiles();
          await get().loadInventoryCore({ force: true, staleMs: 0 } as any);
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر تفعيل الترتيب'));
        } finally {
          set({ applyingOrderProfile: false });
        }
      },

      refreshOrderProfile: async (profileId) => {
        set({ applyingOrderProfile: true });
        try {
          const written = await refreshOrderProfileApi(profileId);
          toast.success(`تم تحديث الترتيب "${written.name}" وحفظ ما أضفته`);
          await get().loadOrderProfiles();
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر تحديث الترتيب'));
        } finally {
          set({ applyingOrderProfile: false });
        }
      },

      renameOrderProfile: async (profileId, name) => {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
          toast.error('الاسم لا يمكن أن يكون فارغًا.');
          return;
        }
        try {
          await renameOrderProfileApi(profileId, trimmed);
          toast.success('تم تغيير الاسم');
          await get().loadOrderProfiles();
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر تغيير الاسم'));
        }
      },

      deleteOrderProfile: async (profileId) => {
        try {
          await deleteOrderProfileApi(profileId);
          toast.success('تم حذف الترتيب المحفوظ');
          await get().loadOrderProfiles();
        } catch (error) {
          toast.error(getErrorMessage(error, 'تعذّر حذف الترتيب'));
        }
      },

      setSortMode: (mode) => {
        const currentItems = get().items;
        const nextManualOrder = normOrder(currentItems, get().manualOrder);
        const sorted = sortItems(currentItems, mode, nextManualOrder);
        set({ sortMode: mode, manualOrder: nextManualOrder, items: sorted });
      },

      /**
       * Moves an item one place within the group the user is looking at.
       *
       * `visibleIds` is the filtered, sorted list on screen. Without it the move
       * swapped against the neighbouring row in the *whole* catalog, so with a
       * category filter active the arrow appeared to do nothing: the row it
       * swapped with was filtered out of view. The order the user sees is the
       * order they are editing, so that is the order the swap happens in.
       *
       * Items outside the visible group keep their positions, and the moved item
       * takes the slot of the visible item it displaced — a partial view never
       * disturbs what it cannot show.
       */
      moveItemManually: (id, d, visibleIds?) => {
        const currentItems = get().items;
        const order = normOrder(currentItems, get().manualOrder);
        const globalIndex = order.indexOf(String(id));
        if (globalIndex < 0) return;

        const group = (visibleIds && visibleIds.length > 1
          ? visibleIds.map(String)
          : order
        ).filter((entry) => order.includes(entry));
        const groupIndex = group.indexOf(String(id));
        if (groupIndex < 0) return;
        const targetIndex = d === 'up' ? groupIndex - 1 : groupIndex + 1;
        if (targetIndex < 0 || targetIndex >= group.length) return;

        const targetId = group[targetIndex];
        const targetGlobal = order.indexOf(targetId);
        if (targetGlobal < 0) return;

        [order[globalIndex], order[targetGlobal]] = [order[targetGlobal], order[globalIndex]];
        set({
          sortMode: 'manual_locked',
          manualOrder: order,
          items: sortItems(currentItems, 'manual_locked', order),
        });
      },

      createItem: async (item, actorId, actorName) => {
        await syncItems([syncPayload(item)]);
        const nextItems = [...get().items, item];
        const normalized = normalizeCollections(nextItems, get().sortMode, [...get().manualOrder, String(item.id)], get().categories, get().units);

        set({
          items: normalized.items,
          balances: normalized.balances,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
        });
        toast.success('تم إضافة الصنف بنجاح');
      },

      updateItem: async (item, actorId, actorName) => {
        await syncItems([syncPayload(item)]);
        const nextItems = get().items.map((x) => (x.id === item.id ? item : x));
        const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder, get().categories, get().units);

        set({
          items: normalized.items,
          balances: normalized.balances,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
        });
        toast.success('تم تعديل الصنف بنجاح');
      },

      bulkUpdate: async (ids, patch, actorId, actorName) => {
        const setIds = new Set(ids);
        const updates = get().items.filter((i) => setIds.has(String(i.id))).map((i) => ({ ...i, ...patch }));
        if (!updates.length) return;

        await syncItems(updates.map(syncPayload));
        const byId = new Map(updates.map((i) => [String(i.id), i]));
        const nextItems = get().items.map((item) => byId.get(String(item.id)) || item);
        const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder, get().categories, get().units);

        set({
          items: normalized.items,
          balances: normalized.balances,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
        });
        toast.success(`تم تعديل ${ids.length} صنف بنجاح`);
      },

      updateStockFromTransaction: (transaction, action, oldTransaction) => {
        let nextItems = get().items;

        if (action === 'remove') {
          nextItems = applyDelta(nextItems, transaction, -1);
        } else if (action === 'add') {
          nextItems = applyDelta(nextItems, transaction, 1);
        } else {
          if (oldTransaction) {
            nextItems = applyDelta(nextItems, oldTransaction, -1);
          }
          nextItems = applyDelta(nextItems, transaction, 1);
        }

        const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder, get().categories, get().units);
        set({
          items: normalized.items,
          balances: normalized.balances,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
        });
      },

      softDelete: async (ids, actorName) => {
        // Phase 4: Call backend API for soft delete (archive)
        try {
          await archiveItems(ids);
          
          const soft = { ...get().soft };
          const now = Date.now();
          ids.forEach((id) => {
            soft[id] = { deletedAt: now, deletedBy: actorName };
          });
          set({ soft });
          toast.success('تم أرشفة الأصناف بنجاح');
        } catch (error: unknown) {
          console.error('Failed to archive items:', error);
          toast.error(getErrorMessage(error, 'فشل أرشفة الأصناف'));
          throw error;
        }
      },

      restore: async (ids) => {
        // Phase 4: Call backend API for restore
        try {
          await restoreItems(ids);
          
          const soft = { ...get().soft };
          ids.forEach((id) => delete soft[id]);
          set({ soft });
          toast.success('تم استعادة الأصناف بنجاح');
        } catch (error: unknown) {
          console.error('Failed to restore items:', error);
          toast.error(getErrorMessage(error, 'فشل استعادة الأصناف'));
          throw error;
        }
      },

      purge: async (ids, actorId, actorName) => {
        // Phase 4: Call backend API for permanent delete with audit logging
        try {
          await deleteItemsPermanently(ids);

          const soft = { ...get().soft };
          ids.forEach((id) => delete soft[id]);

          const setIds = new Set(ids);
          const nextItems = get().items.filter((item) => !setIds.has(String(item.id)));
          const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder.filter((id) => !setIds.has(id)), get().categories, get().units);

          set({
            items: normalized.items,
            balances: normalized.balances,
            categories: normalized.categories,
            units: normalized.units,
            manualOrder: normalized.manualOrder,
            soft,
          });
          toast.success('تم حذف الأصناف نهائياً بنجاح');
        } catch (error: unknown) {
          console.error('Failed to permanently delete items:', error);
          toast.error(getErrorMessage(error, 'فشل حذف الأصناف نهائياً'));
          throw error;
        }
      },
    })
);

export { sortItems, normOrder };
export type { SoftMap, SortState, ItemForm, BulkForm, InventoryAction, ActorInfo, OpeningBalanceStoreRow };

