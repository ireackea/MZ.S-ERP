import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

/**
 * `validateValue` was the looser side of a two-sided contract.
 *
 * The form enforced `maxLength` as input limits, a scheme allow-list on the logo URL,
 * and nothing at all on the company email. `validateValue` returned `String(raw)` with
 * no length check, no scheme check and no email check — so a request that skipped the
 * form stored a five-thousand-character company name into a TEXT column to appear on
 * every document header, put `javascript:` into a URL the browser later fetches, and
 * shipped a typo'd email address to whoever reads the documents.
 *
 * A limit the browser enforces and the API does not is a limit with no meaning, and
 * the comment above the logo input in the API client already said the scheme was
 * being defended.
 */
const prisma = { systemSetting: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() } };
const service = new SystemSettingsService(prisma as never);

const validate = (key: string, raw: unknown) =>
  (
    service as unknown as {
      validateValue: (d: unknown, v: unknown) => string | number | boolean;
    }
  ).validateValue(
    {
      key,
      label: 'قيمة',
      category: 'company',
      valueType: 'string',
      defaultValue: '',
      ...(key === 'company.name' || key === 'company.currency' ? { required: true } : {}),
      ...(key === 'company.name' ? { maxLength: 120 } : {}),
      ...(key === 'company.email' ? { maxLength: 120 } : {}),
      ...(key === 'company.logoUrl' ? { maxLength: 500 } : {}),
    },
    raw,
  );

beforeEach(() => {
  vi.clearAllMocks();
  prisma.systemSetting.findMany.mockResolvedValue([]);
});

describe('the server enforces what the form was enforcing alone', () => {
  it('refuses a company name past the column limit', () => {
    expect(() => validate('company.name', 'x'.repeat(121))).toThrow(BadRequestException);
    expect(validate('company.name', 'x'.repeat(120))).toBe('x'.repeat(120));
  });

  it('refuses a logo URL that is not http or https', () => {
    expect(() => validate('company.logoUrl', 'javascript:alert(1)')).toThrow(/http/);
    expect(() => validate('company.logoUrl', 'data:image/png;base64,AA')).toThrow(/http/);
    expect(validate('company.logoUrl', 'https://example.test/logo.png')).toBe('https://example.test/logo.png');
  });

  it('refuses a company email that is not an address', () => {
    expect(() => validate('company.email', 'not-an-email')).toThrow(/email/);
    expect(validate('company.email', 'a@b.test')).toBe('a@b.test');
  });

  it('trims before storing, not only before validating', () => {
    // The padding was persisted and the compare-and-set below compared padded strings,
    // so the audit row recorded the padded value too.
    expect(validate('company.name', '  الشركة  ')).toBe('الشركة');
  });

  it('still refuses to blank a required value', () => {
    expect(() => validate('company.name', '   ')).toThrow(/required/);
  });
});
