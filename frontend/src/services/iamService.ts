// ENTERPRISE FIX: Phase 6.1 - Critical Red Flags Removal - 2026-03-12
import { v4 as uuidv4 } from 'uuid';
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

const IAM_CONFIG_KEY = 'feed_factory_iam_config';
const USER_ACTIVITY_LOG_KEY = 'feed_factory_user_activity_logs';
const USER_SESSIONS_KEY = 'feed_factory_user_sessions';
const CURRENT_SESSION_KEY = 'feed_factory_current_session_id';

const permissionCatalog: PermissionDefinition[] = [
  // ENTERPRISE FIX: Warehouse Manager Role Matrix - 2026-03-03
  { id: 'items.view', module: 'inventory', resource: 'items', action: 'view', label: 'عرض الأصناف (عام)' },
  { id: 'items.create', module: 'inventory', resource: 'items', action: 'create', label: 'إنشاء الأصناف (عام)' },
  { id: 'items.update', module: 'inventory', resource: 'items', action: 'update', label: 'تعديل الأصناف (عام)' },
  { id: 'items.delete', module: 'inventory', resource: 'items', action: 'delete', label: 'حذف الأصناف (عام)' },
  { id: 'transactions.view', module: 'inventory', resource: 'transactions', action: 'view', label: 'عرض الحركات (عام)' },
  { id: 'transactions.create', module: 'inventory', resource: 'transactions', action: 'create', label: 'إنشاء الحركات (عام)' },
  { id: 'transactions.update', module: 'inventory', resource: 'transactions', action: 'update', label: 'تعديل الحركات (عام)' },
  { id: 'transactions.delete', module: 'inventory', resource: 'transactions', action: 'delete', label: 'حذف الحركات (عام)' },
  { id: 'settings.view', module: 'settings', resource: 'system', action: 'view', label: 'عرض الإعدادات (عام)' },

  { id: 'inventory.view.items', module: 'inventory', resource: 'items', action: 'view', label: 'عرض الأصناف' },
  { id: 'inventory.create.items', module: 'inventory', resource: 'items', action: 'create', label: 'إضافة صنف' },
  { id: 'inventory.update.items', module: 'inventory', resource: 'items', action: 'update', label: 'تعديل صنف' },
  { id: 'inventory.delete.items', module: 'inventory', resource: 'items', action: 'delete', label: 'حذف صنف' },
  { id: 'inventory.view.operations', module: 'inventory', resource: 'operations', action: 'view', label: 'عرض الحركات' },
  { id: 'inventory.create.operations', module: 'inventory', resource: 'operations', action: 'create', label: 'إنشاء حركة' },
  { id: 'inventory.update.operations', module: 'inventory', resource: 'operations', action: 'update', label: 'تعديل حركة' },
  { id: 'inventory.delete.operations', module: 'inventory', resource: 'operations', action: 'delete', label: 'حذف حركة' },

  { id: 'inventory.view.stock', module: 'inventory', resource: 'stock', action: 'view', label: 'عرض الجرد' },
  { id: 'inventory.create.inbound', module: 'inventory', resource: 'inbound', action: 'create', label: 'إضافة حركة وارد' },
  { id: 'inventory.create.outbound', module: 'inventory', resource: 'outbound', action: 'create', label: 'إضافة حركة صادر' },
  { id: 'inventory.update.pricing', module: 'inventory', resource: 'pricing', action: 'update', label: 'تعديل الأسعار' },
  { id: 'inventory.delete.transactions', module: 'inventory', resource: 'transactions', action: 'delete', label: 'حذف الحركات' },
  { id: 'inventory.export.stock', module: 'inventory', resource: 'stock', action: 'export', label: 'تصدير بيانات المخزون' },

  { id: 'sales.view.orders', module: 'sales', resource: 'orders', action: 'view', label: 'عرض الطلبات' },
  { id: 'sales.create.orders', module: 'sales', resource: 'orders', action: 'create', label: 'إنشاء طلب' },
  { id: 'sales.update.orders', module: 'sales', resource: 'orders', action: 'update', label: 'تعديل الطلبات' },
  { id: 'sales.delete.orders', module: 'sales', resource: 'orders', action: 'delete', label: 'حذف الطلبات' },
  { id: 'sales.export.orders', module: 'sales', resource: 'orders', action: 'export', label: 'تصدير الطلبات' },

  { id: 'reports.view.general', module: 'reports', resource: 'general', action: 'view', label: 'عرض التقارير' },
  { id: 'reports.export.general', module: 'reports', resource: 'general', action: 'export', label: 'تصدير التقارير' },

  { id: 'settings.view.system', module: 'settings', resource: 'system', action: 'view', label: 'عرض الإعدادات' },
  { id: 'settings.update.system', module: 'settings', resource: 'system', action: 'update', label: 'تعديل الإعدادات' },
  { id: 'backup.create', module: 'settings', resource: 'backup', action: 'create', label: 'إنشاء نسخة احتياطية' },
  { id: 'backup.restore', module: 'settings', resource: 'backup', action: 'update', label: 'استعادة النسخة الاحتياطية' },

  { id: 'users.view.management', module: 'users', resource: 'management', action: 'view', label: 'عرض المستخدمين' },
  { id: 'users.create.management', module: 'users', resource: 'management', action: 'create', label: 'إضافة مستخدم' },
  { id: 'users.update.management', module: 'users', resource: 'management', action: 'update', label: 'تعديل المستخدمين' },
  { id: 'users.delete.management', module: 'users', resource: 'management', action: 'delete', label: 'حذف المستخدمين' },
  { id: 'users.export.management', module: 'users', resource: 'management', action: 'export', label: 'تصدير المستخدمين' },
];

const rolePermissionTemplates: Record<string, string[]> = {
  admin: permissionCatalog.map((permission) => permission.id),
  warehouse_manager: [
    'items.view',
    'items.create',
    'items.update',
    'transactions.view',
    'transactions.create',
    'settings.view',

    'inventory.view.items',
    'inventory.create.items',
    'inventory.update.items',
    'inventory.view.operations',
    'inventory.create.operations',
    'settings.view.system',
  ],
  storekeeper: [
    'inventory.view.stock',
    'inventory.create.inbound',
    'inventory.create.outbound',
    'reports.view.general',
  ],
  general_supervisor: [
    'inventory.view.stock',
    'reports.view.general',
    'reports.export.general',
    'sales.view.orders',
  ],
  special_supervisor: [
    'inventory.view.stock',
    'sales.view.orders',
    'sales.create.orders',
    'sales.update.orders',
    'reports.view.general',
    'reports.export.general',
  ],
  dispatch_officer: ['sales.view.orders', 'sales.create.orders', 'sales.update.orders'],
  dispatch_manager: ['sales.view.orders', 'sales.create.orders', 'sales.update.orders', 'sales.export.orders'],
  production_manager: [
    'inventory.view.stock',
    'inventory.create.inbound',
    'inventory.create.outbound',
    'reports.view.general',
    'reports.export.general',
    'sales.view.orders',
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
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getDefaultRoles(): RoleDefinition[] {
  return (Object.keys(rolePermissionTemplates) as UserRole[]).map((roleId) => ({
    id: roleId,
    name: roleLabels[roleId],
    description: `دور ${roleLabels[roleId]}`,
    permissionIds: rolePermissionTemplates[roleId],
  }));
}

export function getIamConfig(): IamConfig {
  const fallback: IamConfig = {
    permissions: permissionCatalog,
    roles: getDefaultRoles(),
    updatedAt: Date.now(),
  };

  const config = readJson<IamConfig>(IAM_CONFIG_KEY, fallback);

  const knownPermissionIds = new Set(config.permissions.map((permission) => permission.id));
  const normalizedRoles = config.roles.map((role) => ({
    ...role,
    permissionIds: role.permissionIds.filter((permissionId) => knownPermissionIds.has(permissionId)),
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
    role.id === roleId ? { ...role, permissionIds: [...new Set(permissionIds)] } : role
  );
  saveIamConfig({ ...config, roles: updatedRoles, updatedAt: Date.now() });
}

export function ensureUserDefaults(user: User): User {
  return {
    ...user,
    roleId: user.roleId ?? user.role,
    scope: user.scope ?? 'all',
    status: user.status ?? (user.active ? 'active' : 'suspended'),
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

export function hasPermission(user: User | undefined, permissionId: string): boolean {
  if (!user) return false;
  const normalizedUser = ensureUserDefaults(user);
  if (normalizedUser.status === 'suspended' || !normalizedUser.active) return false;
  const role = getUserRole(normalizedUser);
  return Boolean(role?.permissionIds.includes(permissionId));
}

export function getScopeWhereClause(user: User | undefined, columnName = 'warehouse_id'): string {
  if (!user) return '1=0';
  const normalizedUser = ensureUserDefaults(user);
  if (normalizedUser.scope === 'all') return '1=1';
  return `${columnName} = '${normalizedUser.scope}'`;
}

export function filterByDataScope<T extends { warehouseId?: DataScope }>(rows: T[], user: User | undefined): T[] {
  if (!user) return [];
  const normalizedUser = ensureUserDefaults(user);
  if (normalizedUser.scope === 'all') return rows;
  return rows.filter((row) => row.warehouseId === normalizedUser.scope);
}

function getCurrentSessionId(): string {
  const existing = sessionStorage.getItem(CURRENT_SESSION_KEY);
  if (existing) return existing;
  const created = uuidv4();
  sessionStorage.setItem(CURRENT_SESSION_KEY, created);
  return created;
}

function getAllSessions(): UserSession[] {
  return readJson<UserSession[]>(USER_SESSIONS_KEY, []);
}

function saveAllSessions(sessions: UserSession[]) {
  writeJson(USER_SESSIONS_KEY, sessions);
}

function getUserAgentMeta() {
  const agent = navigator.userAgent.toLowerCase();
  const browser =
    agent.includes('edg') ? 'Edge' :
    agent.includes('chrome') ? 'Chrome' :
    agent.includes('firefox') ? 'Firefox' :
    agent.includes('safari') ? 'Safari' : 'Unknown';

  const deviceType = /mobile|android|iphone|ipad/.test(agent) ? 'Mobile' : 'Desktop';

  return { browser, deviceType };
}

export function upsertCurrentSession(user: User) {
  const sessionId = getCurrentSessionId();
  const { browser, deviceType } = getUserAgentMeta();
  const sessions = getAllSessions();

  const now = Date.now();
  const existing = sessions.find((session) => session.id === sessionId);

  if (existing) {
    existing.userId = user.id;
    existing.browser = browser;
    existing.deviceType = deviceType;
    existing.lastActivityAt = now;
    existing.revoked = false;
    existing.isCurrent = true;
  } else {
    sessions.push({
      id: sessionId,
      userId: user.id,
      browser,
      deviceType,
      ipAddress: '127.0.0.1 (simulated)',
      lastActivityAt: now,
      revoked: false,
      isCurrent: true,
    });
  }

  const normalized = sessions.map((session) => ({
    ...session,
    isCurrent: session.id === sessionId,
  }));

  saveAllSessions(normalized);
}

export function getActiveSessionsByUser(userId: string): UserSession[] {
  return getAllSessions()
    .filter((session) => session.userId === userId && !session.revoked)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function revokeAllOtherSessions(userId: string) {
  const currentSessionId = getCurrentSessionId();
  const sessions = getAllSessions().map((session) => {
    if (session.userId !== userId) return session;
    if (session.id === currentSessionId) return { ...session, revoked: false, isCurrent: true };
    return { ...session, revoked: true, isCurrent: false };
  });

  saveAllSessions(sessions);
}

export function getUserActivityLogs(userId: string): UserActivityLog[] {
  return readJson<UserActivityLog[]>(USER_ACTIVITY_LOG_KEY, [])
    .filter((log) => log.userId === userId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function getAllUserActivityLogs(): UserActivityLog[] {
  return readJson<UserActivityLog[]>(USER_ACTIVITY_LOG_KEY, []).sort((a, b) => b.timestamp - a.timestamp);
}

export function logUserActivity(params: {
  userId: string;
  userName: string;
  event: UserActivityLog['event'];
  details: string;
  ipAddress?: string;
}) {
  const currentLogs = readJson<UserActivityLog[]>(USER_ACTIVITY_LOG_KEY, []);
  const nextLog: UserActivityLog = {
    id: uuidv4(),
    timestamp: Date.now(),
    userId: params.userId,
    userName: params.userName,
    event: params.event,
    details: params.details,
    ipAddress: params.ipAddress ?? '127.0.0.1 (simulated)',
  };
  writeJson(USER_ACTIVITY_LOG_KEY, [nextLog, ...currentLogs].slice(0, 1000));
}
