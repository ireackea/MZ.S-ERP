// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Runtime Recovery Hardening - 2026-02-28
import apiClient from '@api/client';

const AUTH_TOKEN_KEY = 'feed_factory_jwt_token';
const AUTH_USER_KEY = 'feed_factory_jwt_user';
export const AUTH_SESSION_EVENT = 'feed_factory_auth_session_changed';

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

const emitSessionChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
};

export const getAuthToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || '';

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

    localStorage.setItem(AUTH_TOKEN_KEY, payload.accessToken);
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

export const logout = () => {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setAuthUser(null);
    console.log('[authService] User logged out');
  } catch (error) {
    console.error('[authService] Failed to logout:', error);
  }
};