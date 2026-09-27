/**
 * FC-SEC-014 — the one place a date is turned into text.
 *
 * Sixteen call sites across eight components passed `'ar-EG'` to
 * `toLocaleString`, so the display locale was a literal in each file and the
 * system had no answer to "what locale does this app render in?" beyond "the one
 * someone typed here". A language setting exists in the app; a formatter that
 * ignores it is a decision made sixteen times by accident.
 *
 * Pass the active locale when you have it. The default keeps the previous
 * behaviour, so this is a consolidation and not a visual change.
 */

export const DEFAULT_DISPLAY_LOCALE = 'ar-EG';

const resolve = (locale?: string) => (locale && locale.trim() ? locale.trim() : DEFAULT_DISPLAY_LOCALE);

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Shown when there is no value at all, so a table cell is never blank. */
export const NO_DATE = '—';

/**
 * Date and time, e.g. ٢٧‏/٠٩‏/٢٠٢٦ ٠٥:١٤:٢٢
 *
 * `options` is passed through to `toLocaleString`, for the screens that want a
 * narrower shape (two-digit parts, date only, and so on).
 */
export const formatDateTime = (
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string => {
  const date = toDate(value);
  if (!date) return NO_DATE;
  return options ? date.toLocaleString(resolve(locale), options) : date.toLocaleString(resolve(locale));
};

/** Date only. */
export const formatDate = (value: string | number | Date | null | undefined, locale?: string): string => {
  const date = toDate(value);
  if (!date) return NO_DATE;
  return date.toLocaleDateString(resolve(locale));
};
