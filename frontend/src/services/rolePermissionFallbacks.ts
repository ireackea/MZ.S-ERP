/**
 * FC-SEC-003 — single source for the role → permission display fallback.
 *
 * Previously three components each carried their own copy of this table, which
 * is how the frontend ended up granting capabilities the backend never issued.
 * The grants below are the canonical ones served by the backend; they are used
 * for DISPLAY only when the session has not yet delivered a permission list.
 * The backend remains the sole enforcement authority.
 */
export const ROLE_PERMISSION_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  SuperAdmin: ['*'],
  superadmin: ['*'],
  Admin: [
    'users.*',
    'settings.*',
    'reports.*',
    'backup.*',
    'items.*',
    'transactions.*',
    'formulation.*',
    'opening-balances.*',
    'partners.*',
    'sales.*',
    'inventory.*',
    'dashboard.view',
    'theme.*',
    'monitoring.logs.write',
  ],
  admin: [
    'users.*',
    'settings.*',
    'reports.*',
    'backup.*',
    'items.*',
    'transactions.*',
    'formulation.*',
    'opening-balances.*',
    'partners.*',
    'sales.*',
    'inventory.*',
    'dashboard.view',
    'theme.*',
    'monitoring.logs.write',
  ],
};

const normalize = (permissions: unknown): string[] =>
  Array.isArray(permissions)
    ? [...new Set(permissions.filter((entry): entry is string => typeof entry === 'string'))]
    : [];

/** Resolves the display fallback for a role name, or an empty list. */
export const resolveRoleFallbackPermissions = (role: unknown): string[] => {
  const key = String(role || '').trim();
  return key ? [...(ROLE_PERMISSION_FALLBACKS[key] || [])] : [];
};

/**
 * The effective list used for display: the session's own permissions when the
 * server supplied any, otherwise the role fallback. Never widens a
 * server-issued list.
 */
export const resolveEffectiveDisplayPermissions = (
  sessionPermissions: unknown,
  role: unknown,
): string[] => {
  const fromServer = normalize(sessionPermissions);
  if (fromServer.length > 0) return fromServer;
  return resolveRoleFallbackPermissions(role);
};
