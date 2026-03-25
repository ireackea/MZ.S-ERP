// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React, { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import { getIamConfig } from '@services/iamService';

interface PermissionsMatrixProps {
  forceAccess?: boolean;
}

const PermissionsMatrix: React.FC<PermissionsMatrixProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();
  const config = useMemo(() => getIamConfig(), []);

  if (!forceAccess && !hasPermission('settings.view.permissions')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض مصفوفة الصلاحيات</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.permissions</code>.</div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-2xl font-black text-slate-900">مصفوفة الصلاحيات</h2>
        <p className="mt-2 text-sm text-slate-500">عرض مباشر للصلاحيات المربوطة بكل دور داخل التهيئة الحالية.</p>
      </div>
      <div className="overflow-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[960px] text-right text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-4 py-3 font-bold">الصلاحية</th>
              {config.roles.map((role) => (
                <th key={role.id} className="px-4 py-3 font-bold">{role.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.permissions.map((permission) => (
              <tr key={permission.id} className="border-t border-slate-100">
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold text-slate-900">{permission.label}</div>
                  <div className="text-xs text-slate-500">{permission.id}</div>
                </td>
                {config.roles.map((role) => (
                  <td key={`${role.id}-${permission.id}`} className="px-4 py-3 text-center">
                    {role.permissionIds.includes(permission.id) ? '✓' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PermissionsMatrix;