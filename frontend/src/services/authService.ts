// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Runtime Recovery Hardening - 2026-02-28
import apiClient from '@api/client';

const AUTH_TOKEN_KEY = 'feed_factory_jwt_token';
const AUTH_USER_KEY = 'feed_factory_jwt_user';
export const AUTH_SESSION_EVENT = 'feed_factory_auth_session_changed';
const AUTH_STORAGE_PREFIXES = ['feed_factory_jwt_', 'feed_factory_auth_'];
const AUTH_STORAGE_KEYS = [
  'feed_factory_last_login_username',
  'feed_factory_current_session_id',
  'feed_factory_last_activity_at',
];

export type AuthLoginResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: {
    id: string;
    username: string;
    role: string;
    permissions?: string[];
    name?: string;
  };
};

export type AuthSessionUser = AuthLoginResponse['user'];

const isBearerJwtToken = (value: string | null | undefined) => {
  const token = String(value || '').trim();
  return token.includes('.') && token.split('.').length === 3;
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

export const getAuthToken = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return isBearerJwtToken(token) ? String(token) : '';
};

export const getAuthUser = () => {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('[authService] Failed to parse auth user:', error);
    return null;
  }
};

export const setAuthUser = (user: AuthSessionUser | null) => {
  if (!user) {
    localStorage.removeItem(AUTH_USER_KEY);
  } else {
    try {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('[authService] Failed to store auth user:', error);
    }
  }
  emitSessionChanged();
};

export const login = async (username: string, password: string): Promise<AuthLoginResponse> => {
  try {
    console.log('[authService] Login request:', { username });

    const response = await apiClient.post<AuthLoginResponse>('/auth/login', { username, password });
    const payload = response.data;

    if (!payload?.accessToken || !payload?.user) {
      throw new Error('Invalid response from server');
    }

    if (isBearerJwtToken(payload.accessToken)) {
      localStorage.setItem(AUTH_TOKEN_KEY, payload.accessToken);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    setAuthUser(payload.user);

    console.log('[authService] Login successful:', {
      userId: payload.user?.id,
      username: payload.user?.username,
      role: payload.user?.role,
    });

    return payload;
  } catch (error: any) {
    console.error('[authService] Login failed:', {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    throw error;
  }
};

export const resetLoginAttempts = async (username: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.post<{ success: boolean; message: string }>('/auth/reset-attempts', { username });
    return response.data;
  } catch (error: any) {
    console.error('[authService] Reset login attempts failed:', {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    throw error;
  }
};

export const logout = () => {
  try {
    clearAllAuthData();
    console.log('[authService] User logged out');
    window.location.href = '/login';
  } catch (error) {
    console.error('[authService] Failed to logout:', error);
  }
};