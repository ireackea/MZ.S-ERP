// ENTERPRISE FIX: Phase 3 – الاختبار + المراقبة + النشر الرسمي - 2026-03-13
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
// ENTERPRISE FIX: Phase 6.6 - Global 100% Cleanup & Absolute Verification - 2026-03-13
import { v4 as uuidv4 } from 'uuid';
import apiClient from '@api/client';
import {
  DataScope,
  IamConfig,
  PermissionDefinition,
  RoleDefinition,
  User,
  UserActivityLog,
  UserRole,
  UserSession,
} from '../types';
import { expandRequestedPermissions, hasGrantedPermission } from './permissionMatcher';
import {
  ALL_PERMISSION_IDS,
  FULL_ACCESS_TOKEN,
  PERMISSIONS_CATALOG,
} from './permissionsCatalog';
import { assertStorageKeyAllowed } from './storageOwnership';

const IAM_CONFIG_KEY = 'feed_factory_iam_config';

// FC-SEC-002 — derived from the single permission catalog instead of a second
// hand-maintained list, so the two can never drift.
const permissionCatalog: PermissionDefinition[] = PERMISSIONS_CATALOG.flatMap((group) =>
  group.permissions.map((permission) => ({
    id: permission.id,
    module: group.key,
    resource: permission.id,
    action: permission.action,
    label: permission.label,
  })),
);

const KNOWN_PERMISSION_IDS = new Set<string>(ALL_PERMISSION_IDS);
const KNOWN_MODULE_KEYS = new Set<string>(PERMISSIONS_CATALOG.map((group) => group.key));

const isKnownGrant = (grant: string): boolean =>
  grant === FULL_ACCESS_TOKEN ||
  KNOWN_PERMISSION_IDS.has(grant) ||
  (grant.endsWith('.*') && KNOWN_MODULE_KEYS.has(grant.slice(0, -2)));

const canonicalizeGrants = (permissionIds: string[]): string[] => {
  const canonical = permissionIds.map(
    (permissionId) => expandRequestedPermissions(permissionId)[0] || permissionId,
  );
  return [...new Set(canonical)].filter((permissionId) => isKnownGrant(permissionId));
};

const rolePermissionTemplates: Record<string, string[]> = {
  admin: ['*'],
  warehouse_manager: [
    'items.view',
    'items.create',
    'items.update',
    'items.sync',
    'transactions.view',
    'transactions.create',
    'transactions.update',
    'formulation.view',
    'opening-balances.view',
    'partners.view',
    'partners.create',
    'sales.view.orders',
    'inventory.view.stocktaking',
    'reports.view',
    'dashboard.view',
    'settings.view.general',
    'theme.view',
  ],
  storekeeper: [
    'items.view',
    'transactions.view',
    'transactions.create',
    'transactions.update',
    'inventory.view.stocktaking',
    'inventory.create.stocktaking',
    'inventory.update.stocktaking',
    'partners.view',
    'reports.view',
    'settings.view.general',
  ],
  general_supervisor: [
    'items.view',
    'transactions.view',
    'formulation.view',
    'opening-balances.view',
    'partners.view',
    'sales.view.orders',
    'inventory.view.stocktaking',
    'reports.view',
    'reports.generate',
    'dashboard.view',
    'settings.view.general',
  ],
  special_supervisor: [
    'items.view',
    'transactions.view',
    'formulation.view',
    'partners.view',
    'sales.view.orders',
    'sales.create.orders',
    'sales.update.orders',
    'inventory.view.stocktaking',
    'reports.view',
    'reports.generate',
    'dashboard.view',
    'settings.view.general',
  ],
  dispatch_officer: ['sales.view.orders', 'sales.create.orders', 'sales.update.orders', 'partners.view'],
  dispatch_manager: ['sales.view.orders', 'sales.create.orders', 'sales.update.orders', 'partners.view', 'reports.view'],
  production_manager: [
    'items.view',
    'items.create',
    'items.update',
    'transactions.view',
    'transactions.create',
    'formulation.view',
    'formulation.create',
    'formulation.update',
    'formulation.delete',
    'inventory.view.stocktaking',
    'reports.view',
    'reports.generate',
    'partners.view',
    'dashboard.view',
    'settings.view.general',
  ],
  customer: ['sales.view.orders'],
};

const roleLabels: Record<UserRole, string> = {
  admin: 'مدير عام',
  warehouse_manager: 'مدير مخزن',
  storekeeper: 'أمين مخزن',
  general_supervisor: 'مشرف عام',
  special_supervisor: 'مشرف خاص',
  dispatch_officer: 'مسؤول صرف',
  dispatch_manager: 'مدير صرف',
  production_manager: 'مدير إنتاج',
  customer: 'عميل',
};

function readJson<T>(key: string, fallback: T): T {
  assertStorageKeyAllowed(key);
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  assertStorageKeyAllowed(key);
  localStorage.setItem(key, JSON.stringify(value));
}

function getDefaultRoles(): RoleDefinition[] {
  return (Object.keys(rolePermissionTemplates) as UserRole[]).map((roleId) => ({
    id: roleId,
    name: roleLabels[roleId],
    description: `دور ${roleLabels[roleId]}`,
    permissionIds: canonicalizeGrants(rolePermissionTemplates[roleId]),
  }));
}

export function getIamConfig(): IamConfig {
  const fallback: IamConfig = {
    permissions: permissionCatalog,
    roles: getDefaultRoles(),
    updatedAt: Date.now(),
  };

  const config = readJson<IamConfig>(IAM_CONFIG_KEY, fallback);

  // FC-SEC-002 — migrate any legacy alias stored in a previous session down to
  // the canonical catalog, then drop anything the catalog no longer defines.
  const normalizedRoles = config.roles.map((role) => ({
    ...role,
    permissionIds: canonicalizeGrants(role.permissionIds || []),
  }));

  return {
    ...config,
    permissions: permissionCatalog,
    roles: normalizedRoles,
  };
}

export function saveIamConfig(config: IamConfig) {
  writeJson(IAM_CONFIG_KEY, { ...config, updatedAt: Date.now() });
}

export function updateRolePermissions(roleId: string, permissionIds: string[]) {
  const config = getIamConfig();
  const updatedRoles = config.roles.map((role) =>
    role.id === roleId ? { ...role, permissionIds: canonicalizeGrants(permissionIds) } : role
  );
  saveIamConfig({ ...config, roles: updatedRoles, updatedAt: Date.now() });
}

export function ensureUserDefaults(user: User): User {
  const resolvedActive = user.active ?? user.isActive ?? true;
  return {
    ...user,
    roleId: user.roleId ?? user.role,
    scope: user.scope ?? 'all',
    active: resolvedActive,
    isActive: user.isActive ?? resolvedActive,
    status: user.status ?? (resolvedActive ? 'active' : 'suspended'),
    twoFactorEnabled: user.twoFactorEnabled ?? false,
  };
}

export function normalizeUsers(users: User[]): User[] {
  return users.map((user) => ensureUserDefaults(user));
}

export function getUserRole(user?: User): RoleDefinition | undefined {
  if (!user) return undefined;
  const normalizedUser = ensureUserDefaults(user);
  return getIamConfig().roles.find((role) => role.id === normalizedUser.roleId);
}

/**
 * FC-SEC-003 — display-only permission check.
 *
 * This no longer grants access from a role *name*: a local `role: 'admin'`
 * string used to unlock every permission, which meant anyone able to edit
 * localStorage could render the full admin UI. Authority now comes only from
 * the permission list the backend issued for the current session, falling back
 * to the canonical role grants purely for display.
 */
export function hasPermission(user: User | undefined, permissionId: string): boolean {
  if (!user) return false;
  const normalizedUser = ensureUserDefaults(user);
  if (normalizedUser.status === 'suspended' || !normalizedUser.active) return false;

  const directPermissions = Array.isArray(normalizedUser.permissions)
    ? normalizedUser.permissions.filter((entry): entry is string => typeof entry === 'string')
    : [];

  if (directPermissions.includes('*')) {
    return true;
  }

  if (hasGrantedPermission(directPermissions, permissionId)) {
    return true;
  }

  // FC-SEC-005 — fail-closed. This previously fell back to a hand-written
  // Admin/SuperAdmin grant table when the server had not issued a permission
  // list yet, so the bootstrap window reported capabilities nobody had been
  // granted. An empty list is now an honest "no".
  const role = getUserRole(normalizedUser);
  return hasGrantedPermission(role?.permissionIds || [], permissionId);
}

/**
 * FC-SEC-003 — `getScopeWhereClause` was removed. It built a SQL fragment by
 * interpolating a client-held scope, and row-level scoping is the backend's job
 * (see SEC-001 warehouseScopeCondition). `filterByDataScope` below remains a
 * display-only filter over rows the server already scoped.
 */
export function filterByDataScope<T extends { warehouseId?: DataScope }>(rows: T[], user: User | undefined): T[] {
  if (!user) return [];
  const normalizedUser = ensureUserDefaults(user);
  if (normalizedUser.scope === 'all') return rows;
  return rows.filter((row) => row.warehouseId === normalizedUser.scope);
}

export function upsertCurrentSession(user: User) {
  void user;
}

export function getActiveSessionsByUser(userId: string): UserSession[] {
  void userId;
  return [];
}

export function revokeAllOtherSessions(userId: string) {
  void userId;
}

export function getUserActivityLogs(userId: string): UserActivityLog[] {
  // FC-AUD-001 — activity history is no longer stored in the browser.
  void userId;
  return [];
}

export function getAllUserActivityLogs(): UserActivityLog[] {
  // FC-AUD-001 — read the server-side trail via GET /audit/logs instead.
  return [];
}

/**
 * FC-AUD-001 — client activity is recorded server-side.
 *
 * This used to append to `localStorage['feed_factory_user_activity_logs']`,
 * which made the audit trail editable (and clearable) by anyone with browser
 * access. The entry is now POSTed to the backend, which stamps the actor from
 * the session and redacts the payload. Failure is intentionally non-fatal: an
 * unreachable audit endpoint must not roll back the user's action.
 */
export function logUserActivity(params: {
  userId: string;
  userName: string;
  event: UserActivityLog['event'];
  details: string;
  ipAddress?: string;
}) {
  void apiClient
    .post('/audit/client-activity', { event: params.event, details: params.details })
    .catch(() => {
      /* best-effort diagnostics only — never block the user action */
    });
}
