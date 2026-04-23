import { useEffect } from 'react';
import { clearAllAuthData, setAuthUser } from '@services/authService';
import { upsertCurrentSession } from '@services/iamService';
import { getAppBootstrap, type AppBootstrapPayload, type AppBootstrapSession } from '@services/appBootstrapService';
import { migrateLegacyUnloadingRules } from '@services/unloadingRulesService';
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

type RestoredSessionResult =
  | {
      outcome: 'success';
      payload: AppBootstrapSessionResultPayload;
    }
  | {
      outcome: 'anonymous';
    }
  | {
      outcome: 'failed';
      error: unknown;
    };

type AppBootstrapSessionResultPayload = AppBootstrapSessionPayload & {
  unloadingRules: AppBootstrapPayload['unloadingRules'];
};

type AppBootstrapSessionPayload = Omit<AppBootstrapPayload, 'unloadingRules'>;

type AuthenticatedShellResult = {
  outcome: 'success' | 'failed';
  userId: string;
  error?: unknown;
};

let restoreSessionPromise: Promise<RestoredSessionResult> | null = null;
let restoreSessionResult: RestoredSessionResult | null = null;
let authenticatedShellPromise: Promise<AuthenticatedShellResult> | null = null;
let authenticatedShellCompletedUserId: string | null = null;
let authenticatedShellInFlightUserId: string | null = null;

const restoreSessionOnce = async (): Promise<RestoredSessionResult> => {
  if (restoreSessionResult) {
    return restoreSessionResult;
  }

  if (!restoreSessionPromise) {
    restoreSessionPromise = (async () => {
      try {
        const payload = await getAppBootstrap();
        let bootstrappedRules = payload.unloadingRules || [];

        if (bootstrappedRules.length === 0) {
          try {
            bootstrappedRules = await migrateLegacyUnloadingRules();
          } catch (migrationError) {
            console.warn('[useAppBootstrap] Legacy unloading-rules migration failed:', migrationError);
          }
        }

        const result: RestoredSessionResult = {
          outcome: 'success',
          payload: {
            ...payload,
            unloadingRules: bootstrappedRules,
          },
        };
        restoreSessionResult = result;
        return result;
      } catch (error: any) {
        if (error?.response?.status === 401) {
          const result: RestoredSessionResult = { outcome: 'anonymous' };
          restoreSessionResult = result;
          return result;
        }

        return {
          outcome: 'failed',
          error,
        };
      } finally {
        restoreSessionPromise = null;
      }
    })();
  }

  return restoreSessionPromise;
};

const resetAuthenticatedShellState = () => {
  authenticatedShellPromise = null;
  authenticatedShellCompletedUserId = null;
  authenticatedShellInFlightUserId = null;
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
  const setUnloadingRules = useInventoryStore((state) => state.setUnloadingRules);
  const loadInventoryCore = useInventoryStore((state) => state.loadInventoryCore);
  const loadTransactions = useInventoryStore((state) => state.loadTransactions);
  const loadUsersAndRoles = useInventoryStore((state) => state.loadUsersAndRoles);
  const currentUserId = currentUser?.id ?? null;

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const routePath = typeof window !== 'undefined' ? window.location.pathname : '/';
      startBootstrapMetrics('session-restore', routePath);

      try {
        const result = await restoreSessionOnce();
        if (!active) return;

        if (result.outcome === 'anonymous') {
          clearAllAuthData();
          setCurrentUser(undefined);
          setAuthReady(true);
          completeBootstrapMetrics({ outcome: 'anonymous' });
          return;
        }

        if (result.outcome === 'failed') {
          console.error('[useAppBootstrap] Session restore failed:', result.error);
          setAuthReady(true);
          completeBootstrapMetrics({
            outcome: 'failed',
            error: result.error instanceof Error ? result.error.message : String(result.error),
          });
          return;
        }

        const { payload } = result;
        setReferenceData(payload.referenceData);
        setUnloadingRules(payload.unloadingRules);

        const restoredUser = toUser({
          ...payload.session,
          permissions: payload.resolvedPermissions,
        });

        setCurrentUser(restoredUser);
        setAuthUser(toAuthSessionUser(restoredUser));
        upsertCurrentSession(restoredUser);
        setAuthReady(true);
      } catch (error) {
        if (!active) return;

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
    };
  }, [setAuthReady, setCurrentUser, setReferenceData, setUnloadingRules]);

  useEffect(() => {
    if (!authReady) return;

    if (!currentUserId) {
      resetAuthenticatedShellState();
      setInventoryRouteReady(false);
      return;
    }

    let active = true;
    setInventoryRouteReady(false);

    const bootstrapAuthenticatedShell = async (): Promise<AuthenticatedShellResult> => {
      if (authenticatedShellCompletedUserId === currentUserId) {
        return {
          outcome: 'success',
          userId: currentUserId,
        };
      }

      if (!authenticatedShellPromise || authenticatedShellInFlightUserId !== currentUserId) {
        authenticatedShellInFlightUserId = currentUserId;

        const routePath = typeof window !== 'undefined' ? window.location.pathname : '/';
        startBootstrapMetrics('authenticated-shell', routePath);

        authenticatedShellPromise = (async () => {
          try {
            await loadInventoryCore({ force: true, staleMs: 0 });
            await loadTransactions({ force: true, staleMs: 0 });
            await loadUsersAndRoles({ force: true, staleMs: 0 });

            authenticatedShellCompletedUserId = currentUserId;
            completeBootstrapMetrics({ outcome: 'success' });
            return {
              outcome: 'success',
              userId: currentUserId,
            } satisfies AuthenticatedShellResult;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('[useAppBootstrap] Authenticated bootstrap failed:', error);
            completeBootstrapMetrics({ outcome: 'failed', error: errorMessage });
            return {
              outcome: 'failed',
              userId: currentUserId,
              error,
            } satisfies AuthenticatedShellResult;
          } finally {
            authenticatedShellPromise = null;
            authenticatedShellInFlightUserId = null;
          }
        })();
      }

      return authenticatedShellPromise;
    };

    void bootstrapAuthenticatedShell().then((result) => {
      if (!active || result.userId !== currentUserId) {
        return;
      }

      setInventoryRouteReady(true);
    });

    return () => {
      active = false;
    };
  }, [authReady, currentUserId, loadInventoryCore, loadTransactions, loadUsersAndRoles, setInventoryRouteReady]);
};