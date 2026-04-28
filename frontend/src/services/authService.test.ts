import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/client', () => ({
  default: {
    post: vi.fn(),
  },
}));

import apiClient from '@api/client';
import { logout } from './authService';

const postMock = vi.mocked(apiClient.post);

describe('authService.logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/operations');

    window.localStorage.setItem('feed_factory_jwt_user', JSON.stringify({ id: 'user-1' }));
    window.localStorage.setItem('feed_factory_auth_credentials', JSON.stringify([{ userId: 'user-1' }]));
    window.sessionStorage.setItem('feed_factory_auth_transient', '1');
  });

  it('calls backend logout, clears auth storage, and redirects to login', async () => {
    postMock.mockResolvedValue({ data: { success: true } });

    await logout();

    expect(postMock).toHaveBeenCalledWith('/auth/logout');
    expect(window.localStorage.getItem('feed_factory_jwt_user')).toBeNull();
    expect(window.localStorage.getItem('feed_factory_auth_credentials')).toBeNull();
    expect(window.sessionStorage.getItem('feed_factory_auth_transient')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });

  it('still clears auth storage and redirects when backend logout fails', async () => {
    postMock.mockRejectedValue(new Error('network down'));

    await logout();

    expect(postMock).toHaveBeenCalledWith('/auth/logout');
    expect(window.localStorage.getItem('feed_factory_jwt_user')).toBeNull();
    expect(window.location.pathname).toBe('/login');
  });
});