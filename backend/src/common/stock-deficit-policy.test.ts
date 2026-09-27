import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { assertDeficitInvariant, planMovement, type DeficitPolicy } from './stock-deficit';

const d = (value: string | number) => new Prisma.Decimal(value);
const round = (value: Prisma.Decimal) => value.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
const fmt = (value: Prisma.Decimal) => value.toFixed(3);

/**
 * FC-DEF-001 — what ALLOW costs, stated as a test.
 *
 * ALLOW exists for a migration window, not as a normal setting: it writes a
 * negative balance and records no debt, which is exactly the condition the
 * deficit ledger was introduced to remove. The risk is not that it is wrong, it
 * is that it is invisible - an operator who flips it sees a red reconciliation
 * with no explanation and no tracked backlog.
 *
 * These tests are the reason the reconciliation now states the policy: a setting
 * that silently breaks an invariant has to be provably loud.
 */
describe('FC-DEF-001 the cost of the ALLOW policy', () => {
  const runSequence = (policy: DeficitPolicy, movements: Array<string | number>) => {
    let currentStock = d(0);
    let openDeficit = d(0);
    let ledgerNet = d(0);
    for (const raw of movements) {
      const delta = d(raw);
      const plan = planMovement(currentStock, openDeficit, delta, policy);
      openDeficit = round(openDeficit.minus(plan.absorbedByOpenDeficits).plus(plan.newDeficit));
      currentStock = round(currentStock.plus(plan.appliedDelta));
      ledgerNet = round(ledgerNet.plus(delta));
    }
    return { currentStock, openDeficit, ledgerNet };
  };

  it('CLAMP_AND_ALERT keeps both the non-negative balance and the invariant', () => {
    const state = runSequence('CLAMP_AND_ALERT', [10, -999, 300]);
    expect(fmt(state.currentStock)).toBe('0.000');
    expect(state.currentStock.gte(0)).toBe(true);
    expect(fmt(state.openDeficit)).toBe('689.000');
    expect(() => assertDeficitInvariant(state.currentStock, state.ledgerNet, state.openDeficit)).not.toThrow();
  });

  it('ALLOW reproduces the exact defect DEF-001 was opened for', () => {
    const state = runSequence('ALLOW', [10, -999]);
    // This is the -989.000 that started all of this.
    expect(fmt(state.currentStock)).toBe('-989.000');
    expect(fmt(state.openDeficit), 'no debt is recorded, so nothing is trackable').toBe('0.000');
  });

  it('ALLOW keeps the books balanced but abandons the non-negative guarantee', () => {
    const state = runSequence('ALLOW', [10, -999]);
    // Worth being precise about what ALLOW does and does not break, because the
    // first draft of this test assumed the invariant failed and it does not:
    // writing the negative balance into the column keeps currentStock equal to
    // the ledger, so the arithmetic still reconciles. What is lost is the
    // guarantee that a balance is spendable, and the record that the shortfall
    // happened at all. The cost is an untrackable negative, not a broken sum.
    expect(() => assertDeficitInvariant(state.currentStock, state.ledgerNet, state.openDeficit))
      .not.toThrow();
    expect(state.currentStock.lt(0), 'the balance is spendable nowhere, and nothing tracks why').toBe(true);
    expect(state.openDeficit.isZero(), 'the shortfall leaves no record to work from').toBe(true);
  });

  it('STRICT refuses the movement and leaves nothing behind to reconcile', () => {
    expect(() => runSequence('STRICT', [10, -999])).toThrow();
  });

  it('the invariant claim is a property of the policy, not an aspiration', () => {
    for (const movements of [[10, -999], [1, -1, -1], [0.1, -0.3, 0.5], [5, -5, 5, -5]]) {
      const clamped = runSequence('CLAMP_AND_ALERT', movements);
      expect(
        () => assertDeficitInvariant(clamped.currentStock, clamped.ledgerNet, clamped.openDeficit),
        `CLAMP_AND_ALERT must hold for ${JSON.stringify(movements)}`,
      ).not.toThrow();
      expect(clamped.currentStock.gte(0)).toBe(true);
    }
  });
});
