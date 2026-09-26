/**
 * DEF-001 — the stock deficit ledger.
 *
 * ## The problem
 *
 * An issue ("صادر") larger than the available balance used to write a negative
 * `currentStock` straight to the column. Clamping the display alone is not a
 * fix: if the movement of 999 is still recorded and the balance shows 0, then
 * the ledger and the balance disagree, and every report that re-derives the
 * balance from the movements will disagree with the item page.
 *
 * ## The model
 *
 * A deficit is demand that the ledger recorded but that no physical stock ever
 * covered. It is not an error to be hidden and not a movement to be deleted: it
 * is a real, dated, attributable fact about the warehouse.
 *
 * The invariant that makes the model self-checking:
 *
 *     currentStock === ledgerNet + openDeficit
 *
 * where `ledgerNet` is the sum of every movement ever recorded for the item and
 * `openDeficit` is the sum of unsettled deficits. `currentStock` is therefore
 * the *available* quantity, which is never negative, while the ledger stays
 * complete and auditable.
 *
 * The useful consequence: **incoming stock settles debt before it becomes
 * spendable.** A receipt does not silently make phantom stock available; it
 * pays down the outstanding deficit first. That is what turns a silent
 * corruption into a visible, self-healing queue.
 */
import { Prisma } from '@prisma/client';
import { DECIMAL_SCALE } from './decimal';

const round = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(DECIMAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);

export const ZERO = new Prisma.Decimal(0);

export type DeficitPolicy = 'STRICT' | 'CLAMP_AND_ALERT' | 'ALLOW';

export const DEFICIT_POLICIES: readonly DeficitPolicy[] = ['STRICT', 'CLAMP_AND_ALERT', 'ALLOW'];

export const DEFAULT_DEFICIT_POLICY: DeficitPolicy = 'CLAMP_AND_ALERT';

export type DeficitStatus = 'OPEN' | 'SETTLED_BY_CORRECTION' | 'SETTLED_BY_RECEIPT' | 'WRITTEN_OFF';

export const DEFICIT_STATUSES: readonly DeficitStatus[] = [
  'OPEN',
  'SETTLED_BY_CORRECTION',
  'SETTLED_BY_RECEIPT',
  'WRITTEN_OFF',
];

/** Thrown when policy is STRICT and a movement would over-issue. */
export class StockOverIssueError extends Error {
  constructor(
    readonly itemPublicId: string,
    readonly available: Prisma.Decimal,
    readonly requested: Prisma.Decimal,
  ) {
    super(
      `Issue of ${requested.toFixed(DECIMAL_SCALE)} exceeds the available ${available.toFixed(DECIMAL_SCALE)} for item ${itemPublicId}`,
    );
    this.name = 'StockOverIssueError';
  }
}

export type DeficitPlan = {
  /** Quantity to add to `Item.currentStock`. Never drives it below zero. */
  readonly appliedDelta: Prisma.Decimal;
  /** Quantity absorbed by settling existing deficits. */
  readonly absorbedByOpenDeficits: Prisma.Decimal;
  /** New deficit to record, zero when the movement is fully covered. */
  readonly newDeficit: Prisma.Decimal;
  /** True when this movement could not be fully satisfied by available stock. */
  readonly shortfall: boolean;
};

/**
 * Decides what a single movement does to the balance, given the deficit already
 * outstanding. Pure: no database, no clock, no globals. Every caller goes
 * through here, so the invariant is enforced in exactly one place.
 *
 * @param available    the item's current balance
 * @param openDeficit  the unsettled deficit total
 * @param delta        signed movement (+in, -out)
 */
export const planMovement = (
  available: Prisma.Decimal,
  openDeficit: Prisma.Decimal,
  delta: Prisma.Decimal,
  policy: DeficitPolicy = DEFAULT_DEFICIT_POLICY,
): DeficitPlan => {
  const stock = round(available);
  const debt = round(openDeficit);
  const movement = round(delta);
  const empty: DeficitPlan = {
    appliedDelta: ZERO, absorbedByOpenDeficits: ZERO, newDeficit: ZERO, shortfall: false,
  };
  if (movement.isZero()) return empty;

  if (movement.gt(ZERO)) {
    // Incoming stock pays down debt first: a receipt must not turn an
    // unfulfilled issue into spendable stock.
    const absorbed = movement.gt(debt) ? debt : movement;
    const applied = movement.minus(absorbed);
    return {
      appliedDelta: applied,
      absorbedByOpenDeficits: absorbed,
      newDeficit: ZERO,
      shortfall: false,
    };
  }

  // Outgoing.
  const wanted = movement.abs();
  if (stock.gte(wanted)) {
    return { appliedDelta: movement, absorbedByOpenDeficits: ZERO, newDeficit: ZERO, shortfall: false };
  }

  const shortfall = wanted.minus(stock);
  if (policy === 'ALLOW') {
    return { appliedDelta: movement, absorbedByOpenDeficits: ZERO, newDeficit: ZERO, shortfall: true };
  }
  if (policy === 'STRICT') {
    throw new StockOverIssueError('', stock, wanted);
  }

  // CLAMP_AND_ALERT: take what exists, record the rest as debt.
  return {
    appliedDelta: stock.negated(),
    absorbedByOpenDeficits: ZERO,
    newDeficit: shortfall,
    shortfall: true,
  };
};

/**
 * The self-check. `currentStock` must equal the ledger plus open debt at all
 * times; this is what makes a silent corruption impossible to hide.
 */
export const assertDeficitInvariant = (
  currentStock: Prisma.Decimal,
  ledgerNet: Prisma.Decimal,
  openDeficit: Prisma.Decimal,
  context = 'stock deficit invariant',
): void => {
  const left = round(currentStock);
  const right = round(ledgerNet).plus(round(openDeficit));
  if (!left.equals(right)) {
    throw new Error(
      `${context} violated: currentStock=${left.toFixed(DECIMAL_SCALE)} but `
      + `ledgerNet + openDeficit=${right.toFixed(DECIMAL_SCALE)}`,
    );
  }
};

/** The spendable quantity, which is the balance and can never be negative. */
export const availableStock = (currentStock: Prisma.Decimal): Prisma.Decimal => {
  const stock = round(currentStock);
  return stock.isNegative() ? ZERO : stock;
};
