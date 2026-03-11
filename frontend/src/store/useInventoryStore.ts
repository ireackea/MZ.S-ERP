// ENTERPRISE FIX: Phase 1 - Single Source of Truth & Integration - 2026-03-05
// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
// ENTERPRISE FIX: Phase 7 - Single Source of Truth for Items - 2026-03-01
// Zustand Store for Items - Single Owner Pattern

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from '@services/toastService';
import {
  deleteItemsByPublicIds,
  getItems as getItemsFromApi,
  syncItems,
  type ItemDto,
  type SyncItemPayload,
} from '@services/itemsService';
import { getTransactionsFromApi } from '@services/transactionsService';
import { fetchRoles, fetchUsers, type RoleDto, type UserDto } from '@services/usersService';
import {
  addAuditLog,
  getCategories,
  getTransactions,
  getUnits,
  getUsers,
  saveCategories,
  saveUnits,
} from '../services/storage';
import { getIamConfig, normalizeUsers } from '../services/iamService';
import type { Item, ItemSortMode, RoleDefinition, Transaction, User } from '../types';

const SOFT_KEY = 'ff_items_soft_v1';
const SORT_KEY = 'ff_items_sort_v1';

type SoftMap = Record<string, { deletedAt: number; deletedBy: string }>;
type SortState = { mode: ItemSortMode; manualOrder: string[] };
type ItemForm = { id?: string; name: string; code: string; category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string; currentStock: string };
type BulkForm = { category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string };
type InventoryAction = 'add' | 'remove' | 'update';
type ActorInfo = { id: string; name: string };

