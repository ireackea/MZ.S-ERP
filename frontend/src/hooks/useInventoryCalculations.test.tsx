// ENTERPRISE FIX: Phase 0.3 – Final Arabic Encoding Fix & 10/10 Declaration - 2026-03-13
// ENTERPRISE FIX: Arabic Encoding Auto-Fixed - 2026-03-13
// ENTERPRISE FIX: Phase 0.1 – Final Encoding & Lock Fix - 2026-03-13
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInventoryCalculations } from './useInventoryCalculations';
import { Item } from '../types';

describe('useInventoryCalculations', () => {
  it('flags below-min status correctly when balance is under minLimit', () => {
    const items: Item[] = [
      {
        id: 'it-1',
        name: 'Item 1',
        code: 'I1',
        category: 'مواد خام' as Item['category'],
        unit: 'كيلوجرام' as Item['unit'],
        minLimit: 5,
        maxLimit: 100,
        orderLimit: 3,
        currentStock: 2,
        tags: [],
      },
    ];

    const openingQuantities = new Map<string, number>([['it-1', 2]]);

    const { result } = renderHook(() =>
      useInventoryCalculations({
        items,
        openingQuantities,
        transactions: [],
      })
    );

    const status = result.current.stockStatusMap.get('it-1');
    expect(status).toBeDefined();
    expect(status?.balance).toBe(2);
    expect(status?.isBelowMin).toBe(true);
    expect(status?.isBelowOrder).toBe(true);
  });
});
