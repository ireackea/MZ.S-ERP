import { isWildcardGrant } from './permission-matching';
/**
 * FC-SEC-002 — Single Permission Catalog (backend is the source of truth).
 *
 * Every `@Permissions(...)` value used by a controller MUST exist here.
 * `permission-catalog.test.ts` enforces that, and the frontend mirror
 * (`frontend/src/services/permissionsCatalog.ts`) is diffed against this file
 * by `scripts/audit/tests/sec-002-contract.test.mjs`.
 *
 * Adding a permission:
 *   1. Add it here with module/action/label/description.
 *   2. Use it in a controller via @Permissions(...).
 *   3. Regenerate the frontend mirror (npm run test:audit will fail until done).
 */

export type PermissionModuleKey =
  | 'users'
  | 'items'
  | 'transactions'
  | 'opening-balances'
  | 'formulation'
  | 'partners'
  | 'sales'
  | 'inventory'
  | 'reports'
  | 'dashboard'
  | 'backup'
  | 'settings'
  | 'theme'
  | 'monitoring'
  | 'admin';

export type PermissionCatalogEntry = {
  /** Canonical permission id, `module.action`. Enforced by RbacGuard. */
  id: string;
  /** Owning module — must equal the id prefix. */
  module: PermissionModuleKey;
  /** Action segment of the id. */
  action: string;
  /** Arabic label rendered by the IAM matrix UI. */
  label: string;
  /** Why this permission exists, for auditability. */
  description: string;
  /**
   * Backend route(s) guarded by this permission. `api-only` entries are enforced
   * by the API but intentionally have no dedicated UI control yet.
   */
  route: string;
  /** True when the permission is API-only and has no dedicated frontend surface. */
  apiOnly?: boolean;
};

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  // ── users ────────────────────────────────────────────────────────────────
  { id: 'users.view', module: 'users', action: 'view', label: 'عرض المستخدمين والأدوار', description: 'قراءة قائمة المستخدمين وقائمة الأدوار.', route: 'GET /users, GET /users/roles' },
  { id: 'users.create', module: 'users', action: 'create', label: 'إنشاء مستخدم', description: 'إنشاء مستخدمين جدد ودعوات.', route: 'POST /users, POST /users/invite, POST /users/roles' },
  { id: 'users.update', module: 'users', action: 'update', label: 'تعديل المستخدمين والأدوار', description: 'تعديل بيانات المستخدمين وصلاحيات الأدوار والإسناد الجماعي.', route: 'PUT /users/:id, PUT /users/roles/:id/permissions, POST /users/bulk/assign-role' },
  { id: 'users.delete', module: 'users', action: 'delete', label: 'حذف المستخدمين', description: 'حذف المستخدمين نهائيًا أو حذفًا جماعيًا.', route: 'DELETE /users/:id, POST /users/bulk/delete' },
  { id: 'users.lock', module: 'users', action: 'lock', label: 'قفل / فتح حساب', description: 'قفل حسابات المستخدمين أو إعادة فتحها.', route: 'POST /users/:id/lock' },
  { id: 'users.audit', module: 'users', action: 'audit', label: 'الاطلاع على سجل التدقيق', description: 'قراءة سجل تدقيق المستخدم والجلسات.', route: 'GET /users/:id/audit, GET /audit/logs, GET /audit/sessions' },

  // ── items ────────────────────────────────────────────────────────────────
  { id: 'items.view', module: 'items', action: 'view', label: 'عرض الأصناف', description: 'قراءة قائمة الأصناف وتفاصيل الصنف.', route: 'GET /items, GET /items/:publicId' },
  { id: 'items.create', module: 'items', action: 'create', label: 'إنشاء صنف', description: 'إنشاء صنف جديد.', route: 'POST /items' },
  { id: 'items.update', module: 'items', action: 'update', label: 'تعديل صنف', description: 'تعديل بيانات صنف قائم.', route: 'PUT /items/:publicId' },
  { id: 'items.reorder', module: 'items', action: 'reorder', label: 'حفظ ترتيب الأصناف', description: 'ترتيب قائمة الأصناف يدويًا وحفظه للجميع.', route: 'POST /items/reorder' },
  { id: 'items.sync', module: 'items', action: 'sync', label: 'مزامنة الأصناف', description: 'مزامنة صنف مع الأرشيف.', route: 'POST /items/sync', apiOnly: true },
  { id: 'items.delete', module: 'items', action: 'delete', label: 'حذف صنف', description: 'حذف صنف أو حذفًا نهائيًا (مقصور على Admin/SuperAdmin).', route: 'POST /items/delete, POST /items/delete-permanent' },
  { id: 'items.archive', module: 'items', action: 'archive', label: 'أرشفة الأصناف', description: 'أرشفة صنف مع الاحتفاظ بسجله.', route: 'POST /items/archive' },
  { id: 'items.restore', module: 'items', action: 'restore', label: 'استعادة الأصناف المؤرشفة', description: 'إرجاع صنف مؤرشف إلى الحالة النشطة.', route: 'POST /items/restore' },
  { id: 'items.generate_codes', module: 'items', action: 'generate_codes', label: 'توليد باركود/أكواد', description: 'توليد أكواد الصنف.', route: 'POST /items/generate-codes', apiOnly: true },
  { id: 'items.import', module: 'items', action: 'import', label: 'استيراد الأصناف (Excel/CSV)', description: 'استيراد أصناف من ملف Excel.', route: 'POST /items/import-excel, POST /items/import-excel/validate' },
  // A separate id, not part of items.import, because the two are not the same
  // decision. Importing adds rows; reverting removes rows another person is now
  // working from, and it is refused outright once anything has moved against them.
  // Folding it into items.* would hand every importer the ability to undo, and
  // `items.*` is exactly the grant Admin already holds.
  { id: 'items.import.revert', module: 'items', action: 'import.revert', label: 'التراجع عن دفعة استيراد', description: 'إرجاع دفعة استيراد كاملة إلى ما قبلها، ما لم تكن الأصناف قد تحرّكت.', route: 'POST /items/import-batches/:publicId/revert' },
  { id: 'items.upload', module: 'items', action: 'upload', label: 'رفع مرفقات الأصناف', description: 'رفع صور وملفات مرفقة بالصنف.', route: 'POST /items/:publicId/upload-image, POST /items/:publicId/upload-file', apiOnly: true },

  // ── transactions ─────────────────────────────────────────────────────────
  { id: 'transactions.view', module: 'transactions', action: 'view', label: 'عرض الحركات', description: 'قراءة الحركات والأرصدة المحسوبة.', route: 'GET /transactions, GET /transactions/:id, GET /balances/computed' },
  { id: 'transactions.create', module: 'transactions', action: 'create', label: 'إنشاء حركة', description: 'إنشاء حركة واردة/صادرة جماعية أو مفردة.', route: 'POST /transactions, POST /transactions/bulk, POST /transactions/bulk-import' },
  { id: 'transactions.update', module: 'transactions', action: 'update', label: 'تعديل حركة', description: 'تعديل حركة قائمة.', route: 'PATCH /transactions/:id, PUT /transactions/:id' },
  { id: 'transactions.delete', module: 'transactions', action: 'delete', label: 'حذف حركة', description: 'حذف حركة.', route: 'DELETE /transactions/:id, POST /transactions/delete' },
  { id: 'transactions.adjust', module: 'transactions', action: 'adjust', label: 'تسوية مخزنية', description: 'إنشاء تسوية مخزنية.', route: 'POST /transactions/stock-adjustments' },
  { id: 'transactions.migrate', module: 'transactions', action: 'migrate', label: 'ترحيل الحركات من التخزين المحلي', description: 'ترحيل حركات من localStorage إلى قاعدة البيانات.', route: 'POST /transactions/migrate-from-local', apiOnly: true },
  { id: 'transactions.reconcile', module: 'transactions', action: 'reconcile', label: 'مطابقة الأرصدة', description: 'كشف تقرير مطابقة الأرصدة.', route: 'GET /balances/reconciliation', apiOnly: true },

  // ── opening-balances ─────────────────────────────────────────────────────
  { id: 'opening-balances.view', module: 'opening-balances', action: 'view', label: 'عرض الأرصدة الافتتاحية', description: 'قراءة الأرصدة الافتتاحية لسنة محددة.', route: 'GET /opening-balances/:year' },
  { id: 'opening-balances.create', module: 'opening-balances', action: 'create', label: 'إدخال رصيد افتتاحي', description: 'تعيين رصيد افتتاحي.', route: 'POST /opening-balances' },
  { id: 'opening-balances.bulk', module: 'opening-balances', action: 'bulk', label: 'رفع جماعي للأرصدة', description: 'رفع جماعي للأرصدة الافتتاحية.', route: 'POST /opening-balances/bulk', apiOnly: true },

  // ── formulation ──────────────────────────────────────────────────────────
  { id: 'formulation.view', module: 'formulation', action: 'view', label: 'عرض التركيبات', description: 'قراءة التركيبات.', route: 'GET /formulations' },
  { id: 'formulation.create', module: 'formulation', action: 'create', label: 'إنشاء تركيبة', description: 'إنشاء تركيبة جديدة.', route: 'POST /formulations' },
  { id: 'formulation.update', module: 'formulation', action: 'update', label: 'تعديل تركيبة', description: 'تعديل تركيبة قائمة.', route: 'PUT /formulations/:id' },
  { id: 'formulation.delete', module: 'formulation', action: 'delete', label: 'حذف تركيبة', description: 'حذف تركيبة.', route: 'POST /formulations/delete' },

  // ── partners ─────────────────────────────────────────────────────────────
  { id: 'partners.view', module: 'partners', action: 'view', label: 'عرض العملاء والموردين', description: 'قراءة قائمة الشركاء.', route: 'GET /partners' },
  { id: 'partners.create', module: 'partners', action: 'create', label: 'إضافة شريك', description: 'إضافة عميل أو مورد.', route: 'POST /partners' },
  { id: 'partners.update', module: 'partners', action: 'update', label: 'تعديل شريك', description: 'تعديل بيانات شريك قائم.', route: 'PUT /partners/:id' },
  { id: 'partners.delete', module: 'partners', action: 'delete', label: 'حذف شريك', description: 'حذف شريك.', route: 'DELETE /partners/:id' },

  // ── sales (orders) ───────────────────────────────────────────────────────
  { id: 'sales.view.orders', module: 'sales', action: 'view', label: 'عرض الطلبات', description: 'قراءة طلبات الشراء.', route: 'GET /orders' },
  { id: 'sales.create.orders', module: 'sales', action: 'create', label: 'إنشاء طلب', description: 'إنشاء طلب شراء.', route: 'POST /orders' },
  { id: 'sales.update.orders', module: 'sales', action: 'update', label: 'تعديل الطلبات', description: 'تعديل طلب أو إكماله.', route: 'PUT /orders/:id, POST /orders/:id/complete' },
  { id: 'sales.delete.orders', module: 'sales', action: 'delete', label: 'حذف الطلبات', description: 'حذف طلب شراء.', route: 'DELETE /orders/:id' },

  // ── inventory (stocktaking) ──────────────────────────────────────────────
  { id: 'inventory.view.stocktaking', module: 'inventory', action: 'view', label: 'عرض الجرد', description: 'قراءة جرد شهر محدد.', route: 'GET /stocktaking/:monthKey' },
  { id: 'inventory.create.stocktaking', module: 'inventory', action: 'create', label: 'إنشاء جرد', description: 'فتح جرد جديد.', route: 'POST /stocktaking' },
  { id: 'inventory.update.stocktaking', module: 'inventory', action: 'update', label: 'تعديل الجرد', description: 'تحديث بنود الجرد وحل التعارضات وإعادة الفتح.', route: 'PUT /stocktaking/:id/entries, POST /stocktaking/:id/entries/:entryId/resolve, POST /stocktaking/:id/reopen' },
  { id: 'inventory.adjust.stock', module: 'inventory', action: 'adjust', label: 'عزل عجز المخزون', description: 'إغلاق عجز المخزون الذي لم يغطّه الرصيد الفعلي.', route: 'POST /stock-deficits/:publicId/write-off, POST /stock-deficits/:publicId/reopen' },
    { id: 'inventory.close.stocktaking', module: 'inventory', action: 'close', label: 'إقفال الجرد', description: 'إقفال الجرد وتثبيت تسويات الفروقات.', route: 'POST /stocktaking/:id/close' },

  // ── reports ──────────────────────────────────────────────────────────────
  { id: 'reports.view', module: 'reports', action: 'view', label: 'عرض التقارير', description: 'قراءة نتائج التقارير.', route: 'GET /reports' },
  { id: 'reports.generate', module: 'reports', action: 'generate', label: 'توليد/تصدير التقارير', description: 'توليد PDF وطباعة التقارير.', route: 'POST /reports/generate, POST /reports/print, POST /render-pdf' },

  // ── dashboard ────────────────────────────────────────────────────────────
  { id: 'dashboard.view', module: 'dashboard', action: 'view', label: 'عرض لوحة التحكم', description: 'قراءة إحصائيات لوحة التحكم.', route: 'GET /dashboard/stats' },

  // ── backup ───────────────────────────────────────────────────────────────
  { id: 'backup.view', module: 'backup', action: 'view', label: 'عرض النسخ الاحتياطية', description: 'قراءة قائمة النسخ ونقاط الاستعادة وإحصائيات التخزين.', route: 'GET /backup/list, GET /backup/storage-stats, GET /backups/restore-points' },
  { id: 'backup.create', module: 'backup', action: 'create', label: 'إنشاء نسخة احتياطية', description: 'إنشاء نسخ كاملة أو تزايدية أو مخزنية أو إعدادية.', route: 'POST /backup/full, POST /backup/inventory, POST /backup/config, POST /backup/create, POST /backups/full, POST /backups/incremental' },
  { id: 'backup.restore', module: 'backup', action: 'restore', label: 'استعادة نسخة احتياطية', description: 'استعادة نسخة احتياطية.', route: 'POST /backup/restore' },
  { id: 'backup.schedule', module: 'backup', action: 'schedule', label: 'إدارة جدولة النسخ', description: 'ضبط جدولة النسخ الاحتياطي.', route: 'POST /backup/schedule' },
  { id: 'backup.download', module: 'backup', action: 'download', label: 'تنزيل نسخة احتياطية', description: 'تنزيل ملف النسخة الاحتياطية.', route: 'GET /backup/download/:id' },
  { id: 'backup.delete', module: 'backup', action: 'delete', label: 'حذف نسخة احتياطية', description: 'حذف نسخة احتياطية.', route: 'DELETE /backup/:id' },
  { id: 'backup.import', module: 'backup', action: 'import', label: 'استيراد نسخة احتياطية', description: 'إعادة ملف نسخة احتياطية من الخارج إلى القائمة ليصبح قابلاً للاستعادة.', route: 'POST /backup/import' },

  // ── settings ─────────────────────────────────────────────────────────────
  // These two guard `GET|PUT /system-settings` as well. That was missing from both the
  // description and the route list, so the permissions matrix — the screen an
  // administrator uses to decide what to grant — said nothing about the endpoint whose
  // absence makes the general settings screen unsaveable. A catalogue entry that omits
  // what it authorises is how a grant looks sufficient and is not.
  { id: 'settings.view.general', module: 'settings', action: 'view', label: 'عرض الإعدادات العامة', description: 'قراءة هوية الشركة والبيانات المرجعية وقواعد التفريغ.', route: 'GET /system-settings, GET /reference-data, GET /unloading-rules' },
  { id: 'settings.update.system', module: 'settings', action: 'update', label: 'تعديل إعدادات النظام', description: 'تعديل هوية الشركة (الاسم والعملة والعنوان والهاتف والبريد والرقم الضريبي ورابط الشعار)، وإدارة البيانات المرجعية وقواعد التفريغ.', route: 'PUT /system-settings, POST /reference-data/*, POST /unloading-rules, PUT /unloading-rules/:id, POST /unloading-rules/delete' },

  // ── theme ────────────────────────────────────────────────────────────────
  { id: 'theme.view', module: 'theme', action: 'view', label: 'عرض الثيم', description: 'قراءة ثيم مستخدم.', route: 'GET /theme/user/:id' },
  { id: 'theme.update', module: 'theme', action: 'update', label: 'تعديل الثيم', description: 'تعديل ثيم مستخدم.', route: 'POST /theme/user/:id' },

  // ── monitoring ───────────────────────────────────────────────────────────
  { id: 'monitoring.logs.write', module: 'monitoring', action: 'logs.write', label: 'كتابة سجلات المراقبة', description: 'كتابة سجل مراقبة من العميل.', route: 'POST /logs', apiOnly: true },

  // ── admin ────────────────────────────────────────────────────────────────
  { id: 'admin.reset_system', module: 'admin', action: 'reset_system', label: 'إعادة ضبط النظام (Reset)', description: 'طلب challenged إعادة ضبط النظام.', route: 'POST /admin/reset-system/challenge, POST /admin/reset-system' },
] as const;

