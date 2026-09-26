import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assertDeficitInvariant,
  availableStock,
  DEFAULT_DEFICIT_POLICY,
  planMovement,
  StockOverIssueError,
  type DeficitPolicy,
} from './stock-deficit';

const d = (value: string | number) => new Prisma.Decimal(value);
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

describe('DEF-001 stock deficit ledger', () => {
  describe('the invariant currentStock = ledgerNet + openDeficit', () => {
    it('holds for an ordinary issue that is fully covered', () => {
      const plan = planMovement(d(10), d(0), d(-4));
      expect(plan.appliedDelta.toString()).toBe('-4');
      expect(plan.newDeficit.toString()).toBe('0');
      // stock 10 -> 6; the ledger the invariant sees includes the 10 it started from.
      expect(() => assertDeficitInvariant(d(6), d(6), d(0))).not.toThrow();
    });

    it('holds after an over-issue is clamped and recorded as debt', () => {
      const available = d(10);
      const plan = planMovement(available, d(0), d(-999));
      expect(plan.appliedDelta.toString()).toBe('-10');
      expect(plan.newDeficit.toString()).toBe('989');
      expect(plan.shortfall).toBe(true);
      // opening 10, movements +10 then -999 => ledger -989; stock 0, debt 989 => 0 === -989 + 989
      expect(() => assertDeficitInvariant(d(0), d('-989'), d('989'))).not.toThrow();
    });

    it('never lets available stock go negative', () => {
      const plan = planMovement(d(0), d(0), d(-1));
      const newStock = d(0).plus(plan.appliedDelta);
      expect(availableStock(newStock).gte(0)).toBe(true);
      expect(newStock.toString()).toBe('0');
    });

    it('fails loudly when the invariant is broken', () => {
      // This is the check that would have caught the original bug.
      expect(() => assertDeficitInvariant(d(0), d(-999), d(0)))
        .toThrow(/invariant violated/);
    });
  });

  describe('incoming stock settles debt before becoming spendable', () => {
    it('absorbs the outstanding deficit first', () => {
      // after the over-issue: stock 0, debt 989
      const plan = planMovement(d(0), d(989), d(500));
      expect(plan.absorbedByOpenDeficits.toString()).toBe('500');
      expect(plan.appliedDelta.toString()).toBe('0');
      expect(plan.newDeficit.toString()).toBe('0');
      // stock stays 0, debt 489 => 0 === -489 + 489
      expect(() => assertDeficitInvariant(d(0), d('-489'), d(489))).not.toThrow();
    });

    it('only makes the remainder spendable once the debt is cleared', () => {
      const plan = planMovement(d(0), d(989), d(1200));
      expect(plan.absorbedByOpenDeficits.toString()).toBe('989');
      expect(plan.appliedDelta.toString()).toBe('211');
      const newStock = d(0).plus(plan.appliedDelta);
      expect(newStock.toString()).toBe('211');
    });

    it('does not absorb when there is no debt', () => {
      const plan = planMovement(d(3), d(0), d(5));
      expect(plan.absorbedByOpenDeficits.toString()).toBe('0');
      expect(plan.appliedDelta.toString()).toBe('5');
    });
  });

  describe('policy behaviour', () => {
    it('STRICT refuses an over-issue instead of clamping', () => {
      expect(() => planMovement(d(1), d(0), d(-5), 'STRICT'))
        .toThrow(StockOverIssueError);
    });

    it('STRICT still allows a covered issue', () => {
      const plan = planMovement(d(10), d(0), d(-5), 'STRICT');
      expect(plan.appliedDelta.toString()).toBe('-5');
    });

    it('ALLOW keeps the legacy negative balance (for migration only)', () => {
      const plan = planMovement(d(10), d(0), d(-999), 'ALLOW');
      expect(plan.appliedDelta.toString()).toBe('-999');
      expect(plan.newDeficit.toString()).toBe('0');
      expect(plan.shortfall).toBe(true);
    });

    it('defaults to CLAMP_AND_ALERT', () => {
      expect(DEFAULT_DEFICIT_POLICY).toBe('CLAMP_AND_ALERT');
      const plan = planMovement(d(10), d(0), d(-999));
      expect(plan.newDeficit.toString()).toBe('989');
    });
  });

  describe('deficit is never a silent loss', () => {
    it('every clamped movement is flagged as a shortfall', () => {
      const plan = planMovement(d('0.001'), d(0), d('-0.002'));
      expect(plan.shortfall).toBe(true);
      expect(plan.newDeficit.toString()).toBe('0.001');
    });

    it('a zero movement is a no-op', () => {
      const plan = planMovement(d(5), d(3), d(0));
      expect(plan.appliedDelta.toString()).toBe('0');
      expect(plan.absorbedByOpenDeficits.toString()).toBe('0');
      expect(plan.shortfall).toBe(false);
    });
  });

  describe('property: the invariant survives any sequence of movements', () => {
    it('holds for a deterministic pseudo-random movement sequence', () => {
      // A fixed seed keeps this deterministic while still exploring states a
      // hand-written case list would miss.
      let seed = 42;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (const policy of ['CLAMP_AND_ALERT', 'STRICT', 'ALLOW'] as DeficitPolicy[]) {
        for (let trial = 0; trial < 200; trial += 1) {
          let currentStock = d(0);
          let ledgerNet = d(0);
          let openDeficit = d(0);

          for (let step = 0; step < 25; step += 1) {
            const magnitude = Math.floor(next() * 40) - 12; // -12..27
            const delta = d(magnitude === 0 ? 1 : magnitude);
            if (delta.isZero()) continue;

            let plan;
            try {
              plan = planMovement(currentStock, openDeficit, delta, policy);
            } catch (error) {
              if (error instanceof StockOverIssueError) break; // refused; state unchanged
              throw error;
            }

            const wasOpenDeficit = openDeficit;
            openDeficit = round(wasOpenDeficit.minus(plan.absorbedByOpenDeficits).plus(plan.newDeficit));
            currentStock = round(currentStock.plus(plan.appliedDelta));
            ledgerNet = round(ledgerNet.plus(delta));

            // The invariant is only claimed for the policies that actually
            // maintain it. ALLOW deliberately keeps a negative balance and so
            // does not represent the shortfall as debt, meaning
            // currentStock === ledgerNet + openDeficit does not hold there.
            if (policy === 'CLAMP_AND_ALERT' || policy === 'STRICT') {
              expect(() => assertDeficitInvariant(currentStock, ledgerNet, openDeficit))
                .not.toThrow();
              expect(currentStock.gte(0)).toBe(true);
            }
          }
        }
      }

    });
  });
});
