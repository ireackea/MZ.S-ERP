import { describe, expect, it } from 'vitest';
import { getInventoryStatus } from './inventoryStatus';

describe('getInventoryStatus', () => {
  it('treats equality with minLimit as warning', () => {
    expect(getInventoryStatus({ balance: 5, minLimit: 5 }).key).toBe('warning');
  });

  it('treats equality with orderLimit as critical', () => {
    expect(getInventoryStatus({ balance: 3, minLimit: 5, orderLimit: 3 }).key).toBe('critical');
  });
});