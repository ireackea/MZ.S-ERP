/**
 * Authoritative Permissions Catalog — 2026-04-29
 * Mirrors backend @Permissions(...) decorators across all controllers.
 * Single source of truth for the role-permissions matrix UI.
 *
 * To add a new permission:
 *   1. Decorate the backend route with @Permissions('module.action').
 *   2. Add the entry below under the matching module group with an Arabic label.
 *   3. Optionally update DEFAULT_ROLE_TEMPLATES in
 *      backend/src/auth/auth.service.ts and app-bootstrap.service.ts.
 */

export type PermissionCatalogEntry = {
  id: string;
  label: string;
  description?: string;
};

export type PermissionGroup = {
  key: string;
  label: string;
  /** Wildcard prefix that grants every permission within this module (e.g. `users.*`). */
  wildcard: string;
  permissions: PermissionCatalogEntry[];
};

export const PERMISSIONS_CATALOG: PermissionGroup[] = [
  {
    key: 'users',
    label: 'المستخدمون والأدوار',
    wildcard: 'users.*',
    permissions: [
      { id: 'users.view', label: 'عرض المستخدمين' },
      { id: 'users.create', label: 'إنشاء مستخدم' },
      { id: 'users.update', label: 'تعديل المستخدمين والأدوار' },
      { id: 'users.delete', label: 'حذف المستخدمين' },
      { id: 'users.lock', label: 'قفل / فتح حساب' },
      { id: 'users.audit', label: 'الاطلاع على سجل التدقيق' },
    ],
  },
  {
    key: 'items',
    label: 'الأصناف',
    wildcard: 'items.*',
    permissions: [
      { id: 'items.view', label: 'عرض الأصناف' },
      { id: 'items.sync', label: 'إنشاء وتعديل الأصناف' },
      { id: 'items.delete', label: 'حذف صنف' },
      { id: 'items.archive', label: 'أرشفة الأصناف' },
      { id: 'items.restore', label: 'استعادة الأصناف المؤرشفة' },
      { id: 'items.import', label: 'استيراد الأصناف (Excel/CSV)' },
      { id: 'items.upload', label: 'رفع مرفقات الأصناف' },
      { id: 'items.generate_codes', label: 'توليد باركود/أكواد' },
    ],
  },
  {
    key: 'transactions',
    label: 'الحركات (الوارد / الصادر)',
    wildcard: 'transactions.*',
    permissions: [
      { id: 'transactions.view', label: 'عرض الحركات' },
      { id: 'transactions.create', label: 'إنشاء حركة' },
      { id: 'transactions.update', label: 'تعديل حركة' },
      { id: 'transactions.delete', label: 'حذف حركة' },
      { id: 'transactions.migrate', label: 'ترحيل/مزامنة الحركات' },
    ],
  },
  {
    key: 'opening-balances',
    label: 'الأرصدة الافتتاحية',
    wildcard: 'opening-balances.*',
    permissions: [
      { id: 'opening-balances.view', label: 'عرض الأرصدة الافتتاحية' },
      { id: 'opening-balances.create', label: 'إدخال رصيد افتتاحي' },
      { id: 'opening-balances.bulk', label: 'رفع جماعي للأرصدة' },
    ],
  },
  {
    key: 'formulation',
    label: 'التركيبات (الإنتاج)',
    wildcard: 'formulation.*',
    permissions: [
      { id: 'formulation.view', label: 'عرض التركيبات' },
      { id: 'formulation.create', label: 'إنشاء تركيبة' },
      { id: 'formulation.update', label: 'تعديل تركيبة' },
      { id: 'formulation.delete', label: 'حذف تركيبة' },
    ],
  },
  {
    key: 'reports',
    label: 'التقارير',
    wildcard: 'reports.*',
    permissions: [
      { id: 'reports.view', label: 'عرض التقارير' },
      { id: 'reports.generate', label: 'توليد/تصدير التقارير' },
    ],
  },
  {
    key: 'dashboard',
    label: 'لوحة التحكم',
    wildcard: 'dashboard.*',
    permissions: [{ id: 'dashboard.view', label: 'عرض لوحة التحكم' }],
  },
  {
    key: 'backup',
    label: 'النسخ الاحتياطي',
    wildcard: 'backup.*',
    permissions: [
      { id: 'backup.view', label: 'عرض النسخ الاحتياطية' },
      { id: 'backup.create', label: 'إنشاء نسخة احتياطية' },
      { id: 'backup.restore', label: 'استعادة نسخة احتياطية' },
      { id: 'backup.schedule', label: 'إدارة جدولة النسخ' },
      { id: 'backup.download', label: 'تنزيل نسخة احتياطية' },
      { id: 'backup.delete', label: 'حذف نسخة احتياطية' },
    ],
  },
  {
    key: 'settings',
    label: 'الإعدادات العامة',
    wildcard: 'settings.*',
    permissions: [{ id: 'settings.update.system', label: 'تعديل إعدادات النظام' }],
  },
  {
    key: 'theme',
    label: 'الثيم والمظهر',
    wildcard: 'theme.*',
    permissions: [
      { id: 'theme.view', label: 'عرض الثيم' },
      { id: 'theme.update', label: 'تعديل الثيم' },
    ],
  },
  {
    key: 'monitoring',
    label: 'المراقبة والسجلات',
    wildcard: 'monitoring.*',
    permissions: [{ id: 'monitoring.logs.write', label: 'كتابة سجلات المراقبة' }],
  },
  {
    key: 'admin',
    label: 'إجراءات النظام الحرجة',
    wildcard: 'admin.*',
    permissions: [{ id: 'admin.reset_system', label: 'إعادة ضبط النظام (Reset)' }],
  },
];

/** Flat list of every permission id known to the catalog. */
export const ALL_PERMISSION_IDS: string[] = PERMISSIONS_CATALOG.flatMap((group) =>
  group.permissions.map((permission) => permission.id),
);

/** Wildcard literal that grants every permission across every module. */
export const FULL_ACCESS_TOKEN = '*';

/**
 * Determines whether a permission is granted by the current matrix selection,
 * honouring `*` and `module.*` wildcards exactly like the backend RbacGuard.
 */
export const isPermissionGranted = (matrix: string[], permissionId: string): boolean => {
  if (matrix.includes(FULL_ACCESS_TOKEN)) return true;
  if (matrix.includes(permissionId)) return true;
  const dotIndex = permissionId.indexOf('.');
  if (dotIndex === -1) return false;
  const moduleWildcard = `${permissionId.slice(0, dotIndex)}.*`;
  return matrix.includes(moduleWildcard);
};

/** Counts how many permissions in a group are effectively granted. */
export const countGrantedInGroup = (matrix: string[], group: PermissionGroup): number =>
  group.permissions.filter((permission) => isPermissionGranted(matrix, permission.id)).length;
