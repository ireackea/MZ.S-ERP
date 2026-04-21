import { useSyncExternalStore } from 'react';
import {
  AUTH_SESSION_EVENT,
  AuthSessionUser,
  getAuthUser,
  getAuthToken,
} from '@services/authService';

export type SessionState = {
  status: 'anonymous' | 'authenticated';
  token: string;
  user: AuthSessionUser | null;
  isAuthenticated: boolean;
};

let cachedSessionKey = '';
let cachedSessionState: SessionState = {
  status: 'anonymous',
  token: '',
  user: null,
  isAuthenticated: false,
};

const readSession = (): SessionState => {
  const user = getAuthUser();
  const token = getAuthToken();
  const isAuthenticated = Boolean(user);

  const nextSessionKey = JSON.stringify({ token, user, isAuthenticated });
  if (nextSessionKey === cachedSessionKey) {
    return cachedSessionState;
  }

  cachedSessionKey = nextSessionKey;
  cachedSessionState = {
    status: isAuthenticated ? 'authenticated' : 'anonymous',
    token,
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

    if (event.key === 'feed_factory_jwt_user' || event.key === 'feed_factory_jwt_token') {
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

