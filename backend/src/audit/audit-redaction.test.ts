import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  REDACTED,
  containsSensitiveMaterial,
  isSensitiveKey,
  redactMetadata,
  redactValue,
} from './audit-redaction';

describe('FC-AUD-001 audit redaction', () => {
  it('masks credential-shaped keys at any depth', () => {
    const redacted = redactMetadata({
      username: 'superadmin',
      password: 'Str0ngPassw0rd!',
      nested: { apiKey: 'AKIA123', deeper: { token: 'abc' } },
      list: [{ secret: 'x' }],
    }) as Record<string, any>;

    expect(redacted.username).toBe('superadmin');
    expect(redacted.password).toBe(REDACTED);
    expect(redacted.nested.apiKey).toBe(REDACTED);
    expect(redacted.nested.deeper.token).toBe(REDACTED);
    expect(redacted.list[0].secret).toBe(REDACTED);
  });

  it('masks the reset/confirmation secrets used by the reset flow', () => {
    const redacted = redactMetadata({
      confirmationCode: 'SYSTEM_RESET_TOKEN_VALUE',
      challengeCode: 'ABC123',
      challengeId: 'c-1',
      otp: '999111',
      pin: '1234',
    }) as Record<string, any>;

    expect(redacted.confirmationCode).toBe(REDACTED);
    expect(redacted.challengeCode).toBe(REDACTED);
    expect(redacted.otp).toBe(REDACTED);
    expect(redacted.pin).toBe(REDACTED);
    // A challenge id is an identifier, not a secret.
    expect(redacted.challengeId).toBe('c-1');
  });

  it('masks credential-shaped values even under an innocent key', () => {
    const redacted = redactMetadata({
      note: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc123def',
      other: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
    }) as Record<string, any>;

    expect(redacted.note).toBe(REDACTED);
    expect(redacted.other).toBe(REDACTED);
  });

  it('keeps ordinary business fields readable', () => {
    const redacted = redactMetadata({
      itemId: 'ITEM-1',
      quantity: 42,
      type: 'وارد',
      warehouseId: 'default',
      adjustmentReason: 'جرد',
      nested: { price: 10.5, active: true },
    }) as Record<string, any>;

    expect(redacted).toMatchObject({
      itemId: 'ITEM-1',
      quantity: 42,
      type: 'وارد',
      warehouseId: 'default',
      adjustmentReason: 'جرد',
    });
    expect(redacted.nested).toEqual({ price: 10.5, active: true });
  });

  it('survives cycles, huge strings and long arrays', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => redactValue(cyclic)).not.toThrow();

    const long = 'x'.repeat(5000);
    expect(String(redactValue(long))).toContain('truncated');

    const wide = redactValue(Array.from({ length: 120 }, (_, i) => i)) as unknown[];
    expect(wide.length).toBeLessThanOrEqual(51);
  });

  it('classifies sensitive keys and reports material presence', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('sessionId')).toBe(true);
    expect(isSensitiveKey('itemId')).toBe(false);
    expect(isSensitiveKey('quantity')).toBe(false);

    expect(containsSensitiveMaterial({ password: 'x' })).toBe(true);
    expect(containsSensitiveMaterial({ itemId: 'x' })).toBe(false);
  });
});
