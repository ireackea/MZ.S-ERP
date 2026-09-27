import { describe, expect, it } from 'vitest';
import { toApiDecimal, toApiDecimalOptional } from './decimal';

/**
 * FC-DATA-001 — the wire form of a decimal, on the client side.
 *
 * The rule the server enforces is: a decimal crosses as a string, and a bare
 * non-integer float is refused. These tests pin the client half, because the
 * gap that actually shipped was here: the server had already moved to strings
 * and the operations screen was still calling Number(quantity), so entering
 * 10.5 produced a 400 nobody could explain.
 */
describe('toApiDecimal — the client side of the decimal boundary', () => {
  it('passes a typed value through unchanged', () => {
    expect(toApiDecimal('10.5', 'quantity')).toBe('10.5');
    expect(toApiDecimal('0.1', 'quantity')).toBe('0.1');
    expect(toApiDecimal('999999999.999', 'quantity')).toBe('999999999.999');
    expect(toApiDecimal(' 42 ', 'quantity')).toBe('42');
    expect(toApiDecimal('-0.5', 'quantity')).toBe('-0.5');
  });

  it('refuses a value the server would refuse, before it is sent', () => {
    // Failing here, where the row can still be corrected, is far better than a
    // 400 that names a field the operator never saw.
    expect(() => toApiDecimal('10.5555', 'quantity')).toThrow(/3 decimal places/);
    expect(() => toApiDecimal('abc', 'quantity')).toThrow();
    expect(() => toApiDecimal('1e9', 'quantity')).toThrow();
    expect(() => toApiDecimal('Infinity', 'quantity')).toThrow();
    expect(() => toApiDecimal(true as any, 'quantity')).toThrow();
  });

  it('refuses a float that has already lost precision instead of coercing it', () => {
    // 0.1 + 0.2 is the whole reason the contract changed. Coercing this to a
    // string would send "0.30000000000000004" and quietly reintroduce the drift.
    expect(() => toApiDecimal(0.1 + 0.2, 'quantity')).toThrow(/already lost precision/);
  });

  it('accepts a number that is exactly representable', () => {
    expect(toApiDecimal(10, 'quantity')).toBe('10');
    expect(toApiDecimal(0, 'quantity')).toBe('0');
    expect(toApiDecimal(-5, 'quantity')).toBe('-5');
  });

  it('treats an absent optional field as absent, not as zero', () => {
    // "leave the column alone" and "set it to zero" are different instructions
    // to the server, so undefined must survive.
    expect(toApiDecimalOptional(undefined, 'supplierNet')).toBeUndefined();
    expect(toApiDecimalOptional(null, 'supplierNet')).toBeUndefined();
    expect(toApiDecimalOptional('', 'supplierNet')).toBeUndefined();
    expect(toApiDecimalOptional('0', 'supplierNet')).toBe('0');
  });

  it('names the offending field so the message is actionable', () => {
    expect(() => toApiDecimal('bad', 'packageCount')).toThrow(/packageCount/);
  });
});
