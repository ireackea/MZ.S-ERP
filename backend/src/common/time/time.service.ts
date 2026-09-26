import { Injectable } from '@nestjs/common';

export type BusinessDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type DateRange = {
  start: Date;
  end: Date;
};

@Injectable()
export class TimeService {
  readonly businessTimeZone = String(process.env.BUSINESS_TIME_ZONE || 'Africa/Cairo').trim() || 'Africa/Cairo';

  now(): Date {
    return new Date();
  }

  getFinancialYear(date: Date = this.now()): number {
    return this.getZonedParts(date).year;
  }

  getBusinessDateKey(date: Date = this.now()): string {
    const parts = this.getZonedParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  getBusinessDayRange(date: Date = this.now()): DateRange {
    const key = this.getBusinessDateKey(date);
    return {
      start: this.parseDate(key),
      end: this.parseDate(this.addCalendarDays(key, 1)),
    };
  }

  getFinancialYearRange(year: number): DateRange {
    const normalizedYear = Math.trunc(Number(year));
    if (!Number.isInteger(normalizedYear)) {
      throw new Error('Financial year must be an integer');
    }
    return {
      start: this.zonedDateTimeToUtc(`${normalizedYear}-01-01T00:00:00`),
      end: this.zonedDateTimeToUtc(`${normalizedYear + 1}-01-01T00:00:00`),
    };
  }

  parseDate(value: string | Date, endOfDay = false): Date {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new Error('Invalid date');
      return new Date(value.getTime());
    }

    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const start = this.zonedDateTimeToUtc(`${raw}T00:00:00`);
      return endOfDay ? this.zonedDateTimeToUtc(`${this.addCalendarDays(raw, 1)}T00:00:00`) : start;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date');
    return parsed;
  }

  private getZonedParts(date: Date): BusinessDateParts {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.businessTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    };
  }

  private zonedDateTimeToUtc(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw new Error('Invalid zoned date-time');
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = desired;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = this.getZonedParts(new Date(guess));
      const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const difference = desired - observed;
      if (difference === 0) return new Date(guess);
      guess += difference;
    }

    return new Date(guess);
  }

  private addCalendarDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }
}