type Store = {
  items: Item[];
  balances: Record<string, number>;
  transactions: Transaction[];
  users: User[];
  roles: RoleDefinition[];
  units: string[];
  categories: string[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  soft: SoftMap;
  sortMode: ItemSortMode;
  manualOrder: string[];
  load: () => Promise<void>;
  loadAll: () => Promise<void>;
  syncFromServer: () => Promise<void>;
  setTransactions: (transactions: Transaction[]) => void;
  setUsers: (users: User[]) => void;
  setRoles: (roles: RoleDefinition[]) => void;
  setReferenceData: (data: { units?: string[]; categories?: string[] }) => void;
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

const DEFAULT_ACTOR: ActorInfo = { id: 'system', name: 'InventoryStore' };

const read = <T,>(k: string, f: T): T => {
  try {
    const r = localStorage.getItem(k);
    return r ? (JSON.parse(r) as T) : f;
  } catch {
    return f;
  }
};

const write = <T,>(k: string, v: T) => {
  localStorage.setItem(k, JSON.stringify(v));
};

const getPendingDeletedIds = () => new Set(Object.keys(read<SoftMap>(SOFT_KEY, {})));

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

const initialSort = read<SortState>(SORT_KEY, { mode: 'manual_locked', manualOrder: [] });

export const useInventoryStore = create<Store>()(
  persist(
    (set, get) => ({
      items: [],
      balances: {},
      transactions: [],
      users: [],
      roles: [],
      units: [],
      categories: [],
      loading: false,
      syncing: false,
      error: null,
      lastLoadedAt: null,
      soft: read<SoftMap>(SOFT_KEY, {}),
      sortMode: initialSort.mode,
      manualOrder: initialSort.manualOrder,

      load: async () => {
        set({ loading: true, error: null });
        try {
          const deletedIds = getPendingDeletedIds();
          const apiItems = await getItemsFromApi();
          const mappedItems = apiItems.map(dto).filter((item) => !deletedIds.has(String(item.id)));
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

          write(SORT_KEY, { mode: get().sortMode, manualOrder: normalized.manualOrder });
          saveCategories(normalized.categories);
          saveUnits(normalized.units);
        } catch (e: any) {
          set({ loading: false, error: e?.message || 'Failed to load items' });
        }
      },

      loadAll: async () => {
        const localTransactions = getTransactions();
        const localUsers = normalizeUsers(getUsers());
        const localRoles = getIamConfig().roles;
        const localCategories = uniqueStrings(getCategories() || []);
        const localUnits = uniqueStrings(getUnits() || []);

        set((state) => ({
          loading: true,
          error: null,
          transactions: localTransactions,
          users: localUsers,
          roles: localRoles,
          categories: uniqueStrings([...state.categories, ...localCategories]),
          units: uniqueStrings([...state.units, ...localUnits]),
        }));

        try {
          await get().syncFromServer();
        } finally {
          set({ loading: false, lastLoadedAt: Date.now() });
        }
      },

      syncFromServer: async () => {
        set({ syncing: true, error: null });

        const deletedIds = getPendingDeletedIds();
        const fallbackTransactions = get().transactions.length > 0 ? get().transactions : getTransactions();
        const fallbackUsers = get().users.length > 0 ? get().users : normalizeUsers(getUsers());
        const fallbackRoles = get().roles.length > 0 ? get().roles : getIamConfig().roles;
        const fallbackCategories = uniqueStrings([...(getCategories() || []), ...get().categories]);
        const fallbackUnits = uniqueStrings([...(getUnits() || []), ...get().units]);

        const [itemsResult, transactionsResult, usersResult, rolesResult] = await Promise.allSettled([
          getItemsFromApi(),
          getTransactionsFromApi(),
          fetchUsers({ page: 1, limit: 500 }),
          fetchRoles(),
        ]);

        const nextItems = itemsResult.status === 'fulfilled'
          ? itemsResult.value.map(dto).filter((item) => !deletedIds.has(String(item.id)))
          : get().items;
        const nextTransactions = transactionsResult.status === 'fulfilled' ? transactionsResult.value : fallbackTransactions;
        const nextUsers = usersResult.status === 'fulfilled' ? normalizeUsers(usersResult.value.data.map(mapUserDto)) : fallbackUsers;
        const nextRoles = rolesResult.status === 'fulfilled' ? rolesResult.value.map(mapRoleDto) : fallbackRoles;

        const normalized = normalizeCollections(nextItems, get().sortMode, get().manualOrder, fallbackCategories, fallbackUnits);
        const failures = [itemsResult, transactionsResult, usersResult, rolesResult].filter((result) => result.status === 'rejected');

        set({
          items: normalized.items,
          balances: normalized.balances,
          transactions: nextTransactions,
          users: nextUsers,
          roles: nextRoles,
          categories: normalized.categories,
          units: normalized.units,
          manualOrder: normalized.manualOrder,
          syncing: false,
          error: failures.length > 0 ? 'تم تحميل جزء من البيانات مع استخدام بعض النسخ المحلية الاحتياطية.' : null,
          lastLoadedAt: Date.now(),
        });

        write(SORT_KEY, { mode: get().sortMode, manualOrder: normalized.manualOrder });
        saveCategories(normalized.categories);
        saveUnits(normalized.units);
      },

      setTransactions: (transactions) => {
        set({ transactions: [...transactions] });
      },

      setUsers: (users) => {
        set({ users: normalizeUsers(users) });
      },

      setRoles: (roles) => {
        set({ roles: [...roles] });
      },

      setReferenceData: ({ units, categories }) => {
        set((state) => {
          const nextUnits = units ? uniqueStrings(units) : state.units;
          const nextCategories = categories ? uniqueStrings(categories) : state.categories;
          saveUnits(nextUnits);
          saveCategories(nextCategories);
          return { units: nextUnits, categories: nextCategories };
        });
      },

      addUnit: (unit) => {
        const normalized = String(unit || '').trim();
        if (!normalized) return;
        set((state) => {
          const units = uniqueStrings([...state.units, normalized]);
          saveUnits(units);
          return { units };
        });
      },

      deleteUnit: (unit) => {
        const target = String(unit || '').trim().toLowerCase();
        set((state) => {
          const units = state.units.filter((entry) => entry.trim().toLowerCase() !== target);
          saveUnits(units);
          return { units };
        });
      },

      addCategory: (category) => {
        const normalized = String(category || '').trim();
        if (!normalized) return;
        set((state) => {
          const categories = uniqueStrings([...state.categories, normalized]);
          saveCategories(categories);
          return { categories };
        });
      },

      deleteCategory: (category) => {
        const target = String(category || '').trim().toLowerCase();
        set((state) => {
          const categories = state.categories.filter((entry) => entry.trim().toLowerCase() !== target);
          saveCategories(categories);
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
        write(SORT_KEY, { mode, manualOrder: nextManualOrder });
      },

      lockCurrentItemOrder: () => {
        const nextManualOrder = get().items.map((item) => String(item.id));
        set({ sortMode: 'manual_locked', manualOrder: nextManualOrder });
        write(SORT_KEY, { mode: 'manual_locked', manualOrder: nextManualOrder });
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
        write(SORT_KEY, { mode: get().sortMode, manualOrder: order });
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
        write(SORT_KEY, { mode: get().sortMode, manualOrder: normalized.manualOrder });
        saveCategories(normalized.categories);
        saveUnits(normalized.units);

        await addAuditLog({ userId: actorId, userName: actorName, action: 'CREATE', entity: 'ITEM', details: `Created item: ${item.name} (${item.id})` });
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

        await addAuditLog({ userId: actorId, userName: actorName, action: 'UPDATE', entity: 'ITEM', details: `Updated item: ${item.name} (${item.id})` });
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

        await addAuditLog({ userId: actorId, userName: actorName, action: 'UPDATE', entity: 'ITEM', details: `Bulk updated ${ids.length} items` });
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

      softDelete: (ids, actorName) => {
        const soft = { ...get().soft };
        const now = Date.now();
        ids.forEach((id) => {
          soft[id] = { deletedAt: now, deletedBy: actorName };
        });
        set({ soft });
        write(SOFT_KEY, soft);
        toast.success('تم تصنيف الأصناف كمحذوفة بنجاح');
      },

      restore: (ids) => {
        const soft = { ...get().soft };
        ids.forEach((id) => delete soft[id]);
        set({ soft });
        write(SOFT_KEY, soft);
        toast.success('تم استعادة الأصناف بنجاح');
      },

      purge: async (ids, actorId, actorName) => {
        await deleteItemsByPublicIds(ids);

        const soft = { ...get().soft };
        ids.forEach((id) => delete soft[id]);
        write(SOFT_KEY, soft);

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

        write(SORT_KEY, { mode: get().sortMode, manualOrder: normalized.manualOrder });

        await addAuditLog({ userId: actorId, userName: actorName, action: 'DELETE', entity: 'ITEM', details: `Permanently deleted ${ids.length} items: ${ids.join(', ')}` });
        toast.success('تم حذف الأصناف نهائياً بنجاح');
      },
    }),
    {
      name: 'ff_inventory_store_v1',
      partialize: (state) => ({
        soft: state.soft,
        sortMode: state.sortMode,
        manualOrder: state.manualOrder,
      }),
    }
  )
);

export { sortItems, normOrder, read, write, SOFT_KEY, SORT_KEY };
export type { SoftMap, SortState, ItemForm, BulkForm, InventoryAction, ActorInfo };

