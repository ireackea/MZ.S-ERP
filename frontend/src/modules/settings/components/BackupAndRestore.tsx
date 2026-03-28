// SECURITY FIX: 2026-03-28 - Removed forceAccess prop bypass
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import BackupCenterView from '../../../pages/BackupCenterView';
import type { User } from '../../../types';

interface BackupAndRestoreProps {
  currentUser?: User;
}

const BackupAndRestore: React.FC<BackupAndRestoreProps> = ({ currentUser }) => {
  const { hasPermission } = usePermissions();

  // SECURITY FIX: 2026-03-28 - Only permission check, no bypass
  if (!hasPermission('settings.view.backup')) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="mb-2 flex items-center gap-2 font-bold"><ShieldAlert size={18} />لا تملك صلاحية عرض النسخ الاحتياطية</div>
        <div>تحتاج إلى الصلاحية <code>settings.view.backup</code>.</div>
      </div>
    );
  }

  return <BackupCenterView currentUser={currentUser} />;
};

export default BackupAndRestore;
