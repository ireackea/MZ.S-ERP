// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
// ENTERPRISE FIX: Runtime Recovery Hardening - 2026-02-28
import apiClient from '@/api/client';

export const mockNetworkDelay = (ms = 300) => new Promise((res) => setTimeout(res, ms));

const getFallbackKey = (userId?: string) => `server_user_theme_${userId || 'demo'}`;

export const getUserTheme = async (userId = 'demo') => {
  try {
    const response = await apiClient.get(`/theme/user/${encodeURIComponent(userId)}`);
    return response?.data?.theme || 'classic';
  } catch {
    // Backend may return 401 before login; fallback to local state.
  }

  await mockNetworkDelay(200);
  const payload = localStorage.getItem(getFallbackKey(userId));
  return payload || 'classic';
};

export const updateUserTheme = async (theme: string, userId = 'demo') => {
  try {
    const response = await apiClient.post(`/theme/user/${encodeURIComponent(userId)}`, { theme });
    return response?.data || { success: true, theme };
  } catch {
    // keep UX stable even when backend sync is unavailable
  }

  await mockNetworkDelay(250);
  localStorage.setItem(getFallbackKey(userId), theme);
  return { success: true, theme };
};
