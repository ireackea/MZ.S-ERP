export function resolveWarehouseScope(role: string | undefined, requestedWarehouseId?: string): string {
  if (role === 'SuperAdmin') return String(requestedWarehouseId || '').trim() || 'all';
  return 'default';
}

export function warehouseScopeCondition(scope: string): { warehouseId?: string } {
  return scope === 'all' ? {} : { warehouseId: scope };
}

export function isGlobalScope(scope: string): boolean {
  return scope === 'all';
}
