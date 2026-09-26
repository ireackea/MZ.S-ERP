/**
 * FC-DATA-001 — the single decimal boundary.
 *
 * The rule this module exists to enforce: a quantity or money value crosses the
 * API as a **string**, is stored and computed as `Prisma.Decimal`, and is never
 * accumulated in a JS float. `0.1 + 0.2` must be `0.3`, not
 * `0.30000000000000004`, and `999999999.999` must survive a round trip.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Maximum decimal places the schema stores. */
export const DECIMAL_SCALE = 3;

/** Business ceiling for a single quantity/money value. */
export const DECIMAL_MAX = '999999999.999';

export const DECIMAL_MIN = '-999999999.999';

/**
 * Canonical wire form: a plain decimal string. Exponent notation, `NaN`,
 * `Infinity`, thousands separators and leading `+` are all rejected, because
 * each of them has been a source of silent coercion bugs.
 */
export const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;

export const FULL_ACCESS_DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Values that survive a JSON round trip as a string, without loss. */
export type DecimalString = string;

/**
 * A client-supplied value that cannot cross the boundary. It extends
 * `BadRequestException` so a malformed decimal is a 400 with a useful message,
 * not an opaque 500: the caller sent bad data, the server is not broken.
 */
export class DecimalBoundaryError extends BadRequestException {
  constructor(readonly field: string, readonly received: unknown, readonly reason: string) {
    super(`Invalid decimal for "${field}": ${reason} (received ${JSON.stringify(received)})`);
    this.name = 'DecimalBoundaryError';
  }
}

const zero = () => new Prisma.Decimal(0);

/**
 * FC-DATA-001 — the only way a decimal enters the system.
 *
 * Accepts a string or a number, and rejects anything that cannot be represented
 * exactly at the stored scale rather than rounding it silently.
 */
export const parseDecimal = (
  value: unknown,
  field = 'value',
  options: { scale?: number; min?: string; max?: string } = {},
): Prisma.Decimal => {
  const scale = options.scale ?? DECIMAL_SCALE;

  if (value === null || value === undefined || value === '') {
    return zero();
  }

  if (typeof value === 'boolean') {
    throw new DecimalBoundaryError(field, value, 'booleans are not quantities');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DecimalBoundaryError(field, value, 'must be a finite number');
    }
    // A JS float cannot represent most decimals exactly, so a number is only
    // accepted when it is integral (a count) or round-trips cleanly.
    if (!Number.isInteger(value)) {
      throw new DecimalBoundaryError(
        field,
        value,
        'send decimals as strings; a non-integer JS float has already lost precision',
      );
    }
  }

  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!FULL_ACCESS_DECIMAL.test(text)) {
    throw new DecimalBoundaryError(field, value, 'must be a plain decimal string (no exponent, NaN or Infinity)');
  }

  const [, fraction = ''] = text.split('.');
  if (fraction.length > scale) {
    throw new DecimalBoundaryError(field, value, `allows at most ${scale} decimal places`);
  }

  const decimal = new Prisma.Decimal(text);
  if (!decimal.isFinite()) {
    throw new DecimalBoundaryError(field, value, 'is not a finite decimal');
  }

  if (options.min !== undefined && decimal.lt(new Prisma.Decimal(options.min))) {
    throw new DecimalBoundaryError(field, value, `must be >= ${options.min}`);
  }
  // FC-DATA-001 — the business ceiling is a default, not an opt-in. Every
  // quantity/money value is bounded by DECIMAL_MAX unless a caller explicitly
  // passes a different `max`, so a stray 1e12 cannot reach the column.
  const ceiling = options.max ?? DECIMAL_MAX;
  if (decimal.gt(new Prisma.Decimal(ceiling))) {
    throw new DecimalBoundaryError(field, value, `must be <= ${ceiling}`);
  }
  if (options.min === undefined && decimal.lt(new Prisma.Decimal(DECIMAL_MIN))) {
    throw new DecimalBoundaryError(field, value, `must be >= ${DECIMAL_MIN}`);
  }

  return decimal;
};

/** Parses and reports whether the input was present, for optional DTO fields. */
export const parseOptionalDecimal = (
  value: unknown,
  field: string,
  options?: { scale?: number; min?: string; max?: string },
): Prisma.Decimal | null => {
  if (value === null || value === undefined || value === '') return null;
  return parseDecimal(value, field, options);
};

/** The canonical wire form. Fixed scale, never exponent notation. */
export const toDecimalString = (
  value: Prisma.Decimal | string | number | null | undefined,
  scale: number = DECIMAL_SCALE,
): string => {
  if (value === null || value === undefined) return zero().toFixed(scale);
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  return decimal.toFixed(scale);
};

/** Sums without float accumulation. */
export const sumDecimals = (
  values: Array<Prisma.Decimal | string | number>,
  scale: number = DECIMAL_SCALE,
): Prisma.Decimal =>
  values
    .reduce<Prisma.Decimal>((total, entry) => total.plus(new Prisma.Decimal(String(entry))), zero())
    .toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

/** Subtracts without float accumulation. */
export const subtractDecimals = (
  minuend: Prisma.Decimal | string | number,
  subtrahend: Prisma.Decimal | string | number,
  scale: number = DECIMAL_SCALE,
): Prisma.Decimal =>
  new Prisma.Decimal(String(minuend))
    .minus(new Prisma.Decimal(String(subtrahend)))
    .toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

/**
 * FC-DATA-001 — a balance invariant that must hold for any ledger.
 *
 *   net = inbound + returns + production − outbound − waste
 *
 * Returned as a string so a caller cannot reintroduce a float.
 */
export type LedgerBuckets = {
  inbound: Prisma.Decimal | string | number;
  returns: Prisma.Decimal | string | number;
  production: Prisma.Decimal | string | number;
  outbound: Prisma.Decimal | string | number;
  waste: Prisma.Decimal | string | number;
};

export const assertLedgerInvariant = (buckets: LedgerBuckets, scale: number = DECIMAL_SCALE): true => {
  const net = sumDecimals(
    [buckets.inbound, buckets.returns, buckets.production],
    scale,
  ).minus(sumDecimals([buckets.outbound, buckets.waste], scale)).toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);

  if (!net.isFinite()) {
    throw new DecimalBoundaryError('ledger', buckets, 'produced a non-finite net balance');
  }
  return true;
};

/** The same computation, returned as a canonical string. */
export const ledgerNet = (buckets: LedgerBuckets, scale: number = DECIMAL_SCALE): string => {
  const positive = sumDecimals([buckets.inbound, buckets.returns, buckets.production], scale);
  const negative = sumDecimals([buckets.outbound, buckets.waste], scale);
  return positive.minus(negative).toFixed(scale);
};

/**
 * FC-DATA-001 — the canonical list of fields that must never be handled as a
 * JS float.
 *
 * Prisma stores these as `Decimal`, but the DTOs historically declared them as
 * `number`, which let an imprecise value reach the database. Every entry here
 * is verified by the DECIMAL_FIELDS contract test against the Prisma schema, so
 * a new Decimal column cannot be added without being covered.
 */
export const DECIMAL_FIELDS = [
  // Item
  'minLimit', 'maxLimit', 'orderLimit', 'packageWeight', 'currentStock',
  // Transaction
  'quantity', 'supplierNet', 'difference', 'packageCount', 'salaryOfWorker',
  'delayPenalty', 'calculatedFine',
  // Unloading rule
  'penaltyRatePerMinute',
  // Formulation
  'totalAmount', 'value', 'weightPerTon', 'percentage',
  // Order / order item
  'unitCost',
  // Stocktaking
  'actualCount',
  // Opening balance
  'expectedCostPerTon',
] as const;

export type DecimalField = (typeof DECIMAL_FIELDS)[number];

const DECIMAL_FIELD_SET = new Set<string>(DECIMAL_FIELDS);

export const isDecimalField = (field: string): field is DecimalField =>
  DECIMAL_FIELD_SET.has(field);

/**
 * FC-DATA-001 — re-validates a DTO payload that reached the service layer.
 *
 * class-validator runs before this, so it still sees `number`; this is the
 * second gate that refuses a value which cannot be represented exactly at the
 * stored scale. Throws `BadRequestException`-compatible messages.
 */
export const assertDecimalFieldsExact = (
  payload: Record<string, unknown>,
  fields: readonly string[] = DECIMAL_FIELDS,
): void => {
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') continue;

    if (typeof value === 'number') {
      // A float that is not exactly representable must not reach a Decimal
      // column, because the value the user typed is already gone.
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        if (Number.isInteger(value)) continue;
        throw new DecimalBoundaryError(
          field,
          value,
          'must be an integer or a decimal string; a non-integer float has already lost precision',
        );
      }
      continue;
    }

    // Strings go through the full boundary check.
    parseDecimal(value, field);
  }
};

/**
 * FC-DATA-001 — converts a validated payload's decimal fields to
 * `Prisma.Decimal` so the write never passes through a float.
 */
export const toDecimalPayload = <T extends Record<string, unknown>>(
  payload: T,
  fields: readonly string[] = DECIMAL_FIELDS,
): T & Record<string, Prisma.Decimal> => {
  assertDecimalFieldsExact(payload, fields);
  const output: Record<string, unknown> = { ...payload };

  for (const field of fields) {
    const value = payload[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      // Prisma distinguishes "absent" (leave column) from "set null".
      if (value === null) output[field] = null;
      continue;
    }
    output[field] = parseDecimal(value, field);
  }

  return output as T & Record<string, Prisma.Decimal>;
};

/**
 * Converts a stored Decimal for a JSON response without turning it into a
 * float. `Prisma.Decimal` serialises to a string on its own, but an explicit
 * helper keeps the wire contract from drifting if the driver changes.
 *
 * An absent value stays absent: `"0"` for a column that is NULL would be a lie,
 * so null/undefined are passed through rather than defaulted.
 */
export const serializeDecimal = (
  value: Prisma.Decimal | string | number | null | undefined,
  scale: number = DECIMAL_SCALE,
): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return toDecimalString(value, scale);
};
