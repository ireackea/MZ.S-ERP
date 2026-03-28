// SECURITY FIX: 2026-03-28 - Removed forceAccess prop bypass
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import UnifiedIAM from '../../../components/UnifiedIAM';

const UsersAndRoles: React.FC = () => {
  const { hasPermission } = usePermissions();

  // SECURITY FIX: 2026-03-28 - Only permission check, no bypass
  if (!hasPermission('settings.view.users')) {
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