/** Every canonical permission id. */
export const ALL_PERMISSION_IDS: readonly string[] = PERMISSION_CATALOG.map((entry) => entry.id);

export type PermissionModule = {
  key: PermissionModuleKey;
  label: string;
  /** Wildcard that grants every permission inside this module. */
  wildcard: string;
  permissions: readonly string[];
};

const MODULE_LABELS: Readonly<Record<PermissionModuleKey, string>> = {
  users: 'المستخدمون والأدوار',
  items: 'الأصناف',
  transactions: 'الحركات (الوارد / الصادر)',
  'opening-balances': 'الأرصدة الافتتاحية',
  formulation: 'التركيبات (الإنتاج)',
  partners: 'العملاء والموردون',
  sales: 'الطلبات',
  inventory: 'الجرد',
  reports: 'التقارير',
  dashboard: 'لوحة التحكم',
  backup: 'النسخ الاحتياطي',
  settings: 'الإعدادات العامة',
  theme: 'الثيم والمظهر',
  monitoring: 'المراقبة والسجلات',
  admin: 'إجراءات النظام الحرجة',
};

/** Grouped view of the catalog, consumed by the IAM matrix UI. */
export const PERMISSION_MODULES: readonly PermissionModule[] = (
  Object.keys(MODULE_LABELS) as PermissionModuleKey[]
).map((key) => ({
  key,
  label: MODULE_LABELS[key],
  wildcard: `${key}.*`,
  permissions: PERMISSION_CATALOG.filter((entry) => entry.module === key).map((entry) => entry.id),
}));

const PERMISSION_ID_SET = new Set<string>(ALL_PERMISSION_IDS);

/** Wildcard literal granting every permission. */
export const FULL_ACCESS_TOKEN = '*';

export const isKnownPermission = (permission: string): boolean =>
  PERMISSION_ID_SET.has(String(permission || '').trim());

/** Wildcard `module.*` is valid only when the module exists in the catalog. */
export const isKnownPermissionGrant = (grant: string): boolean => {
  const normalized = String(grant || '').trim();
  if (!normalized) return false;
  if (normalized === FULL_ACCESS_TOKEN) return true;
  if (isKnownPermission(normalized)) return true;
  // Gate 5.1 - the wildcard parse is shared. This answers a different question
  // from the matcher (is this grant string well formed, rather than does it cover a
  // key), but `module.*` is one syntax, not five.
  const moduleKey = normalized.slice(0, -2);
  if (!isWildcardGrant(normalized)) return false;
  return PERMISSION_CATALOG.some((entry) => entry.module === moduleKey);
};

/** Throws listing every unrecognised id so the caller sees all drift at once. */
export const assertKnownPermissions = (permissions: readonly string[]): void => {
  const unknown = [...new Set(permissions.map((p) => String(p || '').trim()))].filter(
    (permission) => permission && !isKnownPermissionGrant(permission),
  );
  if (unknown.length) {
    throw new Error(`Unknown permission(s): ${unknown.join(', ')}`);
  }
};

/** Mirrors RbacGuard wildcard semantics so UI and API agree. */
export const isPermissionGranted = (granted: readonly string[], required: string): boolean => {
  if (granted.includes(FULL_ACCESS_TOKEN)) return true;
  if (granted.includes(required)) return true;
  const dotIndex = required.indexOf('.');
  if (dotIndex === -1) return false;
  return granted.includes(`${required.slice(0, dotIndex)}.*`);
};

/**
 * FC-SEC-002 — legacy permission ids that older role rows may still contain.
 * Each maps to the canonical catalog id(s) that replaced it, so a stored grant
 * is translated forward instead of being silently dropped.
 */
export const LEGACY_PERMISSION_ALIASES: Readonly<Record<string, readonly string[]>> = {
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
  'settings.view': ['settings.view.general'],
  'settings.view.system': ['settings.view.general'],
  'settings.view.users': ['users.view'],
  'settings.view.permissions': ['users.update'],
  'settings.view.backup': ['backup.view'],
  'settings.view.reset': ['admin.reset_system'],
  'settings.view.audit': ['users.audit'],
  'settings.view.offline': ['settings.view.general'],
  'settings.view.printing': ['settings.view.general'],
  'settings.view.localization': ['theme.view'],
};

const migrateOne = (permission: string, visited: Set<string>): string[] => {
  const normalized = String(permission || '').trim();
  if (!normalized || visited.has(normalized)) return [];
  visited.add(normalized);

  const canonical = LEGACY_PERMISSION_ALIASES[normalized];
  if (!canonical) return [normalized];
  return canonical.flatMap((id) => migrateOne(id, visited));
};

