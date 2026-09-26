/**
 * Frontend mirror of the backend permission catalog.
 *
 * FC-SEC-002 — this file is NOT hand-maintained. The backend catalog
 * (`backend/src/auth/permission-catalog.ts`) is the source of truth and is
 * served at `GET /auth/permissions`. This mirror exists only so the UI can
 * render synchronously; `scripts/audit/tests/sec-002-contract.test.mjs`
 * diffs it against the backend and fails the build on any drift.
 *
 * To add a permission: edit the backend catalog, then copy the new entry here.
 */

export type PermissionCatalogEntry = {
  id: string;
  module: string;
  action: string;
  label: string;
  description: string;
  route: string;
  apiOnly?: boolean;
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
      { id: 'users.view', module: 'users', action: 'view', label: 'عرض المستخدمين والأدوار', description: 'قراءة قائمة المستخدمين وقائمة الأدوار.', route: 'GET /users, GET /users/roles' },
      { id: 'users.create', module: 'users', action: 'create', label: 'إنشاء مستخدم', description: 'إنشاء مستخدمين جدد ودعوات.', route: 'POST /users, POST /users/invite, POST /users/roles' },
      { id: 'users.update', module: 'users', action: 'update', label: 'تعديل المستخدمين والأدوار', description: 'تعديل بيانات المستخدمين وصلاحيات الأدوار والإسناد الجماعي.', route: 'PUT /users/:id, PUT /users/roles/:id/permissions, POST /users/bulk/assign-role' },
      { id: 'users.delete', module: 'users', action: 'delete', label: 'حذف المستخدمين', description: 'حذف المستخدمين نهائيًا أو حذفًا جماعيًا.', route: 'DELETE /users/:id, POST /users/bulk/delete' },
      { id: 'users.lock', module: 'users', action: 'lock', label: 'قفل / فتح حساب', description: 'قفل حسابات المستخدمين أو إعادة فتحها.', route: 'POST /users/:id/lock' },
      { id: 'users.audit', module: 'users', action: 'audit', label: 'الاطلاع على سجل التدقيق', description: 'قراءة سجل تدقيق المستخدم والجلسات.', route: 'GET /users/:id/audit, GET /audit/logs, GET /audit/sessions' },
    ],
  },
  {
    key: 'items',
    label: 'الأصناف',
    wildcard: 'items.*',
    permissions: [
      { id: 'items.view', module: 'items', action: 'view', label: 'عرض الأصناف', description: 'قراءة قائمة الأصناف وتفاصيل الصنف.', route: 'GET /items, GET /items/:publicId' },
      { id: 'items.create', module: 'items', action: 'create', label: 'إنشاء صنف', description: 'إنشاء صنف جديد.', route: 'POST /items' },
      { id: 'items.update', module: 'items', action: 'update', label: 'تعديل صنف', description: 'تعديل بيانات صنف قائم.', route: 'PUT /items/:publicId' },
      { id: 'items.sync', module: 'items', action: 'sync', label: 'مزامنة الأصناف', description: 'مزامنة صنف مع الأرشيف.', route: 'POST /items/sync', apiOnly: true },
      { id: 'items.delete', module: 'items', action: 'delete', label: 'حذف صنف', description: 'حذف صنف أو حذفًا نهائيًا (مقصور على Admin/SuperAdmin).', route: 'POST /items/delete, POST /items/delete-permanent' },
      { id: 'items.archive', module: 'items', action: 'archive', label: 'أرشفة الأصناف', description: 'أرشفة صنف مع الاحتفاظ بسجله.', route: 'POST /items/archive' },
      { id: 'items.restore', module: 'items', action: 'restore', label: 'استعادة الأصناف المؤرشفة', description: 'إرجاع صنف مؤرشف إلى الحالة النشطة.', route: 'POST /items/restore' },
      { id: 'items.generate_codes', module: 'items', action: 'generate_codes', label: 'توليد باركود/أكواد', description: 'توليد أكواد الصنف.', route: 'POST /items/generate-codes', apiOnly: true },
      { id: 'items.import', module: 'items', action: 'import', label: 'استيراد الأصناف (Excel/CSV)', description: 'استيراد أصناف من ملف Excel.', route: 'POST /items/import-excel', apiOnly: true },
      { id: 'items.upload', module: 'items', action: 'upload', label: 'رفع مرفقات الأصناف', description: 'رفع صور وملفات مرفقة بالصنف.', route: 'POST /items/:publicId/upload-image, POST /items/:publicId/upload-file', apiOnly: true },
    ],
  },
  {
    key: 'transactions',
    label: 'الحركات (الوارد / الصادر)',
    wildcard: 'transactions.*',
    permissions: [
      { id: 'transactions.view', module: 'transactions', action: 'view', label: 'عرض الحركات', description: 'قراءة الحركات والأرصدة المحسوبة.', route: 'GET /transactions, GET /transactions/:id, GET /balances/computed' },
      { id: 'transactions.create', module: 'transactions', action: 'create', label: 'إنشاء حركة', description: 'إنشاء حركة واردة/صادرة جماعية أو مفردة.', route: 'POST /transactions, POST /transactions/bulk, POST /transactions/bulk-import' },
      { id: 'transactions.update', module: 'transactions', action: 'update', label: 'تعديل حركة', description: 'تعديل حركة قائمة.', route: 'PATCH /transactions/:id, PUT /transactions/:id' },
      { id: 'transactions.delete', module: 'transactions', action: 'delete', label: 'حذف حركة', description: 'حذف حركة.', route: 'DELETE /transactions/:id, POST /transactions/delete' },
      { id: 'transactions.adjust', module: 'transactions', action: 'adjust', label: 'تسوية مخزنية', description: 'إنشاء تسوية مخزنية (مقصر على Admin/SuperAdmin).', route: 'POST /transactions/stock-adjustments' },
      { id: 'transactions.migrate', module: 'transactions', action: 'migrate', label: 'ترحيل الحركات من التخزين المحلي', description: 'ترحيل حركات من localStorage إلى قاعدة البيانات (مقصر على Admin/SuperAdmin).', route: 'POST /transactions/migrate-from-local', apiOnly: true },
      { id: 'transactions.reconcile', module: 'transactions', action: 'reconcile', label: 'مطابقة الأرصدة', description: 'كشف تقرير مطابقة الأرصدة.', route: 'GET /balances/reconciliation', apiOnly: true },
    ],
  },
  {
    key: 'opening-balances',
    label: 'الأرصدة الافتتاحية',
    wildcard: 'opening-balances.*',
    permissions: [
      { id: 'opening-balances.view', module: 'opening-balances', action: 'view', label: 'عرض الأرصدة الافتتاحية', description: 'قراءة الأرصدة الافتتاحية لسنة محددة.', route: 'GET /opening-balances/:year' },
      { id: 'opening-balances.create', module: 'opening-balances', action: 'create', label: 'إدخال رصيد افتتاحي', description: 'تعيين رصيد افتتاحي (مقصر على Admin/SuperAdmin).', route: 'POST /opening-balances' },
      { id: 'opening-balances.bulk', module: 'opening-balances', action: 'bulk', label: 'رفع جماعي للأرصدة', description: 'رفع جماعي للأرصدة الافتتاحية (مقصر على Admin/SuperAdmin).', route: 'POST /opening-balances/bulk', apiOnly: true },
    ],
  },
  {
    key: 'formulation',
    label: 'التركيبات (الإنتاج)',
    wildcard: 'formulation.*',
    permissions: [
      { id: 'formulation.view', module: 'formulation', action: 'view', label: 'عرض التركيبات', description: 'قراءة التركيبات.', route: 'GET /formulations' },
      { id: 'formulation.create', module: 'formulation', action: 'create', label: 'إنشاء تركيبة', description: 'إنشاء تركيبة جديدة.', route: 'POST /formulations' },
      { id: 'formulation.update', module: 'formulation', action: 'update', label: 'تعديل تركيبة', description: 'تعديل تركيبة قائمة.', route: 'PUT /formulations/:id' },
      { id: 'formulation.delete', module: 'formulation', action: 'delete', label: 'حذف تركيبة', description: 'حذف تركيبة.', route: 'POST /formulations/delete' },
    ],
  },
  {
    key: 'partners',
    label: 'العملاء والموردون',
    wildcard: 'partners.*',
    permissions: [
      { id: 'partners.view', module: 'partners', action: 'view', label: 'عرض العملاء والموردين', description: 'قراءة قائمة الشركاء.', route: 'GET /partners' },
      { id: 'partners.create', module: 'partners', action: 'create', label: 'إضافة شريك', description: 'إضافة عميل أو مورد.', route: 'POST /partners' },
      { id: 'partners.update', module: 'partners', action: 'update', label: 'تعديل شريك', description: 'تعديل بيانات شريك قائم.', route: 'PUT /partners/:id' },
      { id: 'partners.delete', module: 'partners', action: 'delete', label: 'حذف شريك', description: 'حذف شريك (مقصر على Admin/SuperAdmin).', route: 'DELETE /partners/:id' },
    ],
  },
  {
    key: 'sales',
    label: 'الطلبات',
    wildcard: 'sales.*',
    permissions: [
      { id: 'sales.view.orders', module: 'sales', action: 'view', label: 'عرض الطلبات', description: 'قراءة طلبات الشراء.', route: 'GET /orders' },
      { id: 'sales.create.orders', module: 'sales', action: 'create', label: 'إنشاء طلب', description: 'إنشاء طلب شراء.', route: 'POST /orders' },
      { id: 'sales.update.orders', module: 'sales', action: 'update', label: 'تعديل الطلبات', description: 'تعديل طلب أو إكماله.', route: 'PUT /orders/:id, POST /orders/:id/complete' },
      { id: 'sales.delete.orders', module: 'sales', action: 'delete', label: 'حذف الطلبات', description: 'حذف طلب شراء (مقصر على Admin/SuperAdmin).', route: 'DELETE /orders/:id' },
    ],
  },
  {
    key: 'inventory',
    label: 'الجرد',
    wildcard: 'inventory.*',
    permissions: [
      { id: 'inventory.view.stocktaking', module: 'inventory', action: 'view', label: 'عرض الجرد', description: 'قراءة جرد شهر محدد.', route: 'GET /stocktaking/:monthKey' },
      { id: 'inventory.create.stocktaking', module: 'inventory', action: 'create', label: 'إنشاء جرد', description: 'فتح جرد جديد.', route: 'POST /stocktaking' },
      { id: 'inventory.update.stocktaking', module: 'inventory', action: 'update', label: 'تعديل الجرد', description: 'تحديث بنود الجرد وحل التعارضات وإعادة الفتح.', route: 'PUT /stocktaking/:id/entries, POST /stocktaking/:id/entries/:entryId/resolve, POST /stocktaking/:id/reopen' },
      { id: 'inventory.adjust.stock', module: 'inventory', action: 'adjust', label: 'عزل عجز المخزون', description: 'إغلاق عجز المخزون الذي لم يغطّه الرصيد الفعلي.', route: 'POST /stock-deficits/:publicId/write-off, POST /stock-deficits/:publicId/reopen' },
      { id: 'inventory.close.stocktaking', module: 'inventory', action: 'close', label: 'إقفال الجرد', description: 'إقفال الجرد وتثبيت تسويات الفروقات (مقصر على Admin/SuperAdmin).', route: 'POST /stocktaking/:id/close' },
    ],
  },
  {
    key: 'reports',
    label: 'التقارير',
    wildcard: 'reports.*',
    permissions: [
      { id: 'reports.view', module: 'reports', action: 'view', label: 'عرض التقارير', description: 'قراءة نتائج التقارير.', route: 'GET /reports' },
      { id: 'reports.generate', module: 'reports', action: 'generate', label: 'توليد/تصدير التقارير', description: 'توليد PDF وطباعة التقارير.', route: 'POST /reports/generate, POST /reports/print, POST /render-pdf' },
    ],
  },
  {
    key: 'dashboard',
    label: 'لوحة التحكم',
    wildcard: 'dashboard.*',
    permissions: [
      { id: 'dashboard.view', module: 'dashboard', action: 'view', label: 'عرض لوحة التحكم', description: 'قراءة إحصائيات لوحة التحكم.', route: 'GET /dashboard/stats' },
    ],
  },
  {
    key: 'backup',
    label: 'النسخ الاحتياطي',
    wildcard: 'backup.*',
    permissions: [
      { id: 'backup.view', module: 'backup', action: 'view', label: 'عرض النسخ الاحتياطية', description: 'قراءة قائمة النسخ ونقاط الاستعادة وإحصائيات التخزين.', route: 'GET /backup/list, GET /backup/storage-stats, GET /backups/restore-points' },
      { id: 'backup.create', module: 'backup', action: 'create', label: 'إنشاء نسخة احتياطية', description: 'إنشاء نسخ كاملة أو تزايدية أو مخزنية أو إعدادية.', route: 'POST /backup/full, POST /backup/inventory, POST /backup/config, POST /backup/create, POST /backups/full, POST /backups/incremental' },
      { id: 'backup.restore', module: 'backup', action: 'restore', label: 'استعادة نسخة احتياطية', description: 'استعادة نسخة احتياطية.', route: 'POST /backup/restore' },
      { id: 'backup.schedule', module: 'backup', action: 'schedule', label: 'إدارة جدولة النسخ', description: 'ضبط جدولة النسخ الاحتياطي.', route: 'POST /backup/schedule' },
      { id: 'backup.download', module: 'backup', action: 'download', label: 'تنزيل نسخة احتياطية', description: 'تنزيل ملف النسخة الاحتياطية.', route: 'GET /backup/download/:id' },
      { id: 'backup.delete', module: 'backup', action: 'delete', label: 'حذف نسخة احتياطية', description: 'حذف نسخة احتياطية.', route: 'DELETE /backup/:id' },
    ],
  },
  {
    key: 'settings',
    label: 'الإعدادات العامة',
    wildcard: 'settings.*',
    permissions: [
      { id: 'settings.view.general', module: 'settings', action: 'view', label: 'عرض الإعدادات العامة', description: 'قراءة البيانات المرجعية وقواعد التفريغ.', route: 'GET /reference-data, GET /unloading-rules' },
      { id: 'settings.update.system', module: 'settings', action: 'update', label: 'تعديل إعدادات النظام', description: 'إدارة البيانات المرجعية وقواعد التفريغ.', route: 'POST /reference-data/*, POST /unloading-rules, PUT /unloading-rules/:id, POST /unloading-rules/delete' },
    ],
  },
  {
    key: 'theme',
    label: 'الثيم والمظهر',
    wildcard: 'theme.*',
    permissions: [
      { id: 'theme.view', module: 'theme', action: 'view', label: 'عرض الثيم', description: 'قراءة ثيم مستخدم.', route: 'GET /theme/user/:id' },
      { id: 'theme.update', module: 'theme', action: 'update', label: 'تعديل الثيم', description: 'تعديل ثيم مستخدم.', route: 'POST /theme/user/:id' },
    ],
  },
  {
    key: 'monitoring',
    label: 'المراقبة والسجلات',
    wildcard: 'monitoring.*',
    permissions: [
      { id: 'monitoring.logs.write', module: 'monitoring', action: 'logs.write', label: 'كتابة سجلات المراقبة', description: 'كتابة سجل مراقبة من العميل.', route: 'POST /logs', apiOnly: true },
    ],
  },
  {
    key: 'admin',
    label: 'إجراءات النظام الحرجة',
    wildcard: 'admin.*',
    permissions: [
      { id: 'admin.reset_system', module: 'admin', action: 'reset_system', label: 'إعادة ضبط النظام (Reset)', description: 'طلب challenged إعادة ضبط النظام.', route: 'POST /admin/reset-system/challenge, POST /admin/reset-system' },
    ],
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
