// ENTERPRISE FIX: Phase 7 - Single Source of Truth for Items - 2026-03-01
// Zustand Store for Items - Single Owner Pattern

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from '@services/toastService';
import { deleteItemsByPublicIds, getItems as getItemsFromApi, syncItems, type ItemDto, type SyncItemPayload } from '@services/itemsService';
import { addAuditLog } from '../services/legacy/storage';
import type { Item, ItemSortMode } from '../types';

const SOFT_KEY = 'ff_items_soft_v1';
const SORT_KEY = 'ff_items_sort_v1';

type SoftMap = Record<string, { deletedAt: number; deletedBy: string }>;
type SortState = { mode: ItemSortMode; manualOrder: string[] };
type ItemForm = { id?: string; name: string; code: string; category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string; currentStock: string };
type BulkForm = { category: string; unit: string; minLimit: string; maxLimit: string; orderLimit: string };

type Store = {
  items: Item[];
  loading: boolean;
  error: string | null;
  soft: SoftMap;
  sortMode: ItemSortMode;
  manualOrder: string[];
  load: () => Promise<void>;
  setSortMode: (mode: ItemSortMode) => void;
  move: (id: string, d: 'up' | 'down') => void;
  createItem: (item: Item, actorId: string, actorName: string) => Promise<void>;
  updateItem: (item: Item, actorId: string, actorName: string) => Promise<void>;
  bulkUpdate: (ids: string[], patch: Partial<Item>, actorId: string, actorName: string) => Promise<void>;
  updateStockFromTransaction: (type: string, quantity: number, itemId: string) => void;
  softDelete: (ids: string[], actorName: string) => void;
  restore: (ids: string[]) => void;
  purge: (ids: string[], actorId: string, actorName: string) => Promise<void>;
};

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

const n = (v: unknown, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);

// ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - Blueprint Compliant - 2026-03-02
const cmp = (a: unknown, b: unknown) => String(a || '').localeCompare(String(b || ''), 'ar-EG', { numeric: true, sensitivity: 'base' });

const toDelta = (type: string, quantity: number): number => {
  if (!Number.isFinite(quantity)) return 0;
  const normalized = String(type).trim().toLowerCase();
  
  const inboundKeywords = ['in', 'purchase', 'incoming', 'import', 'production', '8�7�7�7�', '7�7�7�7', '7�8�7�8y7�', '7�8 7�7�7�'];
  const outboundKeywords = ['out', 'sale', 'outgoing', 'export', 'consumption', '7�7�7�7�', '7�8y7�', '7�7�8~', '7�7�88~', '7�7�7�8!87�8�'];

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
  name: r.name,
  code: r.code || undefined,
  barcode: r.barcode || undefined,
  category: r.category || '78y7� 8&7�8 8~',
  unit: r.unit || '87�7�7�',
  minLimit: n(r.minLimit, 0),
  maxLimit: n(r.maxLimit, 1000),
  orderLimit: r.orderLimit == null ? undefined : n(r.orderLimit, 0),
  currentStock: n(r.currentStock, 0),
  englishName: r.description || undefined,
  lastUpdated: new Date().toISOString()
});

const syncPayload = (i: Item): SyncItemPayload => ({
  publicId: String(i.id),
  name: i.name.trim(),
  code: i.code?.trim() || undefined,
  barcode: i.barcode?.trim() || undefined,
  category: i.category,
  unit: i.unit,
  minLimit: n(i.minLimit, 0),
  maxLimit: n(i.maxLimit, 1000),
  orderLimit: i.orderLimit == null ? undefined : n(i.orderLimit, 0),
  currentStock: n(i.currentStock, 0),
  description: i.englishName || undefined
});

const initialSort = read<SortState>(SORT_KEY, { mode: 'manual_locked', manualOrder: [] });

