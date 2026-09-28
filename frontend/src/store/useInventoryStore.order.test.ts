import { describe, expect, it, beforeEach } from 'vitest';
import { useInventoryStore } from './useInventoryStore';
import type { Item } from '../types';

/**
 * Two ways the catalog order was destroyed without anything reporting it.
 *
 * Both were silent. Neither threw, and both left the screen looking correct, so
 * the only evidence available was that an item an operator had placed was no
 * longer where they put it — usually much later, and usually after someone had
 * already pressed save, which turned a view into a fact.
 */

const item = (id: string, name: string): Item => ({
  id,
  publicId: id,
  name,
  code: id,
  category: 'قسم',
  unit: 'كجم',
  minLimit: 0,
  maxLimit: 1000,
  currentStock: 0,
  lastUpdated: new Date(0).toISOString(),
});

const arranged = [
  item('c', 'جيم'),
  item('a', 'ألف'),
  item('d', 'دال'),
  item('b', 'باء'),
];

const orderOf = () => useInventoryStore.getState().items.map((entry) => entry.id);

describe('the saved catalog order survives looking at it', () => {
  beforeEach(() => {
    // The operator's arrangement, which is deliberately not alphabetical and not
    // the insertion order either — it is an order somebody chose.
    useInventoryStore.setState({
      items: arranged,
      manualOrder: ['c', 'a', 'd', 'b'],
      sortMode: 'manual_locked',
    });
  });

  it('switching to name_asc and back does not replace the order with the alphabet', () => {
    const { setSortMode } = useInventoryStore.getState();

    setSortMode('name_asc');
    expect(orderOf(), 'name_asc really does sort by name').toEqual(['a', 'b', 'c', 'd']);

    setSortMode('manual_locked');

    // This is the assertion that matters. The previous implementation rebuilt
    // `manualOrder` from whatever was on screen, so returning to manual mode
    // froze the alphabet into the saved order — and the next press of the save
    // button wrote that to the database.
    expect(
      orderOf(),
      'switching back to manual mode overwrote the saved order with the alphabet',
    ).toEqual(['c', 'a', 'd', 'b']);
    expect(
      useInventoryStore.getState().manualOrder,
      'the manual order itself must be unchanged, not just the rendering',
    ).toEqual(['c', 'a', 'd', 'b']);
  });

  it('switching to any other sort mode leaves the manual order alone', () => {
    const before = [...useInventoryStore.getState().manualOrder];

    for (const mode of ['name_desc', 'code_asc', 'category_then_name', 'name_asc'] as const) {
      useInventoryStore.getState().setSortMode(mode);
      expect(
        useInventoryStore.getState().manualOrder,
        `choosing ${mode} rewrote the saved order`,
      ).toEqual(before);
    }

    useInventoryStore.getState().setSortMode('manual_locked');
    expect(useInventoryStore.getState().items.map((entry) => entry.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('moving an item is the only thing that changes the order', () => {
    // The arrangement a user builds with the arrows is what eventually gets saved,
    // so it is the one path that is allowed to rewrite `manualOrder`.
    useInventoryStore.getState().moveItemManually('c', 'down', ['c', 'a', 'd', 'b']);
    expect(orderOf()).toEqual(['a', 'c', 'd', 'b']);
  });
});
