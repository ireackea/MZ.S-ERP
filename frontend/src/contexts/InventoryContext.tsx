// ENTERPRISE FIX: Phase 6.3 - Final Surgical Fix & Complete Compliance - 2026-03-13
// Audit Logs moved to Prisma | JWT Cookie-only | Lazy Loading | No JSON fallback
import React, { createContext, useContext } from 'react';
import { useInventoryStore } from '../store/useInventoryStore';

type InventoryContextValue = ReturnType<typeof useInventoryStore.getState>;

const InventoryContext = createContext<InventoryContextValue | null>(null);

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = useInventoryStore();
  return <InventoryContext.Provider value={store}>{children}</InventoryContext.Provider>;
};

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within InventoryProvider');
  }
  return context;
};