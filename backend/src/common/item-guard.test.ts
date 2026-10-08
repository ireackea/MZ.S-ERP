import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertItemIsNotArchived } from './item-guard';

/**
 * The rule that three modules each had to remember separately, and two of which did not.
 *
 * `isArchived` was honoured by `item.service`, `formulation` and `import-batch`. It was
 * honoured by none of the three paths that *write* against an item: movements, stocktaking
 * counts and order lines. On the movements path that was measured — transaction 835 against
 * an item with `isArchived = true` — so a retired item kept accumulating stock, which fed
 * balances, deficits and every report.
 *
 * Three copies of one rule is how the first two drifted. This is the one copy.
 */
describe('assertItemIsNotArchived', () => {
  it('passes an active item', () => {
    expect(() => assertItemIsNotArchived({ isArchived: false, name: 'صنف' })).not.toThrow();
  });

  it('treats a missing flag as active rather than as a fault', () => {
    // Every caller selects `isArchived`; a row where it is absent must not become a
    // blanket refusal, or adding a field to one query would break the other two paths.
    expect(() => assertItemIsNotArchived({ name: 'صنف' })).not.toThrow();
    expect(() => assertItemIsNotArchived({ isArchived: null })).not.toThrow();
  });

  it('refuses an archived item and names it', () => {
    expect(() => assertItemIsNotArchived({ isArchived: true, name: 'مركزات دجاج' }))
      .toThrow(/مركزات دجاج/);
  });

  it('names the item by publicId when it has no name', () => {
    expect(() => assertItemIsNotArchived({ isArchived: true, name: null, publicId: 'zz-7' }))
      .toThrow(/zz-7/);
  });

  it('falls back to the identifier the caller was given', () => {
    expect(() => assertItemIsNotArchived({ isArchived: true }, 'public-id-42'))
      .toThrow(/public-id-42/);
  });

  it('says what to do about it, not merely that it failed', () => {
    expect(() => assertItemIsNotArchived({ isArchived: true, name: 'x' }))
      .toThrow(/Restore it/);
  });
});