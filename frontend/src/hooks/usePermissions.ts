// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
import { useCallback, useMemo } from 'react';
import { hasGrantedPermission } from '@services/permissionMatcher';import { useSession } from './useSession';

const normalizePermissions = (permissions: unknown): string[] => {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(permissions.filter((entry): entry is string => typeof entry === 'string'))];
};

export const usePermissions = () => {
  const { data: session } = useSession();

  const normalizedPermissions = useMemo(() => {
    return normalizePermissions(session?.user?.permissions);
  }, [session?.user?.permissions]);

  const permissionsKey = useMemo(
    () => normalizedPermissions.slice().sort().join('|'),
    [normalizedPermissions],
  );

  const permissionState = useMemo(() => {
    const set = new Set(normalizedPermissions);
    const isSuper = set.has('*');
    return { permissions: normalizedPermissions, isSuper };
  }, [permissionsKey, normalizedPermissions]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!permission) return false;
      // FC-SEC-005 — the wildcard shortcut is already handled inside the shared
      // matcher, which mirrors RbacGuard. Returning early here used to skip the
      // matcher entirely, so a wildcard session never validated its key at all.
      return hasGrantedPermission(permissionState.permissions, permission);
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

      // FC-DEF-001 — reading the deficit queue needs the same permission as
      // viewing inventory; resolving one is separate so that closing an alert is
      // never a side effect of being able to look at the page.
      viewStockDeficits: hasAny(['inventory.view.stocktaking', 'inventory.*']),
      resolveStockDeficits: hasAny(['inventory.adjust.stock', 'inventory.*']),
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
      // Exposed for callers that must match a *role*, not a permission. The user
      // service gates role writes on SuperAdmin while the route decorators ask only
      // for `users.create` / `users.update`, so a screen gated on the permission
      // alone shows a Save button only the server can refuse. `*` is what SuperAdmin
      // holds, and it is already computed here for the matcher.
      isSuper: permissionState.isSuper,
      isAuthenticated: Boolean(session?.isAuthenticated),
    }),
    [normalizedPermissions, hasPermission, hasAny, hasAll, can, permissionState, session?.isAuthenticated],
  );
};

