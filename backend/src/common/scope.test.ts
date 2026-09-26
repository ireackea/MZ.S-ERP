import { describe, expect, it } from 'vitest';
import { isGlobalScope, resolveWarehouseScope, warehouseScopeCondition } from './scope';

describe('server-side scope policy', () => {
  it('ignores request scope for non-superadmin users', () => {
    expect(resolveWarehouseScope('Manager', 'all')).toBe('default');
    expect(resolveWarehouseScope('Admin', 'warehouse_b')).toBe('default');
    expect(warehouseScopeCondition('default')).toEqual({ warehouseId: 'default' });
  });

  it('allows SuperAdmin to select a global or explicit warehouse scope', () => {
    expect(resolveWarehouseScope('SuperAdmin')).toBe('all');
    expect(resolveWarehouseScope('SuperAdmin', 'warehouse_b')).toBe('warehouse_b');
    expect(isGlobalScope('all')).toBe(true);
    expect(warehouseScopeCondition('all')).toEqual({});
  });
});
