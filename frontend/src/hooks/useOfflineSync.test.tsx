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
    sync: mocks.syncMock,
    enqueue: mocks.enqueueMock,
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

describe('useOfflineSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQueueSizeMock.mockResolvedValue(3);
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