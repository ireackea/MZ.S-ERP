// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import { useCallback, useMemo } from 'react';
import { useSession } from './useSession';

const PERMISSION_ALIASES: Record<string, string[]> = {
  'users.view.management': ['users.view'],
  'users.create.management': ['users.create'],
  'users.update.management': ['users.update'],
  'users.delete.management': ['users.delete'],
  'users.export.management': ['users.audit'],
  'reports.view.general': ['reports.view'],
  'reports.export.general': ['reports.generate'],
  'inventory.view.stock': ['items.view', 'transactions.view'],
  'inventory.create.inbound': ['transactions.create'],
  'inventory.create.outbound': ['transactions.create'],
  'inventory.update.pricing': ['transactions.update'],
  'inventory.delete.transactions': ['transactions.delete'],
  'settings.view.system': ['theme.view', 'backup.view'],
  'settings.view': ['settings.view.general'],
  'settings.view.general': ['settings.view.system'],
  'settings.view.users': ['users.view.management'],
  'settings.view.permissions': ['users.view.management'],
  'settings.view.backup': ['backup.create', 'backup.restore', 'backup.schedule', 'backup.download', 'backup.delete', 'backup.view'],
  'settings.view.reset': ['admin.reset_system', 'system.reset'],
  'settings.view.audit': ['users.audit'],
  'settings.view.offline': ['settings.view.system'],
  'settings.view.printing': ['settings.view.system'],
  'settings.view.localization': ['theme.view', 'settings.view.system'],
};

const normalizePermissions = (permissions: unknown): string[] => {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.filter((entry): entry is string => typeof entry === 'string'))];
};

const expandRequestedPermissions = (permission: string): string[] => {
  const direct = permission.trim();
  if (!direct) return [];
  const aliases = PERMISSION_ALIASES[direct] || [];
  return [...new Set([direct, ...aliases])];
};

const matchWildcard = (granted: string, requested: string) => {
  if (!granted.endsWith('.*')) return false;
  const prefix = granted.slice(0, -2);
  return requested === prefix || requested.startsWith(`${prefix}.`);
};

export const usePermissions = () => {
  const { data: session } = useSession();
  const normalizedRole = String(session?.user?.role || '').trim().toLowerCase();

  const normalizedPermissions = useMemo(
    () => normalizePermissions(session?.user?.permissions),
    [session?.user?.permissions],
  );

  const permissionsKey = useMemo(
    () => normalizedPermissions.slice().sort().join('|'),
    [normalizedPermissions],
  );

  const permissionState = useMemo(() => {
    const set = new Set(normalizedPermissions);
    const wildcards = normalizedPermissions.filter((entry) => entry.endsWith('.*'));
    const isSuper = set.has('*') || normalizedRole === 'admin' || normalizedRole === 'superadmin';
    return { set, wildcards, isSuper };
  }, [permissionsKey, normalizedPermissions, normalizedRole]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!permission) return false;
      if (permissionState.isSuper) return true;

      const requestedList = expandRequestedPermissions(permission);
      return requestedList.some((requested) => {
        if (permissionState.set.has(requested)) return true;
        return permissionState.wildcards.some((granted) => matchWildcard(granted, requested));
      });
    },
    [permissionState],
  );

  const hasAny = useCallback(
    (permissions: string[]) => permissions.some((permission) => hasPermission(permission)),
    [hasPermission],
  );

  const hasAll = useCallback(
    (permissions: string[]) => permissions.every((permission) => hasPermission(permission)),
    [hasPermission],
  );

  const can = useMemo(
    () => ({
      createItem: hasAny(['items.create', 'items.sync', 'items.*']),
      updateItem: hasAny(['items.update', 'items.sync', 'items.*']),
      deleteItem: hasAny(['items.delete', 'items.*']),
      viewItems: hasAny(['items.view', 'items.*']),

      viewTransactions: hasAny(['transactions.view', 'transactions.*']),
      createTransaction: hasAny(['transactions.create', 'transactions.*']),
      updateTransaction: hasAny(['transactions.update', 'transactions.*']),
      deleteTransaction: hasAny(['transactions.delete', 'transactions.*']),

      viewReports: hasAny(['reports.view', 'reports.*']),
      generateReports: hasAny(['reports.generate', 'reports.*']),

      viewUsers: hasAny(['users.view', 'users.*']),
      createUsers: hasAny(['users.create', 'users.*']),
      updateUsers: hasAny(['users.update', 'users.*']),
      deleteUsers: hasAny(['users.delete', 'users.*']),
      lockUsers: hasAny(['users.lock', 'users.*']),
      auditUsers: hasAny(['users.audit', 'users.*']),
      manageUsers: hasAny(['users.*']),

      viewBackup: hasAny(['backup.view', 'backup.*']),
      createBackup: hasAny(['backup.create', 'backup.*']),
      restoreBackup: hasAny(['backup.restore', 'backup.*']),
      scheduleBackup: hasAny(['backup.schedule', 'backup.*']),
      downloadBackup: hasAny(['backup.download', 'backup.*']),
      deleteBackup: hasAny(['backup.delete', 'backup.*']),

      viewTheme: hasAny(['theme.view', 'theme.*']),
      updateTheme: hasAny(['theme.update', 'theme.*']),
    }),
    [hasAny],
  );

  return useMemo(
    () => ({
      permissions: normalizedPermissions,
      hasPermission,
      hasAny,
      hasAll,
      can,
      isAuthenticated: Boolean(session?.token),
    }),
    [normalizedPermissions, hasPermission, hasAny, hasAll, can, session?.token],
  );
};

