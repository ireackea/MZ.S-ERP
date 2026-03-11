// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getCategories,
  getItemSortSettings,
  getItems as getStoredItems,
  getUnits,
  saveCategories,
  saveItemSortSettings,
  saveItems,
  saveUnits,
} from '../services/storage';
import { SORT_KEY, normOrder, sortItems, useInventoryStore, write } from '../store/useInventoryStore';
import type { Item, ItemSortMode, Transaction } from '../types';

type InventoryAction = 'add' | 'remove' | 'update';

interface InventoryContextType {
  items: Item[];
  units: string[];
  categories: string[];
  isLoading: boolean;
  addUnit: (unit: string) => void;
  deleteUnit: (unit: string) => void;
  addCategory: (category: string) => void;
  deleteCategory: (category: string) => void;
  addItems: (items: Item[]) => Promise<void>;
  updateItems: (items: Item[]) => Promise<void>;
  deleteItems: (ids: string[]) => Promise<void>;
  itemSortMode: ItemSortMode;
  setItemSortMode: (mode: ItemSortMode) => void;
  lockCurrentItemOrder: () => void;
  moveItemManually: (id: string, direction: 'up' | 'down') => void;
  updateStockFromTransaction: (
    transaction: Transaction,
    action: InventoryAction,
    oldTransaction?: Transaction,
  ) => void;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

const DEFAULT_ACTOR = {
  id: 'system',
  name: 'InventoryContext',
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const uniqueStrings = (rows: string[]) => {
  const seen = new Set<string>();
  return rows
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeItem = (item: Item): Item => ({
  ...item,
  id: String(item.id || crypto.randomUUID()),
  name: String(item.name || '').trim(),
  code: item.code ? String(item.code).trim() : undefined,
  category: String(item.category || '').trim(),
  unit: String(item.unit || '').trim(),
  minLimit: toNumber(item.minLimit, 0),
  maxLimit: toNumber(item.maxLimit, 1000),
  orderLimit: item.orderLimit == null ? undefined : toNumber(item.orderLimit, 0),
  currentStock: toNumber(item.currentStock, 0),
  lastUpdated: item.lastUpdated || new Date().toISOString(),
});

const sameOrder = (left: Item[], right: Item[]) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (String(left[index]?.id) !== String(right[index]?.id)) return false;
  }
  return true;
};

const inboundKeywords = [
  'in',
  'purchase',
  'incoming',
  'import',
  'production',
  'return',
  'وارد',
  'استلام',
  'شراء',
  'إضافة',
  'اضافة',
  'إنتاج',
  'انتاج',
  'مرتجع',
];

const outboundKeywords = [
  'out',
  'sale',
  'outgoing',
  'export',
  'consumption',
  'damage',
  'صادر',
  'صرف',
  'بيع',
  'استهلاك',
  'تالف',
  'تحويل_صادر',
  'تحويل صادر',
  'سحب',
];

const getTransactionDelta = (type: string, quantity: number) => {
  if (!Number.isFinite(quantity)) return 0;
  const normalizedType = String(type || '').trim().toLowerCase();
  if (inboundKeywords.some((keyword) => normalizedType.includes(keyword.toLowerCase()))) {
    return Math.abs(quantity);
  }
  if (outboundKeywords.some((keyword) => normalizedType.includes(keyword.toLowerCase()))) {
    return -Math.abs(quantity);
  }
  return 0;
};

export const InventoryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const storeItems = useInventoryStore((state) => state.items);
  const storeLoading = useInventoryStore((state) => state.loading);
  const storeError = useInventoryStore((state) => state.error);
  const sortMode = useInventoryStore((state) => state.sortMode);
  const manualOrder = useInventoryStore((state) => state.manualOrder);
  const loadItems = useInventoryStore((state) => state.load);
  const createItem = useInventoryStore((state) => state.createItem);
  const updateItem = useInventoryStore((state) => state.updateItem);
  const move = useInventoryStore((state) => state.move);
  const setSortMode = useInventoryStore((state) => state.setSortMode);
  const purge = useInventoryStore((state) => state.purge);

  const [units, setUnits] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const sortedItems = useMemo(() => {
    const nextOrder = normOrder(storeItems, manualOrder);
    return sortItems(storeItems, sortMode, nextOrder);
  }, [manualOrder, sortMode, storeItems]);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const nextUnits = uniqueStrings(getUnits() || []);
      const nextCategories = uniqueStrings(getCategories() || []);
      const storedItems = (getStoredItems() || []).map(normalizeItem);
      const storedSortSettings = getItemSortSettings();

      if (!active) return;
      setUnits(nextUnits);
      setCategories(nextCategories);

      if (storedItems.length > 0 || storedSortSettings.manualOrder.length > 0) {
        const baseItems =
          useInventoryStore.getState().items.length > 0 ? useInventoryStore.getState().items : storedItems;
        const nextManualOrder = normOrder(baseItems, storedSortSettings.manualOrder);
        useInventoryStore.setState((state) => ({
          ...state,
          sortMode: storedSortSettings.mode || state.sortMode,
          manualOrder: nextManualOrder,
          items:
            state.items.length > 0
              ? sortItems(state.items, storedSortSettings.mode || state.sortMode, nextManualOrder)
              : sortItems(storedItems, storedSortSettings.mode || state.sortMode, nextManualOrder),
        }));
      }

      await loadItems();

      if (!active) return;

      const nextState = useInventoryStore.getState();
      if (nextState.error && storedItems.length > 0) {
        const fallbackOrder = normOrder(storedItems, storedSortSettings.manualOrder);
        useInventoryStore.setState((state) => ({
          ...state,
          loading: false,
          error: null,
          items: sortItems(storedItems, storedSortSettings.mode || state.sortMode, fallbackOrder),
          sortMode: storedSortSettings.mode || state.sortMode,
          manualOrder: fallbackOrder,
        }));
      }

      setBootstrapped(true);
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [loadItems]);

  useEffect(() => {
    if (!bootstrapped) return;
    saveUnits(units);
  }, [bootstrapped, units]);

  useEffect(() => {
    if (!bootstrapped) return;
    saveCategories(categories);
  }, [bootstrapped, categories]);

  useEffect(() => {
    if (!bootstrapped) return;

    const nextManualOrder = normOrder(sortedItems, manualOrder);
    saveItems(sortedItems);
    saveItemSortSettings({ mode: sortMode, manualOrder: nextManualOrder });
    write(SORT_KEY, { mode: sortMode, manualOrder: nextManualOrder });

    if (!sameOrder(storeItems, sortedItems) || manualOrder.length !== nextManualOrder.length) {
      useInventoryStore.setState((state) => ({
        ...state,
        items: sortedItems,
        manualOrder: nextManualOrder,
      }));
    }
  }, [bootstrapped, manualOrder, sortMode, sortedItems, storeItems]);

  const enqueueMutation = useCallback(<T,>(task: () => Promise<T>) => {
    const nextTask = mutationQueueRef.current.then(task, task);
    mutationQueueRef.current = nextTask.then(
      () => undefined,
      () => undefined,
    );
    return nextTask;
  }, []);

  const addUnit = useCallback((unit: string) => {
    const normalized = String(unit || '').trim();
    if (!normalized) return;
    setUnits((current) => uniqueStrings([...current, normalized]));
  }, []);

  const deleteUnit = useCallback((unit: string) => {
    const target = String(unit || '').trim().toLowerCase();
    setUnits((current) => current.filter((entry) => entry.trim().toLowerCase() !== target));
  }, []);

  const addCategory = useCallback((category: string) => {
    const normalized = String(category || '').trim();
    if (!normalized) return;
    setCategories((current) => uniqueStrings([...current, normalized]));
  }, []);

  const deleteCategory = useCallback((category: string) => {
    const target = String(category || '').trim().toLowerCase();
    setCategories((current) => current.filter((entry) => entry.trim().toLowerCase() !== target));
  }, []);

  const addItemsLocally = useCallback((itemsToAdd: Item[]) => {
    const normalized = itemsToAdd.map(normalizeItem);
    useInventoryStore.setState((state) => {
      const nextItems = [...state.items, ...normalized];
      const nextManualOrder = normOrder(nextItems, [...state.manualOrder, ...normalized.map((item) => String(item.id))]);
      return {
        ...state,
        items: sortItems(nextItems, state.sortMode, nextManualOrder),
        manualOrder: nextManualOrder,
      };
    });
  }, []);

  const updateItemsLocally = useCallback((itemsToUpdate: Item[]) => {
    const patchById = new Map(itemsToUpdate.map((item) => [String(item.id), normalizeItem(item)]));
    useInventoryStore.setState((state) => {
      const nextItems = state.items.map((item) => patchById.get(String(item.id)) || item);
      const nextManualOrder = normOrder(nextItems, state.manualOrder);
      return {
        ...state,
        items: sortItems(nextItems, state.sortMode, nextManualOrder),
        manualOrder: nextManualOrder,
      };
    });
  }, []);

  const deleteItemsLocally = useCallback((ids: string[]) => {
    const idSet = new Set(ids.map(String));
    useInventoryStore.setState((state) => {
      const nextItems = state.items.filter((item) => !idSet.has(String(item.id)));
      const nextManualOrder = normOrder(nextItems, state.manualOrder.filter((id) => !idSet.has(String(id))));
      return {
        ...state,
        items: sortItems(nextItems, state.sortMode, nextManualOrder),
        manualOrder: nextManualOrder,
      };
    });
  }, []);

  const addItems = useCallback(
    (itemsToAdd: Item[]) =>
      enqueueMutation(async () => {
        const normalized = itemsToAdd.map(normalizeItem);
        try {
          for (const item of normalized) {
            await createItem(item, DEFAULT_ACTOR.id, DEFAULT_ACTOR.name);
          }
        } catch (error) {
          console.warn('[InventoryContext] addItems fell back to local state:', error);
          addItemsLocally(normalized);
        }
      }),
    [addItemsLocally, createItem, enqueueMutation],
  );

  const updateItems = useCallback(
    (itemsToUpdate: Item[]) =>
      enqueueMutation(async () => {
        const normalized = itemsToUpdate.map(normalizeItem);
        try {
          for (const item of normalized) {
            await updateItem(item, DEFAULT_ACTOR.id, DEFAULT_ACTOR.name);
          }
        } catch (error) {
          console.warn('[InventoryContext] updateItems fell back to local state:', error);
          updateItemsLocally(normalized);
        }
      }),
    [enqueueMutation, updateItem, updateItemsLocally],
  );

  const deleteItems = useCallback(
    (ids: string[]) =>
      enqueueMutation(async () => {
        const uniqueIds = Array.from(new Set(ids.map(String)));
        if (uniqueIds.length === 0) return;
        try {
          await purge(uniqueIds, DEFAULT_ACTOR.id, DEFAULT_ACTOR.name);
        } catch (error) {
          console.warn('[InventoryContext] deleteItems fell back to local state:', error);
          deleteItemsLocally(uniqueIds);
        }
      }),
    [deleteItemsLocally, enqueueMutation, purge],
  );

  const setItemSortMode = useCallback(
    (mode: ItemSortMode) => {
      setSortMode(mode);
    },
    [setSortMode],
  );

  const lockCurrentItemOrder = useCallback(() => {
    const nextManualOrder = sortedItems.map((item) => String(item.id));
    useInventoryStore.setState((state) => ({
      ...state,
      sortMode: 'manual_locked',
      manualOrder: nextManualOrder,
      items: [...sortedItems],
    }));
  }, [sortedItems]);

  const moveItemManually = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const state = useInventoryStore.getState();
      if (state.sortMode !== 'manual_locked') {
        const nextManualOrder = sortedItems.map((item) => String(item.id));
        useInventoryStore.setState((current) => ({
          ...current,
          sortMode: 'manual_locked',
          manualOrder: nextManualOrder,
          items: [...sortedItems],
        }));
      }
      move(String(id), direction);
    },
    [move, sortedItems],
  );

  const applyStockDelta = useCallback((transaction: Transaction, multiplier: 1 | -1) => {
    const delta = getTransactionDelta(transaction.type, toNumber(transaction.quantity, 0)) * multiplier;
    if (delta === 0) return;

    useInventoryStore.setState((state) => ({
      ...state,
      items: state.items.map((item) =>
        String(item.id) === String(transaction.itemId)
          ? {
              ...item,
              currentStock: toNumber(item.currentStock, 0) + delta,
              lastUpdated: new Date().toISOString(),
            }
          : item,
      ),
    }));
  }, []);

  const updateStockFromTransaction = useCallback(
    (transaction: Transaction, action: InventoryAction, oldTransaction?: Transaction) => {
      if (action === 'add') {
        applyStockDelta(transaction, 1);
        return;
      }

      if (action === 'remove') {
        applyStockDelta(transaction, -1);
        return;
      }

      if (oldTransaction) {
        applyStockDelta(oldTransaction, -1);
      }
      applyStockDelta(transaction, 1);
    },
    [applyStockDelta],
  );

  const value = useMemo<InventoryContextType>(
    () => ({
      items: sortedItems,
      units,
      categories,
      isLoading: !bootstrapped || storeLoading,
      addUnit,
      deleteUnit,
      addCategory,
      deleteCategory,
      addItems,
      updateItems,
      deleteItems,
      itemSortMode: sortMode,
      setItemSortMode,
      lockCurrentItemOrder,
      moveItemManually,
      updateStockFromTransaction,
    }),
    [
      addCategory,
      addItems,
      addUnit,
      bootstrapped,
      categories,
      deleteCategory,
      deleteItems,
      deleteUnit,
      lockCurrentItemOrder,
      moveItemManually,
      setItemSortMode,
      sortMode,
      sortedItems,
      storeLoading,
      units,
      updateItems,
      updateStockFromTransaction,
    ],
  );

  useEffect(() => {
    if (!storeError) return;
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[InventoryContext] inventory store reported an error:', storeError);
    }
  }, [storeError]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
};

export const useInventory = (): InventoryContextType => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
