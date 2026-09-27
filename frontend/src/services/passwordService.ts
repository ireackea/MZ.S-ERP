import apiClient from '@api/client';
import type { ChangePasswordPayload } from './passwordPolicy';

export type ChangePasswordResult = { changed: boolean; sessionsRevoked: boolean };

/**
 * FC-SEC-010 — change your own password.
 *
 * The system had no password change, reset or recovery path of any kind, so a
 * password was set once and stayed for the life of the account. Every session
 * is revoked by the server, so the caller signs in again with the new password.
 */
export async function changeMyPassword(payload: ChangePasswordPayload): Promise<ChangePasswordResult> {
  const response = await apiClient.post('/auth/change-password', {
    currentPassword: payload.currentPassword,
    newPassword: payload.newPassword,
  });
  return {
    changed: Boolean(response.data?.changed),
    sessionsRevoked: Boolean(response.data?.sessionsRevoked),
  };
}

/** FC-SEC-010 — administrator-issued temporary password. Revokes their sessions. */
export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<{ reset: boolean; username: string; mustChangePassword: boolean }> {
  const response = await apiClient.post(`/users/${encodeURIComponent(userId)}/reset-password`, {
    newPassword,
  });
  return {
    reset: Boolean(response.data?.reset),
    username: String(response.data?.username || ''),
    mustChangePassword: Boolean(response.data?.mustChangePassword),
  };
}
