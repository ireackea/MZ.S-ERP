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
