/**
 * FC-API-002 — canonical operation-type aliases.
 *
 * The alias table lived as a private method inside `transaction.service` while
 * two report services each re-implemented a weaker version. The table is now
 * here, and the stock-movement classifier consumes it, so a type added in one
 * place is honoured everywhere.
 */

export type CanonicalOperationType =
  | 'وارد'
  | 'صادر'
  | 'انتاج'
  | 'هالك'
  | 'مرتجع'
  | 'STOCK_ADJUSTMENT';

const ALIASES: ReadonlyArray<{ canonical: CanonicalOperationType; values: readonly string[] }> = [
  {
    canonical: 'STOCK_ADJUSTMENT',
    values: ['stock_adjustment', 'stock adjustment', 'stock-adjustment', 'adjustment',
      'تسوية مخزون', 'تسوية المخزون', 'تعديل مخزون', 'تعديل المخزون'],
  },
  {
    // Checked before وارد: an inbound return is its own canonical bucket.
    canonical: 'مرتجع',
    values: ['5', 'return', 'returned', 'مرتجع', 'إرجاع', 'ارجاع'],
  },
  {
    canonical: 'هالك',
    values: ['4', 'waste', 'damaged', 'scrap', 'loss', 'هالك', 'تالف'],
  },
  {
    canonical: 'صادر',
    values: ['2', 'out', 'outgoing', 'outbound', 'export', 'sale', 'dispatch', 'consume', 'consumption',
      'صادر', 'صرف', 'بيع', 'مبيعات', 'خروج', 'تحويل_صادر'],
  },
  {
    canonical: 'انتاج',
    values: ['3', 'prod', 'production', 'manufacturing', 'انتاج', 'إنتاج', 'تصنيع'],
  },
  {
    canonical: 'وارد',
    values: ['1', 'in', 'incoming', 'import', 'purchase', 'receive', 'receipt', 'inbound',
      'وارد', 'استلام', 'ادخال', 'إدخال', 'شراء', 'مشتريات'],
  },
];

/** Arabic orthography folding so ة/ه and أ/ا/إ compare equal. */
const fold = (value: string): string =>
  value
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Returns the canonical label, or the trimmed input when nothing matches. */
export const resolveCanonicalOperationType = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const folded = fold(raw);
  for (const entry of ALIASES) {
    for (const alias of entry.values) {
      if (fold(alias) === folded) return entry.canonical;
    }
  }
  return raw;
};

/** The canonical label, or null when the value is not a known type. */
export const matchCanonicalOperationType = (value: unknown): CanonicalOperationType | null => {
  const resolved = resolveCanonicalOperationType(value);
  return (ALIASES.find((entry) => entry.canonical === resolved)?.canonical ?? null) as CanonicalOperationType | null;
};

/** Values a query should match for a canonical label, used to expand filters. */
export const expandOperationTypeAliases = (value: unknown): string[] => {
  switch (matchCanonicalOperationType(value)) {
    case 'وارد':
      return ['وارد', 'استلام', 'import', 'incoming', 'in', 'inbound', 'purchase', 'انتاج', 'إنتاج', 'production'];
    case 'صادر':
      return ['صادر', 'صرف', 'تحويل_صادر', 'export', 'outgoing', 'out', 'outbound', 'sale', 'هالك', 'تالف', 'waste', 'damaged'];
    case 'انتاج':
      return ['انتاج', 'إنتاج', 'تصنيع', 'production', 'manufacturing'];
    case 'هالك':
      return ['هالك', 'تالف', 'waste', 'damaged', 'scrap', 'loss'];
    case 'مرتجع':
      return ['مرتجع', 'إرجاع', 'ارجاع', 'return', 'returned'];
    case 'STOCK_ADJUSTMENT':
      return ['stock_adjustment', 'stock adjustment', 'stock-adjustment', 'تسوية مخزون', 'تعديل مخزون'];
    default:
      return [String(value ?? '').trim()].filter(Boolean);
  }
};
