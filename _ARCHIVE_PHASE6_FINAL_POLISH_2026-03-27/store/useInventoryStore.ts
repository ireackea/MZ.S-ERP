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
import { fetchRoles, fetchUsers, type RoleDto, type UserDto } from '@services/usersService';
import apiClient from '@api/client';
import { normalizeUsers } from '../services/iamService';
import type {
  Formula,
  GridColumnPreference,
  Item,
  ItemSortMode,
  ReportColumnConfig,
  RoleDefinition,
  SystemSettings,
  Transaction,
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
type SyncTarget = 'all' | 'items' | 'transactions' | 'openingBalances' | 'users' | 'formulas';
type ExportSheet = {
  name: string;
  rows: unknown[][];
  columns?: Array<{ wch: number }>;
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
  soft: SoftMap;
  sortMode: ItemSortMode;
  manualOrder: string[];
  load: () => Promise<void>;
  loadAll: () => Promise<void>;
  loadOpeningBalances: (financialYear?: number) => Promise<void>;
  loadFormulas: () => Promise<void>;
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
  addUnit: (unit: string) => void;
  deleteUnit: (unit: string) => void;
  addCategory: (category: string) => void;
  deleteCategory: (category: string) => void;
  addItems: (items: Item[], actor?: ActorInfo) => Promise<void>;
  updateItems: (items: Item[], actor?: ActorInfo) => Promise<void>;
  deleteItems: (ids: string[], actor?: ActorInfo) => Promise<void>;
  setSortMode: (mode: ItemSortMode) => void;
  lockCurrentItemOrder: () => void;
  move: (id: string, d: 'up' | 'down') => void;
  moveItemManually: (id: string, d: 'up' | 'down') => void;
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

const inboundKeywords = ['in', 'purchase', 'incoming', 'import', 'production', 'وارد', 'شراء', 'إنتاج', 'دخول'];
const outboundKeywords = ['out', 'sale', 'outgoing', 'export', 'consumption', 'صادر', 'صرف', 'بيع', 'استهلاك', 'تالف'];

const toDelta = (type: string, quantity: number): number => {
  if (!Number.isFinite(quantity)) return 0;
  const normalized = String(type).trim().toLowerCase();

  if (inboundKeywords.some((keyword) => normalized.includes(keyword))) return Math.abs(quantity);
  if (outboundKeywords.some((keyword) => normalized.includes(keyword))) return -Math.abs(quantity);

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
  code: r.code || undefined,
  barcode: r.barcode || undefined,
  category: r.category || 'تصنيف عام',
  unit: r.unit || 'وحدة',
  minLimit: n(r.minLimit, 0),
  maxLimit: n(r.maxLimit, 1000),
  orderLimit: r.orderLimit == null ? undefined : n(r.orderLimit, 0),
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
  currentStock: n(i.currentStock, 0),
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
  permissions: row.role?.permissionsList || [],
  active: row.isActive,
  isActive: row.isActive,
  status: row.isActive ? 'active' : 'suspended',
  scope: 'all',
  twoFactorEnabled: false,
  twoFaEnabled: false,
  mustChangePassword: false,
});

const mapRoleDto = (row: RoleDto): RoleDefinition => {
  const permissions = row.permissionsList.length > 0
    ? row.permissionsList
    : (() => {
        try {
          const parsed = JSON.parse(row.permissions || '[]');
          return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
        } catch {
          return [];
        }
      })();

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    permissionIds: permissions,
  };
};

const normalizeOpeningBalanceRows = (rows: Array<{ item_id?: string; itemId?: string; quantity?: number }>) =>
  rows.reduce<OpeningBalanceMap>((acc, row) => {
    const itemId = String(row.itemId || row.item_id || '').trim();
    const quantity = Number(row.quantity || 0);
    if (!itemId || !Number.isFinite(quantity)) return acc;
    acc[itemId] = quantity;
    return acc;
  }, {});

