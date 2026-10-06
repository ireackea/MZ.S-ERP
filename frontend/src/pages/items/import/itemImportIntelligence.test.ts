import { describe, it, expect } from 'vitest';
import { analyzeItemImportRows } from './itemImportIntelligence';
import type { ExcelImportColumnMatch, ExcelImportRow } from '@services/itemsService';
import type { Item } from '../../../types';

/**
 * The fuzzy duplicate check finds the single best match per row.
 *
 * The implementation reduced over the catalogue rather than sorting it to read the
 * first element. That is a smaller change than it looks: it is still one
 * `scoreSimilarity` call per (row, item) pair, and a benchmark put the two forms
 * within noise of each other at 400 rows against 900 items — 432ms against 431ms —
 * because the scoring dominates and the sort of 900 small numbers is invisible next
 * to it. So no performance claim is made here, and there is no timing test: one that
 * passes against both forms guards nothing and teaches people to trust a threshold
 * nobody verified.
 *
 * What *is* worth pinning is that the reduction answers the same question the sort
 * did, including the tie-break. Those two tests below fail if someone "optimises" the
 * reduction into an early return that skips equal-confidence candidates.
 */

const makeItem = (index: number): Item => ({
  id: index,
  publicId: `item-${index}`,
  name: `صنف تجريبي رقم ${index} قسم عام`,
  code: `C-${index}`,
  category: 'عام',
  unit: 'kg',
}) as unknown as Item;

const makeRow = (index: number): ExcelImportRow => ({
  sourceRow: index + 2,
  name: `صنف جديد رقم ${index} قسم عام`,
  code: `N-${index}`,
  category: 'عام',
  unit: 'kg',
});

const matches: ExcelImportColumnMatch[] = [
  { field: 'name', header: 'الاسم', label: 'الاسم', strategy: 'exact', confidence: 1 },
  { field: 'code', header: 'الكود', label: 'الكود', strategy: 'exact', confidence: 1 },
  { field: 'category', header: 'القسم', label: 'القسم', strategy: 'exact', confidence: 1 },
  { field: 'unit', header: 'الوحدة', label: 'الوحدة', strategy: 'exact', confidence: 1 },
];

/**
 * The form the reduction replaced, kept here as the oracle.
 *
 * It re-derives the answer by asking the module about one row at a time rather than
 * reaching for the private `scoreSimilarity`: the point of the comparison is the
 * *choice* — first-highest wins — not the arithmetic, and calling the public entry
 * point keeps the oracle honest if the scoring is ever changed.
 */
const bestBySort = (row: ExcelImportRow, items: Item[]) => {
  const perItem = items.map((item) => {
    const single = analyzeItemImportRows({
      rows: [row],
      existingItems: [item],
      columnMatches: matches,
    });
    const hit = single.rows[0].duplicates.find((entry) => entry.type === 'fuzzy-name');
    return { id: item.id, confidence: hit?.confidence ?? 0 };
  });
  return perItem.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
};

describe('analyzeItemImportRows — an archived match is a choice, not a conflict', () => {
  const archived: Item = {
    id: '7', publicId: 'item-7', name: 'صنف معتّق', code: 'RETIRED',
    category: 'عام' as never, unit: 'kg' as never, minLimit: 0, maxLimit: 0,
    currentStock: 0, isArchived: true,
  } as unknown as Item;

  it('does not mark the row as a blocking duplicate', () => {
    // The whole point. Marking it `duplicate` disabled the row, so the operator's only
    // options were to skip a row that was fine, or drop the code and create a second
    // item that the server would refuse anyway.
    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'صنف معتّق جديد', code: 'RETIRED', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: [archived],
      columnMatches: matches,
    });
    expect(result.rows[0].status, 'an archived code must not disable the row').not.toBe('duplicate');
    expect(result.rows[0].status).not.toBe('error');
  });

  it('says so on the row, so the operator is not surprised', () => {
    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'صنف معتّق جديد', code: 'RETIRED', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: [archived],
      columnMatches: matches,
    });
    const match = result.rows[0].duplicates.find((entry) => entry.type === 'archived-match');
    expect(match, 'the operator must be told the code belongs to a retired item').toBeDefined();
    expect(match?.label).toContain('صنف معتّق');
  });

  it('pre-wires the row to revive the archived item', () => {
    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'صنف معتّق جديد', code: 'RETIRED', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: [archived],
      columnMatches: matches,
    });
    expect(
      result.rows[0].row.publicId,
      'without the id the server creates a second item instead of reviving the first',
    ).toBe('item-7');
  });

  it('still blocks on a live item with the same code', () => {
    const live: Item = { ...archived, publicId: 'item-8', name: 'حيّ', isArchived: false } as unknown as Item;
    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'صنف', code: 'RETIRED', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: [live],
      columnMatches: matches,
    });
    expect(result.rows[0].status, 'a live code is still a hard conflict').toBe('duplicate');
  });

  it('an archived item never appears as an archived match twice for one row', () => {
    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'صنف', code: 'RETIRED', barcode: '999', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: [{ ...archived, barcode: '999' } as unknown as Item],
      columnMatches: matches,
    });
    const matchesFound = result.rows[0].duplicates.filter((entry) => entry.type === 'archived-match');
    expect(matchesFound).toHaveLength(1);
  });
});

describe('analyzeItemImportRows — the fuzzy check finds the true best match', () => {
  it('reports what the catalogue size is, so a partial check is visible', () => {
    const existingItems = Array.from({ length: 900 }, (_, index) => makeItem(index));
    const result = analyzeItemImportRows({
      rows: [makeRow(0)],
      existingItems,
      columnMatches: matches,
    });
    expect(result.summary.catalogueSize).toBe(900);
  });

  it('agrees with a sorted scan on the best match, for every row', () => {
    // The oracle is the exact selection rule that was replaced, so this fails loudly
    // if the reduction ever stops answering the same question.
    const existingItems = Array.from({ length: 60 }, (_, index) => makeItem(index));
    const rows = Array.from({ length: 25 }, (_, index) => makeRow(index));

    const result = analyzeItemImportRows({ rows, existingItems, columnMatches: matches });

    rows.forEach((row, index) => {
      const reported = result.rows[index].duplicates.find((entry) => entry.type === 'fuzzy-name');
      const expected = bestBySort(row, existingItems);
      if (!reported) {
        // No match above the threshold: the two forms must agree that there is none.
        expect(expected?.confidence ?? 0, `row ${index} disagreed on a miss`).toBeLessThan(0.72);
        return;
      }
      expect(reported.itemId, `row ${index} picked a different item`).toBe(
        String(expected?.id),
      );
      expect(reported.confidence).toBeCloseTo(expected?.confidence ?? 0, 10);
    });
  });

  it('keeps the earlier catalogue entry when two items tie', () => {
    // A descending sort puts the first of two equal scores first, and the reduction's
    // `>` does the same. An `>=` here would silently start reporting the *last* match
    // for every exact-name tie, which is a real item on a real shelf.
    const items = [
      { id: 11, name: 'زيت زيتون', code: null, publicId: 'item-11' },
      { id: 22, name: 'زيت زيتون', code: null, publicId: 'item-22' },
    ].map((entry) => ({ ...entry, category: 'عام', unit: 'kg' }) as unknown as Item);

    const result = analyzeItemImportRows({
      rows: [{ sourceRow: 2, name: 'زيت زيتون', category: 'عام', unit: 'kg' } as ExcelImportRow],
      existingItems: items,
      columnMatches: matches,
    });

    const fuzzy = result.rows[0].duplicates.find((entry) => entry.type === 'fuzzy-name');
    expect(fuzzy?.itemId, 'the first of two identical names wins, as a sorted scan would').toBe('11');
  });
});
