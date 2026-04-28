export const AUTH_USER_STORAGE_KEY = 'feed_factory_jwt_user';
export const AUTH_SESSION_EVENT = 'feed_factory_auth_session_changed';

const AUTH_STORAGE_PREFIXES = ['feed_factory_jwt_', 'feed_factory_auth_'];
const AUTH_STORAGE_KEYS = [
  'feed_factory_last_login_username',
  'feed_factory_current_session_id',
  'feed_factory_last_activity_at',
];

export type AuthSessionUser = {
  id: string;
  username: string;
  role: string;
  permissions?: string[];
  name?: string;
};

const emitSessionChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
};

const clearMatchingStorage = (storage: Storage | undefined) => {
  if (!storage) return;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key) continue;

    if (
      AUTH_STORAGE_KEYS.includes(key) ||
      AUTH_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      storage.removeItem(key);
    }
  }
};

export const clearAllAuthData = () => {
  if (typeof window === 'undefined') return;

  clearMatchingStorage(window.localStorage);
  clearMatchingStorage(window.sessionStorage);
  emitSessionChanged();
};

export const getAuthUser = (): AuthSessionUser | null => {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSessionUser;
  } catch (error) {
    console.error('[authSession] Failed to parse auth user:', error);
    return null;
  }
};

export const setAuthUser = (user: AuthSessionUser | null) => {
  if (typeof window === 'undefined') return;

  if (!user) {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } else {
    try {
      window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('[authSession] Failed to store auth user:', error);
    }
  }

  emitSessionChanged();
};