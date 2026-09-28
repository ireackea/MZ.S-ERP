import type { ReportColumnConfig } from '../types';

/**
 * Gate 3.5 — one definition of which columns a report can show.
 *
 * These two lived inside `OpeningBalancePage`, private to it. The settings tab
 * that was supposed to edit report columns could not import them, so it started
 * from an empty array: `reportConfig` is initialised to `[]` in the store and was
 * never hydrated, `getReportConfig()` in storage.ts had no call sites, and both
 * lists in that tab rendered zero rows forever. Its Save button reported success
 * and wrote to a Zustand store that nothing read.
 *
 * So the catalogue moves out where both the page and the settings screen can use
 * it, and the tab gets a real list to render. `mergeColumns` keeps its original
 * behaviour, including the de-duplication that repairs a corrupted save on first
 * load.
 */

/** The columns an opening-balance report can show. */
export const OPENING_BALANCE_COLUMNS: ReportColumnConfig[] = [
  { key: 'item', label: 'الصنف', isVisible: true },
  { key: 'quantity', label: 'الكمية', isVisible: true },
  { key: 'unitCost', label: 'تكلفة الوحدة', isVisible: true },
  { key: 'unit', label: 'وحدة القياس', isVisible: true },
  { key: 'category', label: 'الفئة', isVisible: true },
  { key: 'code', label: 'كود الصنف', isVisible: true },
];

/**
 * The columns an inventory / stock-card report can show.
 *
 * Separate from the opening-balance set because the two documents show different
 * things — this one is a movement report, that one a valuation.
 */
export const STOCK_CARD_COLUMNS: ReportColumnConfig[] = [
  { key: 'date', label: 'التاريخ', isVisible: true },
  { key: 'item', label: 'الصنف', isVisible: true },
  { key: 'code', label: 'كود الصنف', isVisible: true },
  { key: 'category', label: 'الفئة', isVisible: true },
  { key: 'unit', label: 'وحدة القياس', isVisible: true },
  { key: 'type', label: 'نوع الحركة', isVisible: true },
  { key: 'quantityIn', label: 'وارد', isVisible: true },
  { key: 'quantityOut', label: 'منصرف', isVisible: true },
  { key: 'unitCost', label: 'تكلفة الوحدة', isVisible: true },
  { key: 'total', label: 'الإجمالي', isVisible: true },
];

/**
 * Folds a stored config onto the canonical list.
 *
 * Unknown keys are dropped and missing ones are added back, in catalogue order. So
 * a column added to a report in a later release appears with its default rather
 * than being absent, and a key from an older release cannot linger as a phantom
 * row the report will never render.
 */
export const mergeColumns = (
  base: ReportColumnConfig[],
  incoming?: ReportColumnConfig[],
): ReportColumnConfig[] => {
  if (!incoming || incoming.length === 0) return base;

  const allowed = new Set(base.map((column) => column.key));

  // De-duplicated first, so a corrupted save that contains a key twice repairs
  // itself on first load instead of producing duplicate React keys.
  const deduped = [
    ...new Map(
      incoming
        .filter((column) => allowed.has(column.key))
        .map((column) => [column.key, column] as const),
    ).values(),
  ];

  const missing = base.filter((column) => !deduped.find((entry) => entry.key === column.key));
  return [...deduped, ...missing];
};
