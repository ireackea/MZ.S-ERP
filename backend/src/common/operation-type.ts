/**
 * FC-API-002 — canonical operation-type classification.
 *
 * Before this module the same decision was implemented three times with
 * substring matching, and all three disagreed:
 *   - `transaction.service.canonicalOperationType` (rich alias table)
 *   - `report.service.isInboundType`       (weaker, missing several aliases)
 *   - `reports.service.extractSummary`     (a bare `includes('in')` guess)
 *
 * The bare `'in'` test is the dangerous one: it classifies `inbox`,
 * `maintenance` and `dispatch` as inbound, which silently corrupts every
 * inventory and report total. Classification now happens here, once, driven by
 * the shared alias table, and the other modules delegate to it.
 */
import { matchCanonicalOperationType, resolveCanonicalOperationType } from './operation-type-aliases';

export type MovementDirection = 'IN' | 'OUT' | 'ADJUSTMENT' | 'NEUTRAL';

const INBOUND = new Set(['وارد', 'انتاج', 'مرتجع']);
const OUTBOUND = new Set(['صادر', 'هالك']);
const ADJUSTMENT = new Set(['STOCK_ADJUSTMENT']);

/** Normalises Arabic orthography so ة/ه and أ/ا/إ compare equal. */
const normalizeArabic = (value: string): string =>
  value
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const canonicalOperationType = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
};

/**
 * FC-API-002 — resolves via the single alias table, so classification and the
 * stock service's canonicalisation can never disagree.
 */
export const isStockAdjustmentType = (value: unknown): boolean => {
  const resolved = resolveCanonicalOperationType(value);
  if (resolved === 'STOCK_ADJUSTMENT') return true;
  const normalized = normalizeArabic(canonicalOperationType(value));
  return [...ADJUSTMENT].some((entry) => normalizeArabic(entry) === normalized);
};

/**
 * FC-API-002 — exact classification via the shared alias table. Never a bare
 * substring test: a type that merely contains a letter sequence (e.g.
 * 'inbox', 'maintenance', 'dispatch') must not be read as a movement.
 */
export const classifyMovement = (value: unknown): MovementDirection => {
  const canonical = canonicalOperationType(value);
  if (!canonical) return 'NEUTRAL';
  if (isStockAdjustmentType(canonical)) return 'ADJUSTMENT';

  const resolved = matchCanonicalOperationType(canonical);
  if (resolved && INBOUND.has(resolved)) return 'IN';
  if (resolved && OUTBOUND.has(resolved)) return 'OUT';
  return 'NEUTRAL';
};

export const isInboundType = (value: unknown): boolean => classifyMovement(value) === 'IN';

export const isOutboundType = (value: unknown): boolean => classifyMovement(value) === 'OUT';

export type MovementRow = {
  type: string;
  quantity: number | string;
  adjustmentDirection?: string | null;
};

/**
 * Signed effect on stock. An adjustment follows its explicit direction; anything
 * unclassified is neutral rather than being silently counted as an outflow.
 */
export const movementDelta = (row: MovementRow): number => {
  const quantity = Number(row?.quantity ?? 0);
  if (!Number.isFinite(quantity)) return 0;

  const magnitude = Math.abs(quantity);
  let delta: number;
  switch (classifyMovement(row?.type)) {
    case 'IN':
      delta = magnitude;
      break;
    case 'OUT':
      delta = -magnitude;
      break;
    case 'ADJUSTMENT': {
      const direction = String(row?.adjustmentDirection || '').trim().toUpperCase();
      if (direction === 'INCREASE' || direction === 'IN') delta = magnitude;
      else if (direction === 'DECREASE' || direction === 'OUT') delta = -magnitude;
      else delta = 0;
      break;
    }
    default:
      delta = 0;
  }

  // `-Math.abs(0)` is -0, which would serialise as "-0" in a report payload.
  return delta === 0 ? 0 : delta;
};

/** FC-API-002 — one shared shape for every report aggregate. */
export type MovementTotals = {
  totalTransactions: number;
  totalIn: number;
  totalOut: number;
  totalAdjustment: number;
  net: number;
  itemCount: number;
};

export const emptyMovementTotals = (): MovementTotals => ({
  totalTransactions: 0,
  totalIn: 0,
  totalOut: 0,
  totalAdjustment: 0,
  net: 0,
  itemCount: 0,
});

/** Rounds to the stored decimal precision so totals never drift by float noise. */
export const roundQuantity = (value: number, precision = 3): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  // Avoid a signed zero leaking into JSON as `-0`.
  return rounded === 0 ? 0 : rounded;
};

export const summariseMovements = (
  rows: MovementRow[],
  itemIds: (row: MovementRow) => string | undefined = () => undefined,
): MovementTotals => {
  const totals = emptyMovementTotals();
  const items = new Set<string>();

  for (const row of rows) {
    const direction = classifyMovement(row?.type);
    if (direction === 'NEUTRAL') continue;

    totals.totalTransactions += 1;
    const delta = movementDelta(row);
    const magnitude = Math.abs(delta);

    if (direction === 'IN') totals.totalIn += magnitude;
    else if (direction === 'OUT') totals.totalOut += magnitude;
    else totals.totalAdjustment += delta;

    const id = itemIds(row);
    if (id) items.add(id);
  }

  totals.net = roundQuantity(totals.totalIn - totals.totalOut);
  totals.totalIn = roundQuantity(totals.totalIn);
  totals.totalOut = roundQuantity(totals.totalOut);
  totals.totalAdjustment = roundQuantity(totals.totalAdjustment);
  totals.itemCount = items.size;
  return totals;
};
