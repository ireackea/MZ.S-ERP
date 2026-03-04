// ENTERPRISE FIX: Phase 2 - Multi-User Sync - Final Completion Pass - 2026-03-02
// ENTERPRISE FIX: Exact Legacy UI Restoration - 2026-02-27
import apiClient from '@api/client';
import { getAuthToken } from './authService';

export type UsersStatusFilter = 'active' | 'locked';

export interface RoleDto {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  permissions: string;
  permissionsList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserDto {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName: string;
  isActive: boolean;
  failedAttempts: number;
  lockoutUntil?: string | null;
  createdAt: string;
  updatedAt: string;
  roleId: string;
  role: RoleDto;
}

export interface UsersListResponse {
  data: UserDto[];
  total: number;
  page: number;
  limit: number;
}

export interface UserAuditDto {
  id: string;
  userId: string;
  actorId: string;
  actorUsername: string;
  actorRole: string;
  action: string;
  details: string;
  timestamp: string;
}

type StreamEvent = {
  type: string;
  userId?: string;
  actorId?: string;
  timestamp: string;
};

const roleFromApi = (row: any): RoleDto => ({
  id: String(row?.id || ''),
  name: String(row?.name || ''),
  description: row?.description ?? null,
  color: String(row?.color || '#6b7280'),
  permissions: String(row?.permissions || '[]'),
  permissionsList: Array.isArray(row?.permissionsList)
    ? row.permissionsList.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [],
  createdAt: String(row?.createdAt || ''),
  updatedAt: String(row?.updatedAt || ''),
});

const userFromApi = (row: any): UserDto => ({
  id: String(row?.id || ''),
  username: String(row?.username || ''),
  email: row?.email ?? null,
  firstName: row?.firstName ?? null,
  lastName: row?.lastName ?? null,
  fullName: String(row?.fullName || row?.username || ''),
  isActive: Boolean(row?.isActive),
  failedAttempts: Number(row?.failedAttempts || 0),
  lockoutUntil: row?.lockoutUntil ?? null,
  createdAt: String(row?.createdAt || ''),
  updatedAt: String(row?.updatedAt || ''),
  roleId: String(row?.roleId || row?.role?.id || ''),
  role: roleFromApi(row?.role || {}),
});

export async function fetchUsers(params?: {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: UsersStatusFilter;
}): Promise<UsersListResponse> {
  const response = await apiClient.get('/users', { params });
  const payload = response.data || {};
  return {
    data: Array.isArray(payload.data) ? payload.data.map(userFromApi) : [],
    total: Number(payload.total || 0),
    page: Number(payload.page || params?.page || 1),
    limit: Number(payload.limit || params?.limit || 20),
  };
}

export async function fetchRoles(): Promise<RoleDto[]> {
  const response = await apiClient.get('/users/roles');
  return Array.isArray(response.data) ? response.data.map(roleFromApi) : [];
}

// ENTERPRISE FIX: Phase 2 - Multi-User Sync & Unified User Management - 2026-03-02
export async function createCustomRole(payload: { name: string; description?: string; color?: string; permissions?: string[] }): Promise<RoleDto> {
  const response = await apiClient.post('/users/roles', payload);
  return roleFromApi(response.data);
}

export async function inviteUser(payload: {
  email: string;
  roleId?: string;
  roleName?: string;
  expiresInMinutes?: number;
}): Promise<{ sent: boolean; email: string; expiresAt: string; invitationLink: string; invitationId: string }> {
  const response = await apiClient.post('/users/invite', payload);
  return {
    sent: Boolean(response.data?.sent),
    email: String(response.data?.email || payload.email),
    expiresAt: String(response.data?.expiresAt || ''),
    invitationLink: String(response.data?.invitationLink || ''),
    invitationId: String(response.data?.invitationId || ''),
  };
}

export async function verifyInvitation(token: string): Promise<{ valid: boolean; email: string; role: RoleDto; expiresAt: string }> {
  const response = await apiClient.post('/users/invite/verify', { token });
  return {
    valid: Boolean(response.data?.valid),
    email: String(response.data?.email || ''),
    role: roleFromApi(response.data?.role || {}),
    expiresAt: String(response.data?.expiresAt || ''),
  };
}

export async function acceptInvitation(payload: {
  token: string;
  password: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ accepted: boolean; user: UserDto }> {
  const response = await apiClient.post('/users/invite/accept', payload);
  return {
    accepted: Boolean(response.data?.accepted),
    user: userFromApi(response.data?.user || {}),
  };
}

export async function createUser(payload: {
  username: string;
  email?: string;
  password: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
  roleName?: string;
  isActive?: boolean;
}): Promise<UserDto> {
  const response = await apiClient.post('/users', payload);
  return userFromApi(response.data);
}

export async function updateUser(
  id: string,
  payload: {
    username?: string;
    email?: string | null;
    password?: string;
    firstName?: string | null;
    lastName?: string | null;
    roleId?: string;
    roleName?: string;
    isActive?: boolean;
  },
): Promise<UserDto> {
  const response = await apiClient.put(`/users/${encodeURIComponent(id)}`, payload);
  return userFromApi(response.data);
}

export async function deleteUser(id: string): Promise<{ deleted: boolean }> {
  const response = await apiClient.delete(`/users/${encodeURIComponent(id)}`);
  return { deleted: Boolean(response.data?.deleted) };
}

export async function lockUser(
  id: string,
  payload?: { locked?: boolean; durationMinutes?: number; reason?: string },
): Promise<UserDto> {
  const response = await apiClient.post(`/users/${encodeURIComponent(id)}/lock`, payload || {});
  return userFromApi(response.data);
}

export async function fetchUserAudit(userId: string): Promise<UserAuditDto[]> {
  const response = await apiClient.get(`/users/${encodeURIComponent(userId)}/audit`);
  return Array.isArray(response.data)
    ? response.data.map((row: any) => ({
        id: String(row?.id || ''),
        userId: String(row?.userId || ''),
        actorId: String(row?.actorId || ''),
        actorUsername: String(row?.actorUsername || 'unknown'),
        actorRole: String(row?.actorRole || 'unknown'),
        action: String(row?.action || ''),
        details: String(row?.details || ''),
        timestamp: String(row?.timestamp || ''),
      }))
    : [];
}

export async function updateRolePermissions(
  roleId: string,
  payload: { permissions: string[]; description?: string },
): Promise<RoleDto> {
  const response = await apiClient.put(
    `/users/roles/${encodeURIComponent(roleId)}/permissions`,
    payload,
  );
  return roleFromApi(response.data);
}

export async function bulkAssignRole(payload: {
  userIds: string[];
  roleId: string;
}): Promise<{ updated: number }> {
  const response = await apiClient.post('/users/bulk/assign-role', payload);
  return { updated: Number(response.data?.updated || 0) };
}

export async function bulkDeleteUsers(payload: { userIds: string[] }): Promise<{ deleted: number }> {
  const response = await apiClient.post('/users/bulk/delete', payload);
  return { deleted: Number(response.data?.deleted || 0) };
}

export function subscribeToUsersStream(
  onEvent: (event: StreamEvent) => void,
  onError?: (error: unknown) => void,
) {
  const token = getAuthToken();
  if (!token) return () => {};

  const base = String(import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const url = `${base}/users/stream?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as StreamEvent;
      onEvent(parsed);
    } catch {
      // Ignore malformed stream events.
    }
  };
  source.onerror = (error) => {
    if (onError) onError(error);
  };

  return () => source.close();
}


