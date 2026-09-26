import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  DECIMAL_MAX,
  DECIMAL_SCALE,
  DECIMAL_STRING_PATTERN,
  DecimalBoundaryError,
  assertLedgerInvariant,
  ledgerNet,
  parseDecimal,
  parseOptionalDecimal,
  serializeDecimal,
  subtractDecimals,
  sumDecimals,
  toDecimalString,
} from './decimal';

describe('FC-DATA-001 decimal boundary', () => {
  describe('the float trap the card exists to prevent', () => {
    it('0.1 + 0.2 is exactly 0.3, not 0.30000000000000004', () => {
      const naive = 0.1 + 0.2;
      expect(naive).not.toBe(0.3); // proves the hazard is real

      const exact = sumDecimals([0.1, 0.2]);
      expect(toDecimalString(exact)).toBe('0.300');
      expect(Number(toDecimalString(exact))).toBe(0.3);
    });

    it('refuses a non-integer JS float instead of accepting already-lost precision', () => {
      expect(() => parseDecimal(0.1, 'quantity')).toThrow(DecimalBoundaryError);
      expect(() => parseDecimal(0.1, 'quantity')).toThrow(/send decimals as strings/i);
      // The same value as a string is accepted.
      expect(toDecimalString(parseDecimal('0.1', 'quantity'))).toBe('0.100');
      // An integral count is fine as a number.
      expect(toDecimalString(parseDecimal(42, 'count'))).toBe('42.000');
    });

    it('does not accumulate drift over many rows', () => {
      const rows = Array.from({ length: 1000 }, () => '0.1');
      expect(toDecimalString(sumDecimals(rows))).toBe('100.000');
    });
  });

  describe('boundary values', () => {
    it('accepts the documented maximum and rejects one above it', () => {
      expect(toDecimalString(parseDecimal(DECIMAL_MAX, 'quantity'))).toBe('999999999.999');
      expect(() => parseDecimal('1000000000.000', 'quantity', { max: DECIMAL_MAX })).toThrow(/<=/);
    });

    it('enforces the scale centrally', () => {
      expect(toDecimalString(parseDecimal('1.234'))).toBe('1.234');
      expect(() => parseDecimal('1.2345', 'quantity')).toThrow(/at most 3 decimal places/i);
      // A looser scale is opt-in per field, and the wire form follows it.
      expect(toDecimalString(parseDecimal('1.23456', 'rate', { scale: 5 }), 5)).toBe('1.23456');
    });

    it('rejects the non-canonical spellings that cause silent coercion', () => {
      for (const bad of [
        'NaN', 'Infinity', '-Infinity', '1e5', '1E5', '+1', '1,000', ' 1 . 0',
        '0x10', '1.', '.5', '--1', '1.2.3', 'null', 'undefined',
      ]) {
        expect(() => parseDecimal(bad, 'quantity'), `${bad} must be rejected`).toThrow(DecimalBoundaryError);
      }
    });

    it('matches the canonical pattern exactly', () => {
      for (const good of ['0', '-0', '1', '-1', '1.5', '-1.5', '999999999.999', '0.001']) {
        expect(DECIMAL_STRING_PATTERN.test(good), `${good} should match`).toBe(true);
      }
      for (const bad of ['+1', '1.', '.5', '1.2345', '1e5', '']) {
        expect(DECIMAL_STRING_PATTERN.test(bad), `${bad} should not match`).toBe(false);
      }
    });

    it('treats an empty value as zero rather than an error, for optional money fields', () => {
      expect(toDecimalString(parseDecimal(null, 'price'))).toBe('0.000');
      expect(toDecimalString(parseDecimal('', 'price'))).toBe('0.000');
      expect(toDecimalString(parseDecimal(undefined, 'price'))).toBe('0.000');
    });

    it('distinguishes "absent" from zero for optional fields', () => {
      expect(parseOptionalDecimal(null, 'discount')).toBeNull();
      expect(parseOptionalDecimal(undefined, 'discount')).toBeNull();
      expect(parseOptionalDecimal('0', 'discount')).not.toBeNull();
    });
  });

  describe('API round trip preserves precision', () => {
    it('survives a JSON round trip unchanged', () => {
      // The wire form is fixed-scale, so the round trip is compared against the
      // canonical rendering rather than the raw input spelling.
      for (const value of ['0.100', '0.300', '999999999.999', '-42.125', '0.001']) {
        const parsed = parseDecimal(value, 'quantity');
        const wire = serializeDecimal(parsed);
        const json = JSON.parse(JSON.stringify({ quantity: wire }));
        expect(json.quantity).toBe(value);
        expect(toDecimalString(parseDecimal(json.quantity, 'quantity'))).toBe(value);
      }
    });

    it('normalises a loose input to the canonical fixed scale', () => {
      // "0.1" is accepted on the way in and always leaves as "0.100", so a
      // consumer never has to guess the precision.
      expect(serializeDecimal(parseDecimal('0.1', 'quantity'))).toBe('0.100');
      expect(serializeDecimal(parseDecimal('5', 'quantity'))).toBe('5.000');
    });

    it('emits a fixed scale so the wire format is stable', () => {
      expect(toDecimalString(parseDecimal('5', 'quantity'))).toBe('5.000');
      expect(toDecimalString(parseDecimal('5.1', 'quantity'))).toBe('5.100');
      expect(toDecimalString(parseDecimal('5.12', 'quantity'))).toBe('5.120');
      expect(toDecimalString(null)).toBe('0.000');
    });

    it('never emits exponent notation for extreme magnitudes', () => {
      const wire = toDecimalString(parseDecimal('0.000000000001', 'tiny', { scale: 12 }), 12);
      expect(wire).not.toMatch(/e/i);
      expect(wire.startsWith('0.000000000001')).toBe(true);
    });
  });

  describe('ledger balance invariant', () => {
    it('holds: net = in + returns + production - out - waste', () => {
      const buckets = { inbound: '100', returns: '10', production: '50', outbound: '80', waste: '5' };
      assertLedgerInvariant(buckets);
      expect(ledgerNet(buckets)).toBe('75.000');
    });

    it('holds for the classic double-entry case', () => {
      // 0.1 * 10 received, 0.3 spent, in quantities that float cannot represent.
      const buckets = { inbound: '1', returns: '0', production: '0', outbound: '0.3', waste: '0' };
      expect(ledgerNet(buckets)).toBe('0.700');
    });

    it('holds across a deterministic randomised fixture set', () => {
      // Deterministic pseudo-random fixtures: the same seed must always agree.
      let seed = 20260926;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      for (let i = 0; i < 200; i += 1) {
        const qty = () => (next() * 1000).toFixed(3);
        const buckets = {
          inbound: qty(), returns: qty(), production: qty(),
          outbound: qty(), waste: qty(),
        };

        const expected = new Prisma.Decimal(buckets.inbound)
          .plus(buckets.returns)
          .plus(buckets.production)
          .minus(buckets.outbound)
          .minus(buckets.waste)
          .toFixed(DECIMAL_SCALE);

        // Summed independently, then compared.
        expect(ledgerNet(buckets)).toBe(expected);
        expect(() => assertLedgerInvariant(buckets)).not.toThrow();
      }
    });

    it('rejects a non-finite bucket rather than reporting a bogus balance', () => {
      expect(() => assertLedgerInvariant({ inbound: 'NaN', returns: '0', production: '0', outbound: '0', waste: '0' }))
        .toThrow(DecimalBoundaryError);
    });

    it('handles negative corrections on either side', () => {
      expect(ledgerNet({ inbound: '-50', returns: '0', production: '0', outbound: '0', waste: '0' })).toBe('-50.000');
      expect(ledgerNet({ inbound: '0', returns: '0', production: '0', outbound: '-25', waste: '0' })).toBe('25.000');
    });
  });

  describe('arithmetic helpers', () => {
    it('sums and subtracts without float drift', () => {
      expect(toDecimalString(sumDecimals(['0.1', '0.2', '0.3']))).toBe('0.600');
      expect(toDecimalString(subtractDecimals('10.005', '0.005'))).toBe('10.000');
      expect(toDecimalString(subtractDecimals('1', '1'))).toBe('0.000');
    });

    it('rounds half-up at the stored scale', () => {
      expect(toDecimalString(sumDecimals(['0.0005']), 3)).toBe('0.001');
      expect(toDecimalString(sumDecimals(['0.0004']), 3)).toBe('0.000');
    });

    it('treats an empty sum as zero', () => {
      expect(toDecimalString(sumDecimals([]))).toBe('0.000');
    });

    it('accepts a Decimal instance without re-parsing it as a float', () => {
      const value = new Prisma.Decimal('123.456');
      expect(toDecimalString(value)).toBe('123.456');
      expect(toDecimalString(sumDecimals([value, value]))).toBe('246.912');
    });
  });

  describe('error messages name the field', () => {
    it('identifies the offending field so a 400 is actionable', () => {
      try {
        parseDecimal('1.23456', 'quantity');
        expect.unreachable('should have thrown');
      } catch (error: any) {
        expect(error.field).toBe('quantity');
        expect(error.received).toBe('1.23456');
        expect(error.message).toContain('quantity');
        expect(error.message).toContain('3 decimal places');
      }
    });
  });

  describe('the ceiling is a default, not an opt-in', () => {
    it('rejects a value above DECIMAL_MAX without the caller passing max', () => {
      expect(() => parseDecimal('1000000000', 'quantity')).toThrow(/must be <= 999999999\.999/);
    });

    it('accepts exactly DECIMAL_MAX', () => {
      expect(parseDecimal('999999999.999', 'quantity').toString()).toBe('999999999.999');
    });

    it('rejects a value below DECIMAL_MIN', () => {
      expect(() => parseDecimal('-1000000000', 'quantity')).toThrow(/must be >= -999999999\.999/);
    });

    it('still honours an explicit wider max when a caller really needs one', () => {
      expect(parseDecimal('1000000000', 'weight', { max: '9999999999999' }).toString())
        .toBe('1000000000');
    });
  });

  describe('a bad decimal is a 400, not an opaque 500', () => {
    it('surfaces as BadRequestException so the client is told it sent bad data', () => {
      // A malformed value must not be reported as a server fault: the caller can
      // fix it, and a 500 would mask the real cause in production logs.
      expect(() => parseDecimal(0.1 + 0.2, 'quantity')).toThrow(BadRequestException);
      expect(() => parseDecimal('abc', 'quantity')).toThrow(BadRequestException);
      expect(() => parseDecimal('1e9', 'quantity')).toThrow(BadRequestException);
      const error: any = (() => {
        try { parseDecimal('nope', 'supplierNet'); } catch (e) { return e; }
      })();
      expect(error.getStatus()).toBe(400);
      expect(error).toBeInstanceOf(BadRequestException);
    });
  });
});
