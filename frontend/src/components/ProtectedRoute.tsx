// SECURITY FIX: 2026-03-28 - Added authentication check before permission validation
// FC-SEC-003 — authentication is not optional. The `requireAuth` escape hatch
// was removed so no caller can render a protected tree without a session.
import React, { ReactNode, useMemo } from 'react';
import { usePermissions } from '@hooks/usePermissions';

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
  mode?: 'all' | 'any';
  fallback?: ReactNode;
}

const notAuthenticatedFallback = (
  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 font-bold">
    يرجى تسجيل الدخول للوصول إلى هذه الصفحة.
  </div>
);

const defaultFallback = (
  <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800 font-bold">
    ليس لديك صلاحية للوصول إلى هذه الصفحة.
  </div>
);

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  permission,
  permissions,
  mode = 'all',
  fallback = defaultFallback,
}) => {
  const { hasPermission, hasAll, hasAny, isAuthenticated } = usePermissions();

  const allowed = useMemo(() => {
    // SECURITY FIX: 2026-03-28 - Check authentication first
    if (!isAuthenticated) {
      return false;
    }

    // If no permission required, still require authentication
    if (!permission && (!permissions || permissions.length === 0)) {
      return isAuthenticated;
    }

    if (permission) return hasPermission(permission);
    if (permissions && permissions.length > 0) {
      return mode === 'any' ? hasAny(permissions) : hasAll(permissions);
    }
    
    return isAuthenticated;
  }, [permission, permissions, mode, hasPermission, hasAll, hasAny, isAuthenticated]);

  // Return not authenticated fallback if user is not logged in
  if (!isAuthenticated) {
    return <>{notAuthenticatedFallback}</>;
  }

  return <>{allowed ? children : fallback}</>;
};

export default ProtectedRoute;
