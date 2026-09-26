import { describe, expect, it } from 'vitest';
import {
  canonicalOperationType,
  classifyMovement,
  emptyMovementTotals,
  isInboundType,
  isOutboundType,
  isStockAdjustmentType,
  movementDelta,
  roundQuantity,
  summariseMovements,
} from './operation-type';
import {
  expandOperationTypeAliases,
  matchCanonicalOperationType,
  resolveCanonicalOperationType,
} from './operation-type-aliases';

describe('FC-API-002 report aggregates contract', () => {
  describe('empty data', () => {
    it('returns a zeroed, well-formed summary for no rows', () => {
      expect(summariseMovements([])).toEqual(emptyMovementTotals());
      const totals = summariseMovements([]);
      expect(totals.totalIn).toBe(0);
      expect(totals.totalOut).toBe(0);
      expect(totals.net).toBe(0);
      expect(totals.itemCount).toBe(0);
    });

    it('treats an empty or missing quantity as zero, not NaN', () => {
      expect(movementDelta({ type: 'وارد', quantity: NaN })).toBe(0);
      expect(movementDelta({ type: 'صادر', quantity: undefined as any })).toBe(0);
      expect(roundQuantity(NaN)).toBe(0);
      expect(Number.isNaN(summariseMovements([{ type: 'وارد', quantity: 'abc' }]).net)).toBe(false);
    });
  });

  describe('direction classification', () => {
    it('classifies the canonical types', () => {
      for (const value of ['وارد', 'استلام', 'in', 'inbound', 'incoming', 'purchase', '1']) {
        expect(classifyMovement(value), value).toBe('IN');
      }
      for (const value of ['صادر', 'صرف', 'out', 'outbound', 'sale', '2']) {
        expect(classifyMovement(value), value).toBe('OUT');
      }
      expect(classifyMovement('STOCK_ADJUSTMENT')).toBe('ADJUSTMENT');
      expect(classifyMovement('تسوية مخزون')).toBe('ADJUSTMENT');
    });

    it('never classifies by substring', () => {
      // The old printer used `type.includes('in')` and counted all of these as
      // inbound, corrupting every report total. None of them is an alias.
      for (const value of ['inbox', 'maintenance', 'intake-draft', 'inertia', 'outer', 'about']) {
        expect(classifyMovement(value), `${value} must not be treated as a movement`).toBe('NEUTRAL');
      }
    });

    it('still honours documented aliases that merely contain those letters', () => {
      // 'dispatch' is a real alias for صادر even though it contains no 'out'.
      expect(classifyMovement('dispatch')).toBe('OUT');
      expect(classifyMovement('incoming')).toBe('IN');
    });

    it('folds Arabic orthography so a spelling variant still matches', () => {
      expect(classifyMovement('إدخال')).toBe('IN');
      expect(classifyMovement('ادخال')).toBe('IN');
      expect(classifyMovement('إنتاج')).toBe('IN');
      expect(classifyMovement('انتاج')).toBe('IN');
      expect(isStockAdjustmentType('تسوية المخزون')).toBe(true);
      expect(isStockAdjustmentType('تعديل مخزون')).toBe(true);
    });

    it('returns NEUTRAL for empty and unknown values', () => {
      expect(classifyMovement('')).toBe('NEUTRAL');
      expect(classifyMovement(null)).toBe('NEUTRAL');
      expect(classifyMovement(undefined)).toBe('NEUTRAL');
      expect(classifyMovement('zzz-unknown')).toBe('NEUTRAL');
    });
  });

  describe('negative and adjustment quantities', () => {
    it('treats the magnitude and applies the sign from the type', () => {
      expect(movementDelta({ type: 'وارد', quantity: -50 })).toBe(50);
      expect(movementDelta({ type: 'صادر', quantity: -50 })).toBe(-50);
      expect(movementDelta({ type: 'صادر', quantity: 0 })).toBe(0);
    });

    it('follows the explicit direction of a stock adjustment', () => {
      expect(movementDelta({ type: 'STOCK_ADJUSTMENT', quantity: 10, adjustmentDirection: 'INCREASE' })).toBe(10);
      expect(movementDelta({ type: 'STOCK_ADJUSTMENT', quantity: 10, adjustmentDirection: 'DECREASE' })).toBe(-10);
      expect(movementDelta({ type: 'STOCK_ADJUSTMENT', quantity: 10 })).toBe(0);
      expect(movementDelta({ type: 'STOCK_ADJUSTMENT', quantity: 10, adjustmentDirection: 'sideways' })).toBe(0);
    });

    it('is neutral for an unclassified type rather than guessing outflow', () => {
      expect(movementDelta({ type: 'mystery', quantity: 99 })).toBe(0);
    });
  });

  describe('large data and decimal precision', () => {
    it('keeps totals exact across many rows', () => {
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        type: i % 2 === 0 ? 'وارد' : 'صادر',
        quantity: 0.1,
        itemId: `ITEM-${i % 7}`,
      }));
      const totals = summariseMovements(rows, (row) => (row as any).itemId);
      expect(totals.totalTransactions).toBe(1000);
      // 500 inbound rows × 0.1 = 50, exactly.
      expect(totals.totalIn).toBe(50);
      expect(totals.totalOut).toBe(50);
      expect(totals.net).toBe(0);
      expect(totals.itemCount).toBe(7);
    });

    it('does not accumulate float drift', () => {
      // 0.1 + 0.2 in raw float is 0.30000000000000004.
      const totals = summariseMovements([
        { type: 'وارد', quantity: 0.1 },
        { type: 'صادر', quantity: 0.2 },
      ]);
      expect(totals.net).toBe(-0.1);
      expect(String(totals.net)).not.toContain('0000000');
    });

    it('rounds to the stored precision and rejects non-finite input', () => {
      expect(roundQuantity(1.23456)).toBe(1.235);
      expect(roundQuantity(1.0005, 2)).toBe(1.0);
      expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
      expect(roundQuantity(Infinity)).toBe(0);
    });
  });

  describe('aggregation', () => {
    it('counts each bucket and reports net as in minus out', () => {
      const totals = summariseMovements(
        [
          { type: 'وارد', quantity: 10 },
          { type: 'صادر', quantity: 4 },
          { type: 'STOCK_ADJUSTMENT', quantity: 3, adjustmentDirection: 'INCREASE' },
          { type: 'STOCK_ADJUSTMENT', quantity: 1, adjustmentDirection: 'DECREASE' },
          { type: 'unknown-thing', quantity: 100 },
        ],
        () => 'ITEM-1',
      );

      expect(totals.totalTransactions).toBe(4); // the unknown row is excluded
      expect(totals.totalIn).toBe(10);
      expect(totals.totalOut).toBe(4);
      expect(totals.totalAdjustment).toBe(2); // +3 - 1
      expect(totals.net).toBe(6);
      expect(totals.itemCount).toBe(1);
    });

    it('does not double-count a row that is both adjusted and typed', () => {
      const totals = summariseMovements([{ type: 'STOCK_ADJUSTMENT', quantity: 5, adjustmentDirection: 'INCREASE' }]);
      expect(totals.totalIn).toBe(0);
      expect(totals.totalOut).toBe(0);
      expect(totals.totalAdjustment).toBe(5);
    });
  });

  describe('alias table is the single source', () => {
    it('resolves every documented alias to its canonical label', () => {
      expect(resolveCanonicalOperationType('in')).toBe('وارد');
      expect(resolveCanonicalOperationType('dispatch')).toBe('صادر');
      expect(resolveCanonicalOperationType('waste')).toBe('هالك');
      expect(resolveCanonicalOperationType('stock-adjustment')).toBe('STOCK_ADJUSTMENT');
      expect(matchCanonicalOperationType('1')).toBe('وارد');
    });

    it('returns the input untouched when unknown', () => {
      expect(resolveCanonicalOperationType('custom-type')).toBe('custom-type');
      expect(matchCanonicalOperationType('custom-type')).toBeNull();
      expect(resolveCanonicalOperationType('')).toBe('');
    });

    it('expands a canonical label into a filter list', () => {
      expect(expandOperationTypeAliases('وارد')).toContain('in');
      expect(expandOperationTypeAliases('صادر')).toContain('out');
      expect(expandOperationTypeAliases('STOCK_ADJUSTMENT')).toContain('stock_adjustment');
      expect(expandOperationTypeAliases('unknown')).toEqual(['unknown']);
    });

    it('normalises separators and case consistently', () => {
      expect(canonicalOperationType('STOCK_ADJUSTMENT')).toBe('stock adjustment');
      expect(canonicalOperationType('  InBound  ')).toBe('inbound');
    });

    it('keeps inbound and outbound mutually exclusive', () => {
      for (const value of ['وارد', 'صادر', 'STOCK_ADJUSTMENT', 'inbox', '']) {
        expect(isInboundType(value) && isOutboundType(value), `${value} cannot be both`).toBe(false);
      }
    });
  });
});
