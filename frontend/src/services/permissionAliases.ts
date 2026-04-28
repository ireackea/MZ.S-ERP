const PERMISSION_ALIASES: Record<string, string[]> = {
  'users.view.management': ['users.view'],
  'users.create.management': ['users.create'],
  'users.update.management': ['users.update'],
  'users.delete.management': ['users.delete'],
  'users.export.management': ['users.audit'],
  'reports.view': ['reports.view.general'],
  'reports.view.general': ['reports.view'],
  'reports.generate': ['reports.export.general'],
  'reports.export.general': ['reports.generate'],
  'inventory.view.items': ['items.view'],
  'inventory.create.items': ['items.create', 'items.sync'],
  'inventory.update.items': ['items.update', 'items.sync'],
  'inventory.delete.items': ['items.delete'],
  'inventory.view.operations': ['transactions.view'],
  'inventory.create.operations': ['transactions.create'],
  'inventory.update.operations': ['transactions.update'],
  'inventory.delete.operations': ['transactions.delete'],
  'inventory.view.stock': ['items.view', 'transactions.view'],
  'inventory.view.stocktaking': ['inventory.view.stock'],
  'inventory.create.inbound': ['transactions.create'],
  'inventory.create.outbound': ['transactions.create'],
  'inventory.update.pricing': ['transactions.update'],
  'inventory.delete.transactions': ['transactions.delete'],
  'inventory.view.opening_balances': ['opening-balances.view'],
  'inventory.reports.stock_card': ['reports.view', 'inventory.view.stock'],
  'inventory.reports.statement': ['reports.view', 'transactions.view'],
  'partners.view': ['transactions.view', 'sales.view.orders'],
  'settings.view.system': ['settings.view', 'theme.view', 'backup.view'],
  'settings.view': ['settings.view.general', 'settings.view.system'],
  'settings.view.general': ['settings.view', 'settings.view.system'],
  'settings.view.users': ['users.view.management'],
  'settings.view.permissions': ['users.view.management'],
  'settings.view.backup': ['backup.create', 'backup.restore', 'backup.schedule', 'backup.download', 'backup.delete', 'backup.view'],
  'settings.view.reset': ['admin.reset_system', 'system.reset'],
  'settings.view.audit': ['users.audit'],
  'settings.view.offline': ['settings.view.system'],
  'settings.view.printing': ['settings.view.system'],
  'settings.view.localization': ['theme.view', 'settings.view.system'],
};

const expandPermission = (permission: string, visited: Set<string>): string[] => {
  const normalizedPermission = permission.trim();
  if (!normalizedPermission || visited.has(normalizedPermission)) {
    return [];
  }

  visited.add(normalizedPermission);

  const aliases = PERMISSION_ALIASES[normalizedPermission] || [];
  return [
    normalizedPermission,
    ...aliases.flatMap((alias) => expandPermission(alias, visited)),
  ];
};

export const expandRequestedPermissions = (permission: string): string[] => {
  return [...new Set(expandPermission(permission, new Set()))];
};

export const matchesGrantedPermission = (granted: string, requested: string) => {
  if (granted === requested) {
    return true;
  }

  if (!granted.endsWith('.*')) {
    return false;
  }

  const prefix = granted.slice(0, -2);
  return requested === prefix || requested.startsWith(`${prefix}.`);
};

export const hasGrantedPermission = (grantedPermissions: string[], permission: string) => {
  const requestedPermissions = expandRequestedPermissions(permission);
  return requestedPermissions.some((requestedPermission) => (
    grantedPermissions.some((grantedPermission) => matchesGrantedPermission(grantedPermission, requestedPermission))
  ));
};

export { PERMISSION_ALIASES };