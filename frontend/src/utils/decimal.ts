export const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const MAX_DECIMAL_INTEGER_DIGITS = 12;
export const MAX_DECIMAL_SCALE = 3;

export type DecimalString = string;

export type DecimalValidationResult =
  | { valid: true; value: DecimalString; scale: number }
  | { valid: false; reason: 'format' | 'integer-digits' | 'scale' };

export const validateDecimalString = (input: unknown): DecimalValidationResult => {
  if (typeof input !== 'string' || !DECIMAL_PATTERN.test(input)) {
    return { valid: false, reason: 'format' };
  }

  const [integerPart = '0', fractionPart = ''] = input.split('.');
  const unsignedIntegerPart = integerPart.startsWith('-') ? integerPart.slice(1) : integerPart;
  if (unsignedIntegerPart.length > MAX_DECIMAL_INTEGER_DIGITS) {
    return { valid: false, reason: 'integer-digits' };
  }

  if (fractionPart.length > MAX_DECIMAL_SCALE) {
    return { valid: false, reason: 'scale' };
  }

  return {
    valid: true,
    value: input,
    scale: fractionPart.length,
  };
};

export const formatDecimalString = (input: unknown, fallback = '0'): DecimalString => {
  const result = validateDecimalString(input);
  if (!result.valid) return fallback;
  return result.value;
};

/**
 * The integer string for a safe count, without the exponent notation JS uses
 * for very large numbers (`1e21` is a string the server would reject).
 */
const asStringExact = (input: number): string =>
  Number.isSafeInteger(input) ? input.toFixed(0) : String(input);

/**
 * FC-DATA-001 — the value a decimal field must carry on the wire.
 *
 * Every payload builder funnels its money and quantity fields through this. The
 * important part is that a value the user typed arrives as a string and is passed
 * through as a string. Parsing it to a number first and stringifying afterwards
 * would undo DATA-001 in the browser: `0.1 + 0.2` becomes "0.30000000000000004"
 * before the request is even built, and the server then correctly refuses it.
 *
 * A value that is already a number is only accepted when it round-trips
 * exactly, because at that point the precision may already be gone and quietly
 * coercing it would hide the problem instead of surfacing it.
 */
export const toApiDecimal = (input: unknown, field = 'value'): DecimalString | undefined => {
  if (input === undefined || input === null || input === '') return undefined;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const result = validateDecimalString(trimmed);
    if (!result.valid) {
      throw new Error(
        `${field}: "${trimmed}" is not a decimal the server accepts `
        + `(at most ${MAX_DECIMAL_SCALE} decimal places, no exponent notation)`,
      );
    }
    return result.value;
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`${field}: ${input} is not a finite quantity`);
    }
    // A non-integer number is refused, matching the server's rule exactly. A
    // round-trip check would not catch it: String(0.1 + 0.2) is
    // "0.30000000000000004" and Number() of that string is itself, so the
    // value looks stable while already being wrong. An integer count is the
    // only number a caller can pass safely.
    if (!Number.isInteger(input)) {
      throw new Error(
        `${field}: the number ${input} has already lost precision. `
        + `Send "${input}" as a string instead.`,
      );
    }
    return asStringExact(input);
  }

  throw new Error(`${field}: expected a decimal string, received ${typeof input}`);
};

/**
 * The same rule for an optional field, where "absent" and "zero" mean different
 * things to the server: an absent column must stay absent.
 */
export const toApiDecimalOptional = (input: unknown, field = 'value'): DecimalString | undefined => {
  if (input === undefined || input === null || input === '') return undefined;
  return toApiDecimal(input, field);
};
