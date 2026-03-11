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

// ENTERPRISE FIX: Phase 1 - Single Source of Truth & Integration - 2026-03-05
// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
import React, { type ReactNode } from 'react';
import { useInventoryStore } from '../store/useInventoryStore';
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

export const InventoryProvider: React.FC<{ children: ReactNode }> = ({ children }) => <>{children}</>;

export const useInventory = (): InventoryContextType => {
  const items = useInventoryStore((state) => state.items);
  const units = useInventoryStore((state) => state.units);
  const categories = useInventoryStore((state) => state.categories);
  const isLoading = useInventoryStore((state) => state.loading || state.syncing);
  const addUnit = useInventoryStore((state) => state.addUnit);
  const deleteUnit = useInventoryStore((state) => state.deleteUnit);
  const addCategory = useInventoryStore((state) => state.addCategory);
  const deleteCategory = useInventoryStore((state) => state.deleteCategory);
  const addItems = useInventoryStore((state) => state.addItems);
  const updateItems = useInventoryStore((state) => state.updateItems);
  const deleteItems = useInventoryStore((state) => state.deleteItems);
  const itemSortMode = useInventoryStore((state) => state.sortMode);
  const setItemSortMode = useInventoryStore((state) => state.setSortMode);
  const lockCurrentItemOrder = useInventoryStore((state) => state.lockCurrentItemOrder);
  const moveItemManually = useInventoryStore((state) => state.moveItemManually);
  const updateStockFromTransaction = useInventoryStore((state) => state.updateStockFromTransaction);

  return {
    items,
    units,
    categories,
    isLoading,
    addUnit,
    deleteUnit,
    addCategory,
    deleteCategory,
    addItems: (rows) => addItems(rows),
    updateItems: (rows) => updateItems(rows),
    deleteItems: (ids) => deleteItems(ids),
    itemSortMode,
    setItemSortMode,
    lockCurrentItemOrder,
    moveItemManually,
    updateStockFromTransaction,
  };
};
  'صرف',