const normalizeOpeningBalanceStoreRows = (rows: any[], financialYear: number): OpeningBalanceStoreRow[] =>
  rows.reduce<OpeningBalanceStoreRow[]>((acc, row, index) => {
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

const mapApiOpeningBalances = (rows: any[]) =>
  rows.reduce<OpeningBalanceMap>((acc, row) => {
    const itemId = String(row?.itemPublicId ?? row?.item?.publicId ?? row?.itemId ?? '').trim();
    const quantity = Number(row?.quantity ?? 0);
    if (!itemId || !Number.isFinite(quantity)) return acc;
    acc[itemId] = quantity;
    return acc;
  }, {});

const normalizeFormula = (raw: any): Formula => ({
  id: String(raw?.id || crypto.randomUUID()),
  code: String(raw?.code || ''),
  name: String(raw?.name || ''),
  targetProductId: String(raw?.targetProductId || raw?.targetItemId || ''),
  isActive: raw?.isActive !== false,
  notes: raw?.notes ? String(raw.notes) : undefined,
  items: Array.isArray(raw?.items)
    ? raw.items.map((entry: any) => ({
        itemId: String(entry?.itemId || ''),
        percentage: Number(entry?.percentage || 0),
        weightPerTon: Number(entry?.weightPerTon || 0),
      }))
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

const extractArrayPayload = (payload: any) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const currentFinancialYear = () => getFinancialYearFromDate();

const syncItemsFromServer = async () => {
  // Phase 4: Load all items with pagination (load first 1000 items by default)
  const result = await getItemsFromApi({ page: 1, limit: 1000, isArchived: false });
  return result.data.map(dto);
};

const syncTransactionsFromServer = async () => {
  return getTransactionsFromApi();
};

const syncOpeningBalancesFromServer = async (financialYear: number) => {
  const rows = await getOpeningBalancesFromApi(financialYear);
  return {
    openingBalances: Array.isArray(rows) ? mapApiOpeningBalances(rows) : {},
    openingBalanceRows: Array.isArray(rows) ? normalizeOpeningBalanceStoreRows(rows, financialYear) : [],
  };
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
  return extractArrayPayload(response.data).map(normalizeFormula);
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

let xlsxLoader: Promise<typeof import('xlsx')> | null = null;
let html2PdfLoader: Promise<any> | null = null;

const loadXlsx = () => {
  if (!xlsxLoader) {
    xlsxLoader = import('xlsx');
  }
  return xlsxLoader;
};

const loadHtml2Pdf = async () => {
  if (!html2PdfLoader) {
    html2PdfLoader = import('html2pdf.js');
  }
  const module = await html2PdfLoader;
  return (module as { default?: any }).default || module;
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
      gridPreferences: {},
      gridDisplayPolicies: {},
      operationPrintConfig: {},
      operationPrintTemplates: [],
      stocktakingPrintConfig: {},
      stocktakingPrintTemplates: [],
      loading: false,
      syncing: false,
      error: null,
      lastLoadedAt: null,
      soft: {},
      sortMode: initialSort.mode,
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
        } catch (e: any) {
          set({ loading: false, error: e?.message || 'Failed to load items' });
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

      loadOpeningBalances: async (financialYear = currentFinancialYear()) => {
        set({ openingBalancesLoading: true, openingBalancesError: null });

        try {
          const rows = await getOpeningBalancesFromApi(financialYear);
          const nextOpeningBalanceRows = Array.isArray(rows) ? normalizeOpeningBalanceStoreRows(rows, financialYear) : [];
          const nextOpeningBalances = Array.isArray(rows) ? mapApiOpeningBalances(rows) : {};

          set({
            openingBalances: nextOpeningBalances,
            openingBalanceRows: nextOpeningBalanceRows,
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
          set({ formulas: [...formulas] });
        } catch (error: any) {
          set({ error: error?.message || 'تعذر تحميل التركيبات من الخادم.' });
          throw error;
        }
      },

      syncFromServer: async (target = 'all') => {
        set({ syncing: true, error: null });

        const openingBalanceYear = get().openingBalancesYear ?? currentFinancialYear();
        const shouldLoadItems = target === 'all' || target === 'items';
        const shouldLoadTransactions = target === 'all' || target === 'transactions';
        const shouldLoadOpeningBalances = target === 'all' || target === 'openingBalances';
        const shouldLoadUsers = target === 'all' || target === 'users';
        const shouldLoadRoles = target === 'all' || target === 'users';
        const shouldLoadFormulas = target === 'all' || target === 'formulas';

        const [itemsResult, transactionsResult, openingBalancesResult, usersResult, rolesResult, formulasResult] = await Promise.allSettled([
          shouldLoadItems ? syncItemsFromServer() : Promise.resolve(null),
          shouldLoadTransactions ? syncTransactionsFromServer() : Promise.resolve(null),
          shouldLoadOpeningBalances ? syncOpeningBalancesFromServer(openingBalanceYear) : Promise.resolve(null),
          shouldLoadUsers ? syncUsersFromServer() : Promise.resolve(null),
          shouldLoadRoles ? syncRolesFromServer() : Promise.resolve(null),
          shouldLoadFormulas ? syncFormulasFromServer() : Promise.resolve(null),
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
        const nextUsers = shouldLoadUsers && usersResult.status === 'fulfilled' && Array.isArray(usersResult.value)
          ? usersResult.value
          : current.users;
        const nextRoles = shouldLoadRoles && rolesResult.status === 'fulfilled' && Array.isArray(rolesResult.value)
          ? rolesResult.value
          : current.roles;
        const nextFormulas = shouldLoadFormulas && formulasResult.status === 'fulfilled' && Array.isArray(formulasResult.value)
          ? formulasResult.value
          : current.formulas;

        const normalized = normalizeCollections(nextItems, current.sortMode, current.manualOrder, current.categories, current.units);
        const failures = [
          shouldLoadItems ? itemsResult : null,
          shouldLoadTransactions ? transactionsResult : null,
          shouldLoadOpeningBalances ? openingBalancesResult : null,
          shouldLoadUsers ? usersResult : null,
          shouldLoadRoles ? rolesResult : null,
          shouldLoadFormulas ? formulasResult : null,
        ].filter((result): result is PromiseRejectedResult | PromiseFulfilledResult<unknown> => result !== null)
          .filter((result) => result.status === 'rejected');

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
          formulas: nextFormulas,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
          syncing: false,
          error: failures.length > 0 ? 'تعذر تحميل بعض البيانات من الخادم.' : null,
          lastLoadedAt: Date.now(),
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
        set({ systemSettings: { ...DEFAULT_SYSTEM_SETTINGS, ...settings } });
      },

      setUnloadingRules: (rules) => {
        set({ unloadingRules: [...rules] });
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
      },

      resetGridPreferences: (moduleKey, defaults) => {
        set((state) => ({
          gridPreferences: {
            ...state.gridPreferences,
            [moduleKey]: normalizeGridPreferences(defaults, defaults),
          },
        }));
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
        set({ operationPrintConfig: { ...config } });
      },

      setOperationPrintTemplates: (templates) => {
        set({ operationPrintTemplates: [...templates] });
      },

      setStocktakingPrintConfig: (config) => {
        set({ stocktakingPrintConfig: { ...config } });
      },

      setStocktakingPrintTemplates: (templates) => {
        set({ stocktakingPrintTemplates: [...templates] });
      },

      exportRowsToExcel: async ({ fileName, sheetName = 'Sheet1', rows }) => {
        const XLSX = await loadXlsx();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
        XLSX.writeFile(workbook, fileName);
      },

      exportSheetsToExcel: async ({ fileName, sheets }) => {
        const XLSX = await loadXlsx();
        const workbook = XLSX.utils.book_new();

        sheets.forEach((sheet, index) => {
          const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
          if (sheet.columns) {
            worksheet['!cols'] = sheet.columns;
          }
          XLSX.utils.book_append_sheet(
            workbook,
            worksheet,
            (sheet.name || `Sheet${index + 1}`).slice(0, 31)
          );
        });

        XLSX.writeFile(workbook, fileName);
      },

      exportPdfReport: async ({ endpoint, payload, fileName }) => {
        const response = await apiClient.post(endpoint, normalizePdfPayload(payload, fileName), { responseType: 'blob' });
        const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: 'application/pdf' });
        triggerBlobDownload(blob, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
      },

      exportElementToPdf: async ({ element, fileName, jsPdfOptions = {} }) => {
        const html2pdf = await loadHtml2Pdf();

        await html2pdf()
          .set({
            margin: 8,
            filename: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: {
              unit: 'mm',
              format: 'a4',
              orientation: 'landscape',
              ...jsPdfOptions,
            },
            pagebreak: { mode: ['css', 'legacy'] },
          })
          .from(element)
          .save();
      },

      setReferenceData: ({ units, categories }) => {
        set((state) => {
          const nextUnits = units ? uniqueStrings(units) : state.units;
          const nextCategories = categories ? uniqueStrings(categories) : state.categories;
          return { units: nextUnits, categories: nextCategories };
        });
      },

      addUnit: (unit) => {
        const normalized = String(unit || '').trim();
        if (!normalized) return;
        set((state) => {
          const units = uniqueStrings([...state.units, normalized]);
          return { units };
        });
      },

      deleteUnit: (unit) => {
        const target = String(unit || '').trim().toLowerCase();
        set((state) => {
          const units = state.units.filter((entry) => entry.trim().toLowerCase() !== target);
          return { units };
        });
      },

      addCategory: (category) => {
        const normalized = String(category || '').trim();
        if (!normalized) return;
        set((state) => {
          const categories = uniqueStrings([...state.categories, normalized]);
          return { categories };
        });
      },

      deleteCategory: (category) => {
        const target = String(category || '').trim().toLowerCase();
        set((state) => {
          const categories = state.categories.filter((entry) => entry.trim().toLowerCase() !== target);
          return { categories };
        });
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

      setSortMode: (mode) => {
        const currentItems = get().items;
        const nextManualOrder = mode === 'manual_locked' ? currentItems.map((item) => String(item.id)) : normOrder(currentItems, get().manualOrder);
        const sorted = sortItems(currentItems, mode, nextManualOrder);
        set({ sortMode: mode, manualOrder: nextManualOrder, items: sorted });
      },

      lockCurrentItemOrder: () => {
        const nextManualOrder = get().items.map((item) => String(item.id));
        set({ sortMode: 'manual_locked', manualOrder: nextManualOrder });
      },

      move: (id, d) => {
        if (get().sortMode !== 'manual_locked') return;
        const order = normOrder(get().items, get().manualOrder);
        const i = order.indexOf(id);
        const t = d === 'up' ? i - 1 : i + 1;
        if (i < 0 || t < 0 || t >= order.length) return;
        [order[i], order[t]] = [order[t], order[i]];
        const sorted = sortItems(get().items, get().sortMode, order);
        set({ manualOrder: order, items: sorted });
      },

      moveItemManually: (id, d) => {
        if (get().sortMode !== 'manual_locked') {
          get().lockCurrentItemOrder();
        }
        get().move(id, d);
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
        } catch (error: any) {
          console.error('Failed to archive items:', error);
          toast.error(error?.message || 'فشل أرشفة الأصناف');
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
        } catch (error: any) {
          console.error('Failed to restore items:', error);
          toast.error(error?.message || 'فشل استعادة الأصناف');
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
        } catch (error: any) {
          console.error('Failed to permanently delete items:', error);
          toast.error(error?.message || 'فشل حذف الأصناف نهائياً');
          throw error;
        }
      },
    })
);

export { sortItems, normOrder };
export type { SoftMap, SortState, ItemForm, BulkForm, InventoryAction, ActorInfo, OpeningBalanceStoreRow };

