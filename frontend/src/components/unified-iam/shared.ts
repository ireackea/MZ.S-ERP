import type { RoleDto, UsersStatusFilter } from '@services/usersService';

/**
 * FC-SEC-005 — the least-privileged role, used as the only automatic default.
 *
 * The IAM selects defaulted to `roles[0]`, and the roles endpoint orders by
 * `createdAt asc`, so `roles[0]` was `SuperAdmin`. Creating a user or bulk
 * assigning a role without touching the dropdown therefore produced a
 * SuperAdmin. Nothing is ever auto-selected now: the dropdowns open on a
 * placeholder and refuse to submit until a role is chosen explicitly.
 */
export const FALLBACK_ROLE_NAME = 'Viewer';

/** The role a fresh form should offer as a suggestion — never an auto-selection. */
export const findLeastPrivilegeRole = (roles: readonly RoleDto[]): RoleDto | undefined => {
  if (!roles.length) return undefined;
  return roles.find((role) => role.name === FALLBACK_ROLE_NAME)
    ?? [...roles].sort((a, b) => a.name.localeCompare(b.name))[0];
};

/** Role ids that must never be granted by a single mis-click. */
export const isFullAccessRoleName = (name: string): boolean =>
  String(name || '').trim().toLowerCase() === 'superadmin';

export const roleNameOf = (roleId: string, roles: readonly RoleDto[]): string =>
  roles.find((role) => role.id === roleId)?.name || roleId;

export type CreateUserFormState = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roleId: string;
};

export const INITIAL_CREATE_FORM: CreateUserFormState = {
  username: '',
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  roleId: '',
};

export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error) {
    const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim()) return responseMessage;

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const normalizeStatusFilter = (value: string): UsersStatusFilter | '' => (
  value === 'active' || value === 'locked' ? value : ''
);