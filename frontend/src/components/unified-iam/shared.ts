import type { UsersStatusFilter } from '@services/usersService';

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