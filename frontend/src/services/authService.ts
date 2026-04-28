// ENTERPRISE FIX: Phase 0 - Stabilization & UTF-8 Lockdown - 2026-03-05
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Runtime Recovery Hardening - 2026-02-28
import apiClient from '@api/client';
import {
  AUTH_SESSION_EVENT,
  clearAllAuthData,
  getAuthUser,
  setAuthUser,
  type AuthSessionUser,
} from './authSession';

export { AUTH_SESSION_EVENT, clearAllAuthData, getAuthUser, setAuthUser } from './authSession';
export type { AuthSessionUser } from './authSession';

export type AuthLoginResponse = {
  accessToken?: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthSessionUser;
};

export const login = async (username: string, password: string): Promise<AuthLoginResponse> => {
  try {
    console.log('[authService] Login request:', { username });

    const response = await apiClient.post<AuthLoginResponse>('/auth/login', { username, password });
    const payload = response.data;

    if (!payload?.user) {
      throw new Error('Invalid response from server');
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

const redirectToLogin = () => {
  if (typeof window === 'undefined') return;

  try {
    if (window.location.pathname !== '/login') {
      window.history.replaceState(window.history.state, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } catch {
    window.location.href = '/login';
  }
};

export const logout = async () => {
  try {
    await apiClient.post('/auth/logout');
  } catch (error) {
    console.error('[authService] Backend logout failed:', error);
  }

  try {
    clearAllAuthData();
    console.log('[authService] User logged out');
    redirectToLogin();
  } catch (error) {
    console.error('[authService] Failed to logout:', error);
  }
};