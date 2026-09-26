/**
 * FC-SEC-002 — legacy permission migration only.
 *
 * Keys are LEGACY ids that the UI may still hold in a persisted role matrix or
 * an old section gate. Values are CANONICAL catalog ids. Nothing here defines
 * a permission: the backend catalog does. This map exists so a stored legacy
 * grant is translated forward instead of silently dropped.
 */
const LEGACY_PERMISSION_ALIASES: Record<string, string[]> = {
  'users.view.management': ['users.view'],
  'users.create.management': ['users.create'],
  'users.update.management': ['users.update'],
  'users.delete.management': ['users.delete'],
  'users.export.management': ['users.audit'],
  'reports.view.general': ['reports.view'],
  'reports.export.general': ['reports.generate'],
  'inventory.view.items': ['items.view'],
  'inventory.create.items': ['items.create'],
  'inventory.update.items': ['items.update'],
  'inventory.delete.items': ['items.delete'],
  'inventory.view.operations': ['transactions.view'],
  'inventory.create.operations': ['transactions.create'],
  'inventory.update.operations': ['transactions.update'],
  'inventory.delete.operations': ['transactions.delete'],
  'inventory.view.stock': ['items.view', 'transactions.view'],
  'inventory.create.inbound': ['transactions.create'],
  'inventory.create.outbound': ['transactions.create'],
  'inventory.update.pricing': ['transactions.update'],
  'inventory.delete.transactions': ['transactions.delete'],
  'inventory.export.stock': ['reports.generate'],
  'inventory.view.opening_balances': ['opening-balances.view'],
  'inventory.reports.stock_card': ['reports.view'],
  'inventory.reports.statement': ['reports.view', 'transactions.view'],
  'sales.export.orders': ['sales.view.orders'],
  'settings.view.system': ['settings.view.general'],
  'settings.view': ['settings.view.general'],
  'settings.view.users': ['users.view'],
  'settings.view.permissions': ['users.update'],
  'settings.view.backup': ['backup.view'],
  'settings.view.reset': ['admin.reset_system'],
  'settings.view.audit': ['users.audit'],
  'settings.view.offline': ['settings.view.general'],
  'settings.view.printing': ['settings.view.general'],
  'settings.view.localization': ['theme.view'],
};

/** Kept as the exported name for callers that imported the old constant. */
export const PERMISSION_ALIASES = LEGACY_PERMISSION_ALIASES;

const expandPermission = (permission: string, visited: Set<string>): string[] => {
  const normalizedPermission = permission.trim();
  if (!normalizedPermission || visited.has(normalizedPermission)) {
    return [];
  }

  visited.add(normalizedPermission);

  const aliases = LEGACY_PERMISSION_ALIASES[normalizedPermission] || [];
  return [
    normalizedPermission,
    ...aliases.flatMap((alias) => expandPermission(alias, visited)),
  ];
};

/**
 * Expands a permission id through the legacy migration map so both a legacy id
 * and its canonical replacement resolve to the same accepted set.
 */
export const expandRequestedPermissions = (permission: string): string[] => {
  return [...new Set(expandPermission(permission, new Set()))];
};

export const matchesGrantedPermission = (granted: string, requested: string) => {
  if (granted === requested) {
    return true;
  }

  // The full-access wildcard grants everything, matching RbacGuard.
  if (granted === '*') {
    return true;
  }

  if (!granted.endsWith('.*')) {
    return false;
  }

  const prefix = granted.slice(0, -2);
  return requested === prefix || requested.startsWith(`${prefix}.`);
};

/**
 * FC-SEC-002 — both sides are expanded through the legacy migration map, so a
 * role still holding a legacy grant satisfies a canonical UI check, and a
 * canonical grant satisfies a legacy UI gate. The catalog stays the only
 * definition of what exists; this only reconciles old spellings.
 */
export const hasGrantedPermission = (grantedPermissions: string[], permission: string) => {
  const requestedPermissions = expandRequestedPermissions(permission);
  const granted = grantedPermissions.flatMap((entry) => expandRequestedPermissions(entry));
  return requestedPermissions.some((requestedPermission) => (
    granted.some((grantedPermission) => matchesGrantedPermission(grantedPermission, requestedPermission))
  ));
};