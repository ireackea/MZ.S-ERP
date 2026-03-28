// ENTERPRISE FIX: Legacy Migration Phase 5 - Final Stabilization & Production - 2026-02-27
import { create } from 'zustand';

export type RealtimeScope = 'dashboard' | 'items' | 'operations' | 'transactions' | 'formulation' | 'stocktaking';

export type RealtimeSyncEvent = {
  scopes?: RealtimeScope[];
  reason?: string;
  timestamp?: string;
  actor?: string;
  meta?: Record<string, unknown>;
};

type ScopeVersions = Record<RealtimeScope, number>;

type RealtimeSyncStore = {
  isConnected: boolean;
  lastSyncAt: string | null;
  lastReason: string | null;
  scopes: ScopeVersions;
  setConnected: (value: boolean) => void;
  applyEvent: (event: RealtimeSyncEvent) => void;
  reset: () => void;
};

const defaultScopes = (): ScopeVersions => ({
  dashboard: 0,
  items: 0,
  operations: 0,
  transactions: 0,
  formulation: 0,
  stocktaking: 0,
});

const SCOPES: RealtimeScope[] = ['dashboard', 'items', 'operations', 'transactions', 'formulation', 'stocktaking'];

export const useRealtimeSyncStore = create<RealtimeSyncStore>((set) => ({
  isConnected: false,
  lastSyncAt: null,
  lastReason: null,
  scopes: defaultScopes(),

  setConnected: (value) => {
    set({ isConnected: value });
  },

  applyEvent: (event) => {
    const incomingScopes = Array.isArray(event?.scopes) ? event.scopes.filter((scope): scope is RealtimeScope => SCOPES.includes(scope)) : [];
    if (incomingScopes.length === 0) return;
    set((state) => {
      const nextScopes = { ...state.scopes };
      incomingScopes.forEach((scope) => {
        nextScopes[scope] += 1;
      });
      return {
        scopes: nextScopes,
        lastSyncAt: event?.timestamp || new Date().toISOString(),
        lastReason: event?.reason || null,
      };
    });
  },

  reset: () => {
    set({
      isConnected: false,
      lastSyncAt: null,
      lastReason: null,
      scopes: defaultScopes(),
    });
  },
}));

