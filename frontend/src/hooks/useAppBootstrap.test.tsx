import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBootstrapPayload } from '@services/appBootstrapService';
import type { User } from '../types';

const mockedModules = vi.hoisted(() => ({
  mockGetAppBootstrap: vi.fn<() => Promise<AppBootstrapPayload>>(),
  mockMigrateLegacyUnloadingRules: vi.fn<() => Promise<AppBootstrapPayload['unloadingRules']>>(),
  mockClearAllAuthData: vi.fn(),
  mockSetAuthUser: vi.fn(),
  mockUpsertCurrentSession: vi.fn(),
  mockStartBootstrapMetrics: vi.fn(),
  mockCompleteBootstrapMetrics: vi.fn(),
  mockSetReferenceData: vi.fn(),
  mockSetUnloadingRules: vi.fn(),
  mockLoadInventoryCore: vi.fn<() => Promise<void>>(),
  mockLoadTransactions: vi.fn<() => Promise<void>>(),
  mockLoadUsersAndRoles: vi.fn<() => Promise<void>>(),
  mockLoadUnloadingRules: vi.fn<() => Promise<void>>(),
}));

const {
  mockGetAppBootstrap,
  mockMigrateLegacyUnloadingRules,
  mockClearAllAuthData,
  mockSetAuthUser,
  mockUpsertCurrentSession,
  mockStartBootstrapMetrics,
  mockCompleteBootstrapMetrics,
  mockSetReferenceData,
  mockSetUnloadingRules,
  mockLoadInventoryCore,
  mockLoadTransactions,
  mockLoadUsersAndRoles,
  mockLoadUnloadingRules,
} = mockedModules;

let mockStoreState: {
  setReferenceData: typeof mockSetReferenceData;
  setUnloadingRules: typeof mockSetUnloadingRules;
  loadInventoryCore: typeof mockLoadInventoryCore;
  loadTransactions: typeof mockLoadTransactions;
  loadUsersAndRoles: typeof mockLoadUsersAndRoles;
  loadUnloadingRules: typeof mockLoadUnloadingRules;
};

vi.mock('@services/appBootstrapService', () => ({
  getAppBootstrap: mockedModules.mockGetAppBootstrap,
}));

vi.mock('@services/unloadingRulesService', () => ({
  migrateLegacyUnloadingRules: mockedModules.mockMigrateLegacyUnloadingRules,
}));

vi.mock('@services/authService', () => ({
  clearAllAuthData: mockedModules.mockClearAllAuthData,
  setAuthUser: mockedModules.mockSetAuthUser,
}));

vi.mock('@services/iamService', () => ({
  upsertCurrentSession: mockedModules.mockUpsertCurrentSession,
}));

vi.mock('@utils/bootstrapMetrics', () => ({
  startBootstrapMetrics: mockedModules.mockStartBootstrapMetrics,
  completeBootstrapMetrics: mockedModules.mockCompleteBootstrapMetrics,
}));

vi.mock('../store/useInventoryStore', () => ({
  useInventoryStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
}));

const bootstrapPayload: AppBootstrapPayload = {
  session: {
    id: 'user-1',
    username: 'bootstrap.user',
    name: 'Bootstrap User',
    role: 'SuperAdmin',
    permissions: ['*'],
    isActive: true,
    active: true,
    status: 'active',
    scope: 'all',
  },
  resolvedPermissions: ['*'],
  referenceData: {
    categories: ['مواد خام'],
    units: ['طن'],
  },
  unloadingRules: [
    {
      id: 'rule-1',
      rule_name: 'ميناء مصراتة',
      allowed_duration_minutes: 60,
      penalty_rate_per_minute: 2.5,
      is_active: true,
    },
  ],
  startupFlags: {
    hasItems: true,
    hasTransactions: true,
    hasOpeningBalances: false,
  },
};

const createHarness = async () => {
  const { useAppBootstrap } = await import('./useAppBootstrap');

  return function Harness() {
    const [currentUser, setCurrentUser] = React.useState<User | undefined>(undefined);
    const [authReady, setAuthReady] = React.useState(false);
    const [inventoryRouteReady, setInventoryRouteReady] = React.useState(false);

    useAppBootstrap({
      currentUser,
      authReady,
      setCurrentUser,
      setAuthReady,
      setInventoryRouteReady,
    });

    return (
      <div>
        {authReady ? 'auth-ready' : 'auth-pending'}
        {inventoryRouteReady ? ' route-ready' : ' route-pending'}
        {currentUser?.username ? ` ${currentUser.username}` : ''}
      </div>
    );
  };
};

describe('useAppBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockStoreState = {
      setReferenceData: mockSetReferenceData,
      setUnloadingRules: mockSetUnloadingRules,
      loadInventoryCore: mockLoadInventoryCore,
      loadTransactions: mockLoadTransactions,
      loadUsersAndRoles: mockLoadUsersAndRoles,
      loadUnloadingRules: mockLoadUnloadingRules,
    };

    mockGetAppBootstrap.mockResolvedValue(bootstrapPayload);
    mockMigrateLegacyUnloadingRules.mockResolvedValue([]);
    mockLoadInventoryCore.mockResolvedValue(undefined);
    mockLoadTransactions.mockResolvedValue(undefined);
    mockLoadUsersAndRoles.mockResolvedValue(undefined);
    mockLoadUnloadingRules.mockResolvedValue(undefined);
  });

  it('deduplicates session restore and authenticated shell under StrictMode', async () => {
    const Harness = await createHarness();

    render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockGetAppBootstrap).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockLoadInventoryCore).toHaveBeenCalledTimes(1);
      expect(mockLoadTransactions).toHaveBeenCalledTimes(1);
      expect(mockLoadUsersAndRoles).toHaveBeenCalledTimes(1);
    });

    expect(mockLoadUnloadingRules).not.toHaveBeenCalled();

    expect(mockSetReferenceData).toHaveBeenCalledWith(bootstrapPayload.referenceData);
    expect(mockSetUnloadingRules).toHaveBeenCalledWith(bootstrapPayload.unloadingRules);
    expect(mockSetAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        username: 'bootstrap.user',
        role: 'SuperAdmin',
      }),
    );
    expect(mockUpsertCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        username: 'bootstrap.user',
      }),
    );
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
    expect(mockMigrateLegacyUnloadingRules).not.toHaveBeenCalled();
  });

  it('treats an anonymous bootstrap payload as an unauthenticated shell without backend errors', async () => {
    const Harness = await createHarness();

    mockGetAppBootstrap.mockResolvedValue({
      ...bootstrapPayload,
      session: null,
      resolvedPermissions: [],
    });

    render(<Harness />);

    await waitFor(() => {
      expect(mockGetAppBootstrap).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/auth-ready/)).toBeInTheDocument();
    });

    expect(mockLoadInventoryCore).not.toHaveBeenCalled();
    expect(mockLoadTransactions).not.toHaveBeenCalled();
    expect(mockLoadUsersAndRoles).not.toHaveBeenCalled();
    expect(mockSetReferenceData).not.toHaveBeenCalled();
    expect(mockSetUnloadingRules).not.toHaveBeenCalled();
    expect(mockSetAuthUser).not.toHaveBeenCalled();
    expect(mockClearAllAuthData).toHaveBeenCalledTimes(1);
  });
});