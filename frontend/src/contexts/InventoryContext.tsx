// ENTERPRISE FIX: Phase 7 - Read-Only Context - 2026-03-01
// InventoryContext - Read-Only Provider for Shared Data (units, categories)
// NOT responsible for items management - that's Items.tsx responsibility

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getUnits, getCategories } from '../services/legacy/storage';

interface InventoryContextType {
  units: string[];
  categories: string[];
  isLoading: boolean;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [units, setUnits] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [storedUnits, storedCategories] = await Promise.all([
          getUnits(),
          getCategories(),
        ]);
        setUnits(storedUnits || []);
        setCategories(storedCategories || []);
      } catch (error) {
        console.error('[InventoryContext] Failed to load units/categories:', error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  return (
    <InventoryContext.Provider value={{ units, categories, isLoading }}>
      {children}
    </InventoryContext.Provider>
  );
};

export const useInventory = (): InventoryContextType => {
  const context = useContext(InventoryContext);
  if (context === undefined) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