export const useInventoryStore = create<Store>()(
  persist(
    (set, get) => ({
      items: [],
      loading: false,
      error: null,
      soft: read<SoftMap>(SOFT_KEY, {}),
      sortMode: initialSort.mode,
      manualOrder: initialSort.manualOrder,

      load: async () => {
        set({ loading: true, error: null });
        try {
          // 1. Read pending deletes from localStorage
          const pendingDeletes = read<SoftMap>(SOFT_KEY, {});
          const deletedIds = new Set(Object.keys(pendingDeletes));

          // 2. Load from API
          const apiItems = await getItemsFromApi();
          const mappedItems = apiItems.map(dto);

          // 3. Filter out pending deletes
          const filteredItems = mappedItems.filter(item =>
            !deletedIds.has(String(item.id))
          );

          // 4. Update store
          const manualOrder = normOrder(filteredItems, get().manualOrder);
          set({
            items: filteredItems,
            manualOrder,
            loading: false
          });
          write(SORT_KEY, { mode: get().sortMode, manualOrder });

        } catch (e: any) {
          set({ loading: false, error: e?.message || 'Failed to load items' });
        }
      },

      setSortMode: (mode) => {
        const m = mode === 'manual_locked'
          ? get().items.map((i) => String(i.id))
          : normOrder(get().items, get().manualOrder);
        set({ sortMode: mode, manualOrder: m });
        write(SORT_KEY, { mode, manualOrder: m });
      },

      move: (id, d) => {
        if (get().sortMode !== 'manual_locked') return;
        const order = normOrder(get().items, get().manualOrder);
        const i = order.indexOf(id);
        const t = d === 'up' ? i - 1 : i + 1;
        if (i < 0 || t < 0 || t >= order.length) return;
        [order[i], order[t]] = [order[t], order[i]];
        set({ manualOrder: order });
        write(SORT_KEY, { mode: get().sortMode, manualOrder: order });
      },

      createItem: async (item, actorId, actorName) => {
        await syncItems([syncPayload(item)]);
        const items = [...get().items, item];
        const manualOrder = normOrder(items, [...get().manualOrder, String(item.id)]);
        set({ items, manualOrder });
        write(SORT_KEY, { mode: get().sortMode, manualOrder });

        await addAuditLog({
          userId: actorId,
          userName: actorName,
          event: 'item_create',
          details: `Created item: ${item.name} (${item.id})`
        });

        toast.success('7�8&7� 7�7�7�8~7� 7�87�8 8~ 7�8 7�7�7�');
      },

      updateItem: async (item, actorId, actorName) => {
        await syncItems([syncPayload(item)]);
        set({ items: get().items.map((x) => (x.id === item.id ? item : x)) });

        await addAuditLog({
          userId: actorId,
          userName: actorName,
          event: 'item_update',
          details: `Updated item: ${item.name} (${item.id})`
        });

        toast.success('7�8& 7�7�7�8y8 7�87�8 8~ 7�8 7�7�7�');
      },

      bulkUpdate: async (ids, patch, actorId, actorName) => {
        const setIds = new Set(ids);
        const updates = get().items.filter((i) => setIds.has(String(i.id))).map((i) => ({ ...i, ...patch }));
        if (!updates.length) return;

        await syncItems(updates.map(syncPayload));
        const byId = new Map(updates.map((i) => [String(i.id), i]));
        set({ items: get().items.map((i) => byId.get(String(i.id)) || i) });

        await addAuditLog({
          userId: actorId,
          userName: actorName,
          event: 'items_bulk_update',
          details: `Bulk updated ${ids.length} items`
        });

        toast.success(`7�8& 7�7�7�8y7� ${ids.length} 7�8 8~ 7�8 7�7�7�`);
      },

      updateStockFromTransaction: (type, quantity, itemId) => {
        const delta = toDelta(type, Number(quantity));
        if (delta === 0) return;
        set((state) => ({
          items: state.items.map((item) =>
            String(item.id) === String(itemId)
              ? { ...item, currentStock: Number(item.currentStock) + delta }
              : item
          ),
        }));
      },

      softDelete: (ids, actorName) => {
        const soft = { ...get().soft };
        const now = Date.now();
        ids.forEach((id) => {
          soft[id] = { deletedAt: now, deletedBy: actorName };
        });
        set({ soft });
        write(SOFT_KEY, soft);
        toast.success('7�8& 8 88 7�87�7�8 7�8~ 7�880 7�87�7�7�8y8~');
      },

      restore: (ids) => {
        const soft = { ...get().soft };
        ids.forEach((id) => delete soft[id]);
        set({ soft });
        write(SOFT_KEY, soft);
        toast.success('7�8& 7�7�7�7�7�7�7� 7�87�7�8 7�8~ 8&8  7�87�7�7�8y8~');
      },

      purge: async (ids, actorId, actorName) => {
        // 1. Delete from API and wait for confirmation
        await deleteItemsByPublicIds(ids);

        // 2. Update localStorage
        const soft = { ...get().soft };
        ids.forEach((id) => delete soft[id]);
        set({ soft });
        write(SOFT_KEY, soft);

        // 3. Update store
        const setIds = new Set(ids);
        const items = get().items.filter((i) => !setIds.has(String(i.id)));
        const manualOrder = normOrder(items, get().manualOrder.filter((id) => !setIds.has(id)));
        set({ items, soft, manualOrder });
        write(SORT_KEY, { mode: get().sortMode, manualOrder });

        // 4. Audit log
        await addAuditLog({
          userId: actorId,
          userName: actorName,
          event: 'items_delete',
          details: `Permanently deleted ${ids.length} items: ${ids.join(', ')}`
        });

        // 5. Notify user
        toast.success('7�8& 7�87�7�8~ 8 8!7�7�8y7�89');
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
export type { SoftMap, SortState, ItemForm, BulkForm };

