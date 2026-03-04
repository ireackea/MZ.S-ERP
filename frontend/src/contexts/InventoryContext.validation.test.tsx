// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InventoryProvider, useInventory } from './InventoryContext';
import { Item } from '../types';

const mockGetItemsFromApi = vi.fn();
const mockSyncItemsToApi = vi.fn();
const mockDeleteItemsByPublicIds = vi.fn();

const mockGetItemsFromStorage = vi.fn();
const mockSaveItems = vi.fn();
const mockGetUnits = vi.fn();
const mockSaveUnits = vi.fn();
const mockGetCategories = vi.fn();
const mockSaveCategories = vi.fn();
const mockGetTransactions = vi.fn();
const mockGetItemSortSettings = vi.fn();
const mockSaveItemSortSettings = vi.fn();

vi.mock('@services/itemsService', () => ({
  getItems: (...args: unknown[]) => mockGetItemsFromApi(...args),
  syncItems: (...args: unknown[]) => mockSyncItemsToApi(...args),
  deleteItemsByPublicIds: (...args: unknown[]) => mockDeleteItemsByPublicIds(...args),
}));

vi.mock('../services/storage', () => ({
  getItems: (...args: unknown[]) => mockGetItemsFromStorage(...args),
  saveItems: (...args: unknown[]) => mockSaveItems(...args),
  getUnits: (...args: unknown[]) => mockGetUnits(...args),
  saveUnits: (...args: unknown[]) => mockSaveUnits(...args),
  getCategories: (...args: unknown[]) => mockGetCategories(...args),
  saveCategories: (...args: unknown[]) => mockSaveCategories(...args),
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  getItemSortSettings: (...args: unknown[]) => mockGetItemSortSettings(...args),
  saveItemSortSettings: (...args: unknown[]) => mockSaveItemSortSettings(...args),
}));

vi.mock('../services/eventBus', () => ({
  TOPICS: {
    ORDER_CREATED: 'ORDER_CREATED',
    TRANSACTION_ADDED: 'TRANSACTION_ADDED',
  },
  eventBus: {
    subscribe: () => () => undefined,
  },
}));

const makeItem = (id: string, name: string): Item => ({
  id,
  name,
  code: id,
  category: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�' as Item['category'],
  unit: '7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�7�"�#���97�"�7�"�7�"�' as Item['unit'],
  minLimit: 1,
  maxLimit: 100,
  orderLimit: 5,
  currentStock: 10,
  tags: [],
});

const CountConsumer = () => {
  const { items } = useInventory();
  return <div data-testid="count">{items.length}</div>;
};

describe('InventoryContext validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUnits.mockReturnValue([]);
    mockGetCategories.mockReturnValue([]);
    mockGetTransactions.mockReturnValue([]);
    mockGetItemSortSettings.mockReturnValue({ mode: 'manual_locked', manualOrder: [] });
    mockDeleteItemsByPublicIds.mockResolvedValue({ deleted: 0, total: 0 });
  });

  it('falls back to local cache when API is down', async () => {
    mockGetItemsFromStorage.mockReturnValue([makeItem('local-1', 'Local Item 1')]);
    mockGetItemsFromApi.mockRejectedValue(new Error('Network down'));
    mockSyncItemsToApi.mockResolvedValue({ synced: 0, total: 0 });

    render(
      <InventoryProvider>
        <CountConsumer />
      </InventoryProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1');
    });
  });

  it('serializes rapid sync calls and keeps latest state', async () => {
    mockGetItemsFromStorage.mockReturnValue([]);
    mockGetItemsFromApi.mockResolvedValue([]);

    let inFlight = 0;
    let maxInFlight = 0;
    mockSyncItemsToApi.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { synced: 1, total: 1 };
    });

    const BurstConsumer = () => {
      const { addItems, items } = useInventory();
      useEffect(() => {
        addItems([makeItem('a-1', 'A1')]);
        addItems([makeItem('a-2', 'A2')]);
      }, []);
      return <div data-testid="count">{items.length}</div>;
    };

    render(
      <InventoryProvider>
        <BurstConsumer />
      </InventoryProvider>
    );

    await waitFor(() => {
      const counts = screen.getAllByTestId('count');
      expect(counts[counts.length - 1]).toHaveTextContent('2');
    });

    await waitFor(() => {
      expect(mockSyncItemsToApi).toHaveBeenCalledTimes(2);
    });

    expect(maxInFlight).toBe(1);
  });
});

