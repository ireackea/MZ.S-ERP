// SECURITY FIX: 2026-03-28 - Added authentication check before permission validation
import React, { ReactNode, useMemo } from 'react';
import { usePermissions } from '@hooks/usePermissions';
import { useSession } from '@hooks/useSession';

interface ProtectedRouteProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
  mode?: 'all' | 'any';
  fallback?: ReactNode;
  requireAuth?: boolean;
}

const notAuthenticatedFallback = (
  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 font-bold">
    Please log in to access this page.
  </div>
);

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
  requireAuth = true,
}) => {
  const { hasPermission, hasAll, hasAny, isAuthenticated } = usePermissions();
  const { session } = useSession();

  const allowed = useMemo(() => {
    // SECURITY FIX: 2026-03-28 - Check authentication first
    if (requireAuth && !isAuthenticated) {
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
  }, [permission, permissions, mode, hasPermission, hasAll, hasAny, isAuthenticated, requireAuth]);

  // Return not authenticated fallback if user is not logged in
  if (requireAuth && !isAuthenticated) {
    return <>{notAuthenticatedFallback}</>;
  }

  return <>{allowed ? children : fallback}</>;
};

export default ProtectedRoute;
