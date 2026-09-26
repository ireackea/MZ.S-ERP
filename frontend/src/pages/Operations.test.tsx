import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  dailyOperationsSpy: vi.fn(),
  bulkCreateTransactions: vi.fn(),
  deleteTransactionsInApi: vi.fn(),
  updateTransactionInApi: vi.fn(),
  logUserActivity: vi.fn(),
  toastError: vi.fn(),
  hasPermission: vi.fn(),
  sessionData: undefined as any,
  storeState: {
    items: [],
    transactions: [],
    systemSettings: {},
    unloadingRules: [],
    setTransactions: vi.fn(),
    updateStockFromTransaction: vi.fn(),
  } as any,
};

const setupModuleMocks = () => {
  vi.doMock('./OperationsView', () => ({
    default: (props: any) => {
      mocks.dailyOperationsSpy(props);
      return null;
    },
  }));

  vi.doMock('@hooks/useSession', () => ({
    useSession: () => ({ data: mocks.sessionData }),
  }));

  vi.doMock('@hooks/usePermissions', () => ({
    usePermissions: () => ({ hasPermission: mocks.hasPermission }),
  }));

  vi.doMock('../services/transactionsService', () => ({
    bulkCreateTransactions: mocks.bulkCreateTransactions,
    deleteTransactionsInApi: mocks.deleteTransactionsInApi,
    updateTransactionInApi: mocks.updateTransactionInApi,
  }));

  vi.doMock('../services/iamService', () => ({
    logUserActivity: mocks.logUserActivity,
  }));

  vi.doMock('../store/useInventoryStore', () => ({
    useInventoryStore: (selector: (state: any) => any) => selector(mocks.storeState),
  }));

  vi.doMock('@services/toastService', () => ({
    toast: {
      error: mocks.toastError,
    },
  }));
};

const renderOperationsPage = async () => {
  const module = await import('./Operations');
  render(<module.default />);
};

describe('OperationsPage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.sessionData = {
      user: {
        id: 'user-1',
        name: 'System SuperAdmin',
        username: 'superadmin',
      },
    };

    mocks.hasPermission.mockImplementation(
      (permission: string) => permission === 'inventory.create.inbound' || permission === 'inventory.export.stock',
    );

    mocks.storeState = {
      items: [],
      transactions: [
        { id: 'tx-older', supplierOrReceiver: 'Partner B', timestamp: 1000 },
        { id: 'tx-newer', supplierOrReceiver: 'Partner A', timestamp: 2000 },
        { id: 'tx-duplicate-partner', supplierOrReceiver: 'Partner A', timestamp: 1500 },
      ],
      systemSettings: {},
      unloadingRules: [],
      setTransactions: vi.fn(),
      updateStockFromTransaction: vi.fn(),
    };

    setupModuleMocks();
  });

  it('passes permissions to OperationsView without requiring a session token and logs import/export activity', async () => {
    await renderOperationsPage();

    await waitFor(() => {
      expect(mocks.dailyOperationsSpy).toHaveBeenCalled();
    });

    const props = mocks.dailyOperationsSpy.mock.lastCall?.[0];
    expect(props).toBeTruthy();
    expect(props.canImport).toBe(true);
    expect(props.canExport).toBe(true);
    expect(props.currentUserId).toBe('user-1');
    expect(props.transactions.map((row: any) => row.id)).toEqual(['tx-newer', 'tx-duplicate-partner', 'tx-older']);
    expect(props.partners.map((partner: any) => partner.name)).toEqual(['Partner B', 'Partner A']);

    props.onImport(3);
    props.onExport(2);

    expect(mocks.logUserActivity).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      userName: 'System SuperAdmin',
      event: 'data_import',
      details: 'استيراد بيانات إلى العمليات - 3 سجل',
    });
    expect(mocks.logUserActivity).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      userName: 'System SuperAdmin',
      event: 'data_export',
      details: 'تصدير بيانات من العمليات - 2 سجل',
    });
  });

  it('updates local state after the server accepts a transaction without a second API request', async () => {
    const draftRow = {
      id: 'draft-tx-1',
      itemId: 'item-1',
      quantity: 5,
      timestamp: 3000,
    } as any;

    mocks.storeState.transactions = [];

    await renderOperationsPage();

    await waitFor(() => {
      expect(mocks.dailyOperationsSpy).toHaveBeenCalled();
    });

    const props = mocks.dailyOperationsSpy.mock.lastCall?.[0];
    props.onAddTransaction([draftRow]);

    await waitFor(() => {
      expect(mocks.bulkCreateTransactions).not.toHaveBeenCalled();
      expect(mocks.storeState.setTransactions).toHaveBeenCalledWith([draftRow]);
      expect(mocks.storeState.updateStockFromTransaction).toHaveBeenCalledWith(draftRow, 'add');
    });
  });
});