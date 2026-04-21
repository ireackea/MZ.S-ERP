import apiClient from '@api/client';

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
  session: AppBootstrapSession;
  resolvedPermissions: string[];
  referenceData: {
    categories: string[];
    units: string[];
  };
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