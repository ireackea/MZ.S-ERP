import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/dom';
import { useOfflineSync } from './useOfflineSync';

const mocks = vi.hoisted(() => ({
  registerMock: vi.fn(),
  startRealtimeSyncMock: vi.fn(() => ({
    io: {
      reconnectionDelay: vi.fn(),
      reconnectionDelayMax: vi.fn(),
    },
  })),
  stopRealtimeSyncMock: vi.fn(),
  getQueueSizeMock: vi.fn(),
  getQueueStatsMock: vi.fn(),
  syncMock: vi.fn(),
  enqueueMock: vi.fn(),
  getAuthUserMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../services/mutationQueueService', () => ({
  mutationQueueService: {
    getQueueSize: mocks.getQueueSizeMock,
    getQueueStats: mocks.getQueueStatsMock,
    sync: mocks.syncMock,
    enqueue: mocks.enqueueMock,
    resumeOwner: vi.fn().mockResolvedValue(undefined),
    retryOwner: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/realtimeSync', () => ({
  startRealtimeSync: mocks.startRealtimeSyncMock,
  stopRealtimeSync: mocks.stopRealtimeSyncMock,
}));

vi.mock('@services/toastService', () => ({
  toast: mocks.toastMock,
}));

vi.mock('@services/authSession', () => ({
  AUTH_SESSION_EVENT: 'feed_factory_auth_session_changed',
  getAuthUser: mocks.getAuthUserMock,
}));

const Consumer = () => {
  const { isOffline, pendingCount } = useOfflineSync();
  return <div>{`${isOffline ? 'offline' : 'online'}:${pendingCount}`}</div>;
};

const TransactionConsumer = () => {
  const { executeWithSync } = useOfflineSync();
  return (
    <button
      type="button"
      onClick={() => {
        void executeWithSync('/transactions/bulk', 'POST', { transactions: [] }).catch(() => undefined);
      }}
    >
      Save transaction
    </button>
  );
};

describe('useOfflineSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQueueSizeMock.mockResolvedValue(3);
    mocks.getQueueStatsMock.mockResolvedValue({ total: 3, pending: 3, processing: 0, failed: 0, conflicts: 0, blocked: 0, deadLetter: 0 });
    mocks.syncMock.mockResolvedValue(undefined);
    mocks.enqueueMock.mockResolvedValue(undefined);
    mocks.registerMock.mockResolvedValue({ scope: '/' });
    mocks.getAuthUserMock.mockReturnValue({ id: 'user-1' });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: mocks.registerMock,
      },
    });

    window.localStorage.clear();
    window.history.replaceState(null, '', '/operations');
  });

  afterEach(() => {
    cleanup();
  });

  it('shares one runtime across multiple consumers without duplicating realtime startup', async () => {
    const view = render(
      <>
        <Consumer />
        <Consumer />
      </>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('online:3')).toHaveLength(2);
    });

    expect(mocks.startRealtimeSyncMock).toHaveBeenCalledTimes(1);
    expect(mocks.registerMock).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(mocks.stopRealtimeSyncMock).toHaveBeenCalledTimes(1);
  });

  it('does not queue inventory transactions while offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    render(<TransactionConsumer />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save transaction' })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: 'Save transaction' }).click();

    await waitFor(() => {
      expect(mocks.toastMock.warning).toHaveBeenCalled();
    });
    expect(mocks.enqueueMock).not.toHaveBeenCalled();
  });

  it('delays realtime startup until an authenticated session exists', async () => {
    mocks.getAuthUserMock.mockReturnValue(null);

    const view = render(<Consumer />);

    await waitFor(() => {
      expect(screen.getByText('online:3')).toBeInTheDocument();
    });

    expect(mocks.startRealtimeSyncMock).not.toHaveBeenCalled();

    mocks.getAuthUserMock.mockReturnValue({ id: 'user-2' });
    window.dispatchEvent(new Event('feed_factory_auth_session_changed'));

    await waitFor(() => {
      expect(mocks.startRealtimeSyncMock).toHaveBeenCalledTimes(1);
    });

    view.unmount();
  });
});