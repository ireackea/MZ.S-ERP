// ENTERPRISE FIX: Phase 3 Duplication Cleanup - Archive Only - 2026-03-26
// All legacy files archived in _ARCHIVE_DUPLICATION_CLEANUP_2026-03-26/
// ENTERPRISE FIX: Phase 2 – التناسق والإعدادات العالمية - 2026-03-13
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '@hooks/usePermissions';
import BackupCenterView from '../../../pages/BackupCenterView';
import type { User } from '../../../types';

interface BackupAndRestoreProps {
  currentUser?: User;
  forceAccess?: boolean;
}

const BackupAndRestore: React.FC<BackupAndRestoreProps> = ({ currentUser, forceAccess = false }) => {
  const { hasPermission } = usePermissions();

  if (!forceAccess && !hasPermission('settings.view.backup')) {
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