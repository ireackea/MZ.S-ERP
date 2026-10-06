import { describe, expect, it } from 'vitest';
import {
  BACKUP_FILTERS,
  countArchives,
  countForFilter,
  filterArchives,
  type FilterableArchive,
} from './backup-log-filter';

/**
 * One variable used to drive three unrelated things: which records the log showed, which
 * kind of backup the primary button created, and what that button was labelled. Choosing a
 * filter therefore changed what the button did — the operator reported that
 * «إنشاء نسخة كاملة» turned into «إنشاء نسخة المخزون» when they picked the inventory
 * filter, which was already a separate button.
 *
 * These are the pure decisions. The coupling itself cannot be tested here, because it lived
 * in a component with no test file; that half is held by a source-level guard instead.
 */

const archive = (type: string, createdAt = '2026-01-01T00:00:00.000Z'): FilterableArchive => ({
  type,
  createdAt,
});

describe('the default shows everything', () => {
  it('`all` is the first option offered', () => {
    expect(BACKUP_FILTERS[0].value).toBe('all');
  });

  it('`all` returns every kind, including the two a `full` filter used to hide', () => {
    // The default was `full`, which showed full + safety_snapshot and hid every config and
    // inventory archive. On a server holding mostly config archives the log read as empty.
    const archives = [
      archive('full'),
      archive('inventory'),
      archive('config'),
      archive('safety_snapshot'),
    ];
    expect(filterArchives(archives, 'all')).toHaveLength(4);
  });
});

describe('a filter narrows to exactly one kind', () => {
  it('each filter returns only its own kind', () => {
    const archives = [
      archive('full'),
      archive('inventory'),
      archive('config'),
      archive('safety_snapshot'),
    ];
    expect(filterArchives(archives, 'full')).toHaveLength(1);
    expect(filterArchives(archives, 'inventory')[0].type).toBe('inventory');
    expect(filterArchives(archives, 'config')[0].type).toBe('config');
    expect(filterArchives(archives, 'safety_snapshot')[0].type).toBe('safety_snapshot');
  });

  it('`full` no longer implies `safety_snapshot`', () => {
    // They shared one filter before, which made `full` change what the log contained
    // without saying so, and made each one's count lie about the other.
    const archives = [archive('full'), archive('safety_snapshot')];
    const shown = filterArchives(archives, 'full');
    expect(shown).toHaveLength(1);
    expect(shown[0].type).toBe('full');
  });
});

describe('order is newest first regardless of the filter', () => {
  it('sorts before narrowing, so the list never depends on server order', () => {
    const archives = [
      archive('full', '2026-01-01T00:00:00.000Z'),
      archive('full', '2026-03-01T00:00:00.000Z'),
      archive('full', '2026-02-01T00:00:00.000Z'),
    ];
    const shown = filterArchives(archives, 'full');
    expect(shown.map((entry) => entry.createdAt)).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const archives = [archive('full', '2026-01-01T00:00:00.000Z'), archive('full', '2026-03-01T00:00:00.000Z')];
    const before = [...archives];
    filterArchives(archives, 'all');
    expect(archives).toEqual(before);
  });
});

describe('the counts say what a filter would show', () => {
  it('counts each kind separately', () => {
    const counts = countArchives([
      archive('full'),
      archive('full'),
      archive('config'),
      archive('safety_snapshot'),
    ]);
    expect(counts).toEqual({ full: 2, inventory: 0, config: 1, safety_snapshot: 1 });
  });

  it('agrees with the filter it labels', () => {
    // A count that disagrees with the list is worse than no count: it turns "this filter
    // hides something" into "the backup does not exist".
    const archives = [
      archive('full'),
      archive('inventory'),
      archive('inventory'),
      archive('config'),
      archive('safety_snapshot'),
    ];
    for (const filter of BACKUP_FILTERS) {
      expect(countForFilter(archives, filter.value), `filter ${filter.value}`).toBe(
        filterArchives(archives, filter.value).length,
      );
    }
  });

  it('ignores an unknown kind rather than counting it as something', () => {
    const counts = countArchives([archive('full'), archive('something-else')]);
    expect(counts.full).toBe(1);
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(1);
  });

  it('handles having no archives at all', () => {
    expect(countArchives([])).toEqual({ full: 0, inventory: 0, config: 0, safety_snapshot: 0 });
    expect(countForFilter([], 'all')).toBe(0);
  });
});