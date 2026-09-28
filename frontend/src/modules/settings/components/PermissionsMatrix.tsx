// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العامة - 2026-03-13
import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { PERMISSIONS_CATALOG } from '@services/permissionsCatalog';
import { hasGrantedPermission } from '@services/permissionMatcher';
import { fetchRoles } from '@services/usersService';
import { toast } from '@services/toastService';
import type { RoleDto } from '@services/usersService';

interface PermissionsMatrixProps {
}

/**
 * Gate 3.3 — this screen was reading fiction.
 *
 * It called `getIamConfig()`, which reads `localStorage['feed_factory_iam_config']`
 * and falls back to a hardcoded template. That template names nine roles that do
 * not exist server-side — `admin`, `warehouse_manager`, `storekeeper`,
 * `general_supervisor`, `special_supervisor`, `dispatch_officer`,
 * `dispatch_manager`, `production_manager`, `customer` — and asserts
 * `admin: ['*']`, i.e. that the admin role is a superuser. The real `Admin` role
 * holds fourteen module wildcards and explicitly not `admin.reset_system`, and the
 * real role names are SuperAdmin/Admin/Manager/Operator/Viewer.
 *
 * So the one screen an administrator opens to reason about who can do what was
 * showing a set of roles that do not exist and grants that are not in effect. The
 * sibling screen, `UnifiedIAM`, reads the same data from `GET /users/roles` and
 * can edit it — so two views of the same thing disagreed, and the read-only one
 * was wrong.
 *
 * It also gated a read-only table on `users.update`, a write key, and told the
 * denied user they lacked a *view* permission.
 */
const PermissionsMatrix: React.FC<PermissionsMatrixProps> = ({ }) => {
  const { hasPermission } = usePermissions();
  // `users.view`, not `users.update`: nothing here writes.
  const canView = hasPermission('users.view');

  const [roles, setRoles] = useState<RoleDto[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setLoading(true);
    void fetchRoles()
      .then((serverRoles) => {
        if (!cancelled) setRoles(serverRoles);
      })
      .catch((error: any) => {
        // An empty matrix would read as "these roles hold nothing", which is the
        // same confident wrong answer this screen used to give for a different
        // reason. Say so instead.
        if (!cancelled) {
          setRoles(null);
          toast.error(error?.message || 'تعذّر تحميل الأدوار من الخادم.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  if (!canView) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض مصفوفة الصلاحيات</div>
        <div>تحتاج إلى الصلاحية <code>users.view</code>.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">جارٍ تحميل الأدوار…</p>
      </div>
    );
  }

  if (!roles) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <div className="mb-2 font-bold">تعذّر عرض المصفوفة</div>
        <div>الأدوار لم تُحمَّل من الخادم، ولم تُعرض أي مصفوفة حتى لا تُقرأ بيانات ناقصة على أنها صلاحيات.</div>
      </div>
    );
  }

  const permissions = PERMISSIONS_CATALOG.flatMap((group) =>
    group.permissions.map((permission) => ({
      id: permission.id,
      label: permission.label,
      module: group.key,
    })),
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-2xl font-black text-slate-900">مصفوفة الصلاحيات</h2>
        <p className="mt-2 text-sm text-slate-500">
          الصلاحيات الفعلية لكل دور كما يقرؤها الخادم. علامة <code>*</code> تعني صلاحية وحدة كاملة.
        </p>
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[960px] text-right text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 font-bold">الصلاحية</th>
              {roles.map((role) => (
                <th key={role.id} scope="col" className="px-4 py-3 font-bold">{role.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission.id} className="border-t border-slate-100">
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold text-slate-900">{permission.label}</div>
                  <div className="text-xs text-slate-500">{permission.id}</div>
                </td>
                {roles.map((role) => {
                  // Gate 3.3/5.1 - through the wildcard-aware matcher. It used to be
                  // `role.permissionIds.includes(permission.id)`, which is false for
                  // every permission under an `admin.*` grant — so the matrix
                  // reported the admin role as holding nothing at all, and an
                  // administrator would "fix" grants that were already effective.
                  const granted = hasGrantedPermission(role.permissions ?? [], permission.id);
                  return (
                    <td
                      key={`${role.id}-${permission.id}`}
                      className="px-4 py-3 text-center"
                      aria-label={granted ? 'ممنوحة' : 'غير ممنوحة'}
                    >
                      {granted ? '✓' : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PermissionsMatrix;
