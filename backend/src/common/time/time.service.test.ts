import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeService } from './time.service';

const localDateKey = (service: TimeService, date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: service.businessTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

describe('TimeService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses date-only values at the start of the Cairo business day', () => {
    const service = new TimeService();
    const parsed = service.parseDate('2026-01-15');
    expect(localDateKey(service, parsed)).toBe('2026-01-15');
  });

  it('uses the next Cairo midnight as an inclusive upper bound', () => {
    const service = new TimeService();
    const upperBound = service.parseDate('2026-01-15', true);
    expect(localDateKey(service, upperBound)).toBe('2026-01-16');
  });

  it('creates financial-year boundaries in UTC from Cairo calendar boundaries', () => {
    const service = new TimeService();
    const range = service.getFinancialYearRange(2026);
    expect(localDateKey(service, range.start)).toBe('2026-01-01');
    expect(localDateKey(service, new Date(range.end.getTime() - 1))).toBe('2026-12-31');
  });

  it('derives the financial year and business date from the configured timezone', () => {
    const service = new TimeService();
    vi.spyOn(service, 'now').mockReturnValue(new Date('2026-01-01T23:30:00.000Z'));
    expect(service.getFinancialYear()).toBe(2026);
    expect(service.getBusinessDateKey()).toBe('2026-01-02');
  });
});
