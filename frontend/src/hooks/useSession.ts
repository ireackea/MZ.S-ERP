import { useSyncExternalStore } from 'react';
import {
  AUTH_SESSION_EVENT,
  AUTH_USER_STORAGE_KEY,
  type AuthSessionUser,
  getAuthUser,
} from '@services/authSession';

export type SessionState = {
  status: 'anonymous' | 'authenticated';
  user: AuthSessionUser | null;
  isAuthenticated: boolean;
};

let cachedSessionKey = '';
let cachedSessionState: SessionState = {
  status: 'anonymous',
  user: null,
  isAuthenticated: false,
};

const readSession = (): SessionState => {
  const user = getAuthUser();
  const isAuthenticated = Boolean(user);

  const nextSessionKey = JSON.stringify({ user, isAuthenticated });
  if (nextSessionKey === cachedSessionKey) {
    return cachedSessionState;
  }

  cachedSessionKey = nextSessionKey;
  cachedSessionState = {
    status: isAuthenticated ? 'authenticated' : 'anonymous',
    user,
    isAuthenticated,
  };

  return cachedSessionState;
};

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const refresh = () => onStoreChange();
  const onStorage = (event: StorageEvent) => {
    if (!event.key) {
      refresh();
      return;
    }

    if (event.key === AUTH_USER_STORAGE_KEY) {
      refresh();
    }
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(AUTH_SESSION_EVENT, refresh);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(AUTH_SESSION_EVENT, refresh);
  };
};

export const useSession = () => {
  const data = useSyncExternalStore(subscribe, readSession, readSession);

  return { data };
};

