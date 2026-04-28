import apiClient from '@api/client';
import type { UnloadingRule } from '../types';

export type AppBootstrapSession = {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string;
  role: string;
  roleId?: string;
  permissions: string[];
  isActive?: boolean;
  active?: boolean;
  status?: string;
  scope?: string;
};

export type AppBootstrapPayload = {
  session: AppBootstrapSession | null;
  resolvedPermissions: string[];
  referenceData: {
    categories: string[];
    units: string[];
  };
  unloadingRules: UnloadingRule[];
  startupFlags: {
    hasItems: boolean;
    hasTransactions: boolean;
    hasOpeningBalances: boolean;
  };
};

export const getAppBootstrap = async (): Promise<AppBootstrapPayload> => {
  const response = await apiClient.get('/app/bootstrap');
  return response.data as AppBootstrapPayload;
};