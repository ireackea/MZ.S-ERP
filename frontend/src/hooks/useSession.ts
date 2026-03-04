import { useEffect, useState } from 'react';
import {
  AUTH_SESSION_EVENT,
  AuthSessionUser,
  getAuthUser,
  getAuthToken,
} from '@services/authService';

type SessionState = {
  token: string;
  user: AuthSessionUser | null;
};

const readSession = (): SessionState => ({
  token: '', // ENTERPRISE FIX: Phase 0 - Fatal Errors Fixed - 2026-03-02
  user: getAuthUser(),
});

export const useSession = () => {
  const [data, setData] = useState<SessionState>(() => readSession());

  useEffect(() => {
    const refresh = () => setData(readSession());
    const onStorage = (event: StorageEvent) => {
      if (!event.key) {
        refresh();
        return;
      }
      if (event.key === 'feed_factory_jwt_user') {
        refresh();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(AUTH_SESSION_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AUTH_SESSION_EVENT, refresh);
    };
  }, []);

  return { data };
};

