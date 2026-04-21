import { useEffect, useRef } from 'react';
import { clearAllAuthData, setAuthUser } from '@services/authService';
import { upsertCurrentSession } from '@services/iamService';
import { getAppBootstrap, type AppBootstrapSession } from '@services/appBootstrapService';
import { completeBootstrapMetrics, startBootstrapMetrics } from '@utils/bootstrapMetrics';
import type { User } from '../types';
import { useInventoryStore } from '../store/useInventoryStore';

type UseAppBootstrapOptions = {
  currentUser: User | undefined;
  authReady: boolean;
  setCurrentUser: (user: User | undefined) => void;
  setAuthReady: (ready: boolean) => void;
  setInventoryRouteReady: (ready: boolean) => void;
};

const toUser = (session: AppBootstrapSession): User => ({
  id: session.id,
  username: session.username,
  email: session.email ?? undefined,
  firstName: session.firstName ?? undefined,
  lastName: session.lastName ?? undefined,
  name: session.name || session.username,
  role: session.role,
  roleId: session.roleId,
  permissions: Array.isArray(session.permissions) ? session.permissions : [],
  active: session.active !== false,
  isActive: session.isActive !== false,
  status: (session.status as User['status']) || 'active',
  scope: session.scope || 'all',
  twoFactorEnabled: false,
  twoFaEnabled: false,
  mustChangePassword: false,
});

const toAuthSessionUser = (user: User) => ({
  id: user.id,
  username: String(user.username || user.email || user.name || user.id),
  role: String(user.role || user.roleId || 'User'),
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  name: String(user.name || user.username || user.email || user.id),
});

export const useAppBootstrap = ({
  currentUser,
  authReady,
  setCurrentUser,
  setAuthReady,
  setInventoryRouteReady,
}: UseAppBootstrapOptions) => {
  const setReferenceData = useInventoryStore((state) => state.setReferenceData);
  const loadInventoryCore = useInventoryStore((state) => state.loadInventoryCore);
  const loadTransactions = useInventoryStore((state) => state.loadTransactions);
  const loadUsersAndRoles = useInventoryStore((state) => state.loadUsersAndRoles);
  const restoreStartedRef = useRef(false);
  const bootstrappedUserIdRef = useRef<string | null>(null);
  const currentUserId = currentUser?.id ?? null;

  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;

    let active = true;

    const restoreSession = async () => {
      const routePath = typeof window !== 'undefined' ? window.location.pathname : '/';
      startBootstrapMetrics('session-restore', routePath);

      try {
        const payload = await getAppBootstrap();
        if (!active) return;

        setReferenceData(payload.referenceData);

        const restoredUser = toUser({
          ...payload.session,
          permissions: payload.resolvedPermissions,
        });

        setCurrentUser(restoredUser);
        setAuthUser(toAuthSessionUser(restoredUser));
        upsertCurrentSession(restoredUser);
        setAuthReady(true);
      } catch (error: any) {
        if (!active) return;

        if (error?.response?.status === 401) {
          clearAllAuthData();
          setCurrentUser(undefined);
          setAuthReady(true);
          completeBootstrapMetrics({ outcome: 'anonymous' });
          return;
        }

        console.error('[useAppBootstrap] Session restore failed:', error);
        setAuthReady(true);
        completeBootstrapMetrics({
          outcome: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void restoreSession();

    return () => {
      active = false;
      restoreStartedRef.current = false;
    };
  }, [setAuthReady, setCurrentUser, setReferenceData]);

  useEffect(() => {
    if (!authReady) return;

    if (!currentUserId) {
      bootstrappedUserIdRef.current = null;
      setInventoryRouteReady(false);
      return;
    }

    if (bootstrappedUserIdRef.current === currentUserId) {
      return;
    }

    bootstrappedUserIdRef.current = currentUserId;
    let active = true;
    setInventoryRouteReady(false);

    const bootstrapAuthenticatedShell = async () => {
      const routePath = typeof window !== 'undefined' ? window.location.pathname : '/';
      startBootstrapMetrics('authenticated-shell', routePath);

      let errorMessage: string | null = null;

      try {
        await loadInventoryCore({ force: true, staleMs: 0 });
        await loadTransactions({ force: true, staleMs: 0 });
        await loadUsersAndRoles({ force: true, staleMs: 0 });
        completeBootstrapMetrics({ outcome: 'success' });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[useAppBootstrap] Authenticated bootstrap failed:', error);
        completeBootstrapMetrics({ outcome: 'failed', error: errorMessage });
      } finally {
        if (active) {
          setInventoryRouteReady(true);
        }
      }
    };

    void bootstrapAuthenticatedShell();

    return () => {
      active = false;
      bootstrappedUserIdRef.current = null;
    };
  }, [authReady, currentUserId, loadInventoryCore, loadTransactions, loadUsersAndRoles, setInventoryRouteReady]);
};