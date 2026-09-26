import { describe, expect, it } from 'vitest';
import { validateDecimalString } from './decimal';

describe('decimal string boundary for stock mutations', () => {
  it('accepts exact quantities at the Prisma decimal scale', () => {
    expect(validateDecimalString('999999999.999').valid).toBe(true);
    expect(validateDecimalString('0.001').valid).toBe(true);
    expect(validateDecimalString('-0.001').valid).toBe(true);
  });

  it('rejects floats that cannot be represented safely at the boundary', () => {
    for (const value of [Number('0.1'), Number('0.2'), Number('9007199254740993')]) {
      expect(validateDecimalString(value)).toEqual({ valid: false, reason: 'format' });
    }
  });
});