/**
 * Translates legacy ids to their canonical form and returns BOTH the migrated
 * grants and any id that could not be resolved. Callers must reject when
 * `unknown` is non-empty — migrating a legacy id must never become a silent way
 * to smuggle an unrecognised permission past validation.
 */
export const resolvePermissionGrants = (
  permissions: readonly string[],
): { grants: string[]; unknown: string[] } => {
  const grants: string[] = [];
  const unknown: string[] = [];

  for (const permission of permissions) {
    const normalized = String(permission || '').trim();
    if (!normalized) continue;

    if (normalized === FULL_ACCESS_TOKEN || isKnownPermissionGrant(normalized)) {
      grants.push(normalized);
      continue;
    }

    const migrated = migrateOne(normalized, new Set());
    if (migrated.length && migrated.every((id) => isKnownPermissionGrant(id))) {
      grants.push(...migrated);
    } else {
      unknown.push(normalized);
    }
  }

  return { grants: [...new Set(grants)], unknown: [...new Set(unknown)] };
};

/**
 * Convenience wrapper for read paths (login) where an unrecognised stored id is
 * simply not a capability and is dropped.
 */
export const migratePermissionGrants = (permissions: readonly string[]): string[] =>
  resolvePermissionGrants(permissions).grants;

/**
 * Legacy role ids kept only for migration. Canonical roles are the
 * DEFAULT_ROLES names in auth.service.ts.
 */
export const ROLE_ALIASES: Readonly<Record<string, string>> = {
  super_admin: 'SuperAdmin',
  superadmin: 'SuperAdmin',
  root: 'SuperAdmin',
  administrator: 'Admin',
  admin: 'Admin',
  manager: 'Manager',
  warehouse_manager: 'Manager',
  supervisor: 'Manager',
  operator: 'Operator',
  storekeeper: 'Operator',
  viewer: 'Viewer',
  read_only: 'Viewer',
  customer: 'Viewer',
};

/** Resolves a legacy/aliased role name to its canonical name, or null. */
export const resolveCanonicalRole = (role: string): string | null => {
  const normalized = String(role || '').trim();
  if (!normalized) return null;
  const alias = ROLE_ALIASES[normalized.toLowerCase()];
  return alias || null;
};
