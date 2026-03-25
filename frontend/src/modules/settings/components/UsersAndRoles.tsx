// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import UnifiedIAM from '../../../components/UnifiedIAM';

interface UsersAndRolesProps {
  forceAccess?: boolean;
}

const UsersAndRoles: React.FC<UsersAndRolesProps> = ({ forceAccess = false }) => {
  const { hasPermission } = usePermissions();

  if (!forceAccess && !hasPermission('settings.view.users')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض المستخدمين والأدوار</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.users</code>.</div>
      </div>
    );
  }

  return <UnifiedIAM />;
};

export default UsersAndRoles;