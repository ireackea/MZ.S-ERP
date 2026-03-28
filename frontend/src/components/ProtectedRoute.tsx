// ENTERPRISE FIX: Arabic Encoding Restoration - Full Components Folder - 2026-03-04
// Arabic text encoding verified and corrected

// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import React, { ReactNode, useMemo } from 'react';
import { usePermissions } from '@hooks/usePermissions';

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
  mode?: 'all' | 'any';
  fallback?: ReactNode;
}

const defaultFallback = (
  <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800 font-bold">
    You do not have permission to access this page.
  </div>
);

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  permission,
  permissions,
  mode = 'all',
  fallback = defaultFallback,
}) => {
  const { hasPermission, hasAll, hasAny } = usePermissions();

  const allowed = useMemo(() => {
    if (permission) return hasPermission(permission);
    if (permissions && permissions.length > 0) {
      return mode === 'any' ? hasAny(permissions) : hasAll(permissions);
    }
    return true;
  }, [permission, permissions, mode, hasPermission, hasAll, hasAny]);

  return <>{allowed ? children : fallback}</>;
};

export default ProtectedRoute;


