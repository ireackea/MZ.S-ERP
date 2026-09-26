/**
 * FC-SEC-002 — Canonical built-in roles.
 *
 * Role names here are the only canonical role ids. Legacy names are migrated
 * through ROLE_ALIASES in permission-catalog.ts.
 * Every grant is validated against the permission catalog at import time, so a
 * typo in a default role breaks the build instead of silently granting nothing.
 */
import { assertKnownPermissions } from './permission-catalog';

export type DefaultRoleTemplate = {
  name: string;
  description: string;
  permissions: string[];
  color: string;
};

const RAW_DEFAULT_ROLES: DefaultRoleTemplate[] = [
  { name: 'SuperAdmin', description: 'وصول كامل إلى جميع وحدات النظام والإعدادات الحساسة.', permissions: ['*'], color: '#ef4444' },
  {
    name: 'Admin',
    description: 'صلاحيات إدارية موسعة لإدارة المستخدمين والتقارير والنسخ الاحتياطي.',
    permissions: [
      'users.*',
      'settings.*',
      'reports.*',
      'backup.*',
      'items.*',
      'transactions.*',
      'formulation.*',
      'opening-balances.*',
      'partners.*',
      'sales.*',
      'inventory.*',
      'dashboard.view',
      'theme.*',
      'monitoring.logs.write',
    ],
    color: '#2563eb',
  },
  {
    name: 'Manager',
    description: 'إدارة العمليات اليومية ومراجعة التقارير والبيانات التشغيلية.',
    permissions: [
      'transactions.*',
      'reports.view',
      'items.view',
      'items.create',
      'items.update',
      'formulation.view',
      'opening-balances.view',
      'partners.view',
      'sales.view.orders',
      'inventory.*',
      'dashboard.view',
      'theme.view',
    ],
    color: '#10b981',
  },
  {
    name: 'Operator',
    description: 'تنفيذ الحركات اليومية على الأصناف مع صلاحيات تشغيلية محدودة.',
    permissions: [
      'transactions.create',
      'transactions.update',
      'transactions.view',
      'items.view',
      'partners.view',
      'inventory.view.stocktaking',
      'inventory.create.stocktaking',
      'inventory.update.stocktaking',
      'dashboard.view',
    ],
    color: '#f59e0b',
  },
  {
    name: 'Viewer',
    description: 'عرض البيانات والتقارير دون صلاحيات تعديل.',
    permissions: [
      'items.view',
      'transactions.view',
      'reports.view',
      'formulation.view',
      'opening-balances.view',
      'partners.view',
      'sales.view.orders',
      'inventory.view.stocktaking',
      'dashboard.view',
      'theme.view',
    ],
    color: '#6b7280',
  },
];

// Fail fast if a default role references a permission that no longer exists.
for (const role of RAW_DEFAULT_ROLES) {
  assertKnownPermissions(role.permissions);
}

export const DEFAULT_ROLES: readonly DefaultRoleTemplate[] = RAW_DEFAULT_ROLES;
