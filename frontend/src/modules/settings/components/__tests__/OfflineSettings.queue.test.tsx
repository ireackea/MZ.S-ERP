import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  retryFailed: vi.fn(),
  queueTasks: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/hooks/useOfflineSync', () => ({
  useOfflineSync: () => ({ ...mocks.state, retryFailed: mocks.retryFailed, queueTasks: mocks.queueTasks }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@/services/dateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/services/dateFormat')>('@/services/dateFormat');
  return actual;
});

import OfflineSettings from '../OfflineSettings';

const base = {
  isOffline: false,
  isSyncing: false,
  pendingCount: 0,
  blockedCount: 0,
  totalCount: 0,
  conflictCount: 0,
  failedCount: 0,
  deadLetterCount: 0,
  lastLoadedAt: null,
  executeWithSync: vi.fn(),
  retryFailed: () => mocks.retryFailed(),
  queueTasks: () => mocks.queueTasks(),
};

const retryButton = () => screen.getByRole('button', { name: /إعادة محاولة الكل/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { ...base };
  mocks.hasPermission.mockReturnValue(true);
  mocks.queueTasks.mockResolvedValue([]);
});

describe('#22 the offline queue reports what it holds and can actually retry', () => {
  it('counts a refused mutation as blocked, not as pending', () => {
    mocks.state = { ...base, pendingCount: 0, blockedCount: 3, totalCount: 3 };
    render(<OfflineSettings />);

    // Not folded into the pending line, and named as its own thing.
    expect(screen.getByText(/3 مهمة في الطابور: 0 بانتظار الإرسال/)).toBeInTheDocument();
    expect(screen.getByText(/رفضها الخادم/)).toBeInTheDocument();
  });

  it('disables the retry button when nothing in the queue is retryable', () => {
    // The false affordance: a queue of only `blocked` tasks is non-empty, so a button
    // keyed on emptiness is enabled, while `retryOwner` retries failed/conflict/
    // dead-letter only — it would do nothing at all.
    mocks.state = { ...base, pendingCount: 0, blockedCount: 2, totalCount: 2 };
    render(<OfflineSettings />);
    expect(retryButton().disabled).toBe(true);
  });

  it('enables the retry button for a task it will genuinely re-send', () => {
    mocks.state = { ...base, failedCount: 1, totalCount: 1 };
    render(<OfflineSettings />);
    expect(retryButton().disabled).toBe(false);
  });

  it('counts the dead-letter tasks the retry will re-send', () => {
    mocks.state = { ...base, deadLetterCount: 2, blockedCount: 1, totalCount: 3 };
    render(<OfflineSettings />);
    expect(retryButton().disabled).toBe(false);
    expect(retryButton().textContent).toContain('2');
  });

  it('keeps blocked visible even when the queue is otherwise empty', () => {
    mocks.state = { ...base, blockedCount: 1, totalCount: 1, pendingCount: 0 };
    render(<OfflineSettings />);
    // A blocked task is the one case where an operator has to act, so it must not be
    // hidden behind a zero count.
    expect(screen.getByText(/رفضها الخادم/)).toBeInTheDocument();
  });
});

/**
 * Gate 4.8 - two things this panel got wrong that the tests above cannot see,
 * because they hold a session with every permission.
 *
 * **The retry control writes while being gated on a read permission.** The tab is
 * visible on `settings.view.general` and the button it carried re-sends whatever the
 * session queued anywhere else in the app. The server refuses what the holder is not
 * permitted to do, so nothing is gained — but a gate that says "read" and offers a
 * control that "writes" is a gate that says one thing and does another.
 *
 * **The operator is told a permission is missing and never told which.** There was
 * no task list anywhere in the application, so "يلزم تغيير الصلاحية أولاً" was the
 * end of the trail. The queue's own rows name the URL and method the server refused.
 */
describe('#23 the retry control is gated like the write it performs', () => {
  it('disables retry for a session that can only view settings', () => {
    mocks.hasPermission.mockImplementation((key: string) => key === 'settings.view.general');
    mocks.state = { ...base, failedCount: 1, totalCount: 1 };

    render(<OfflineSettings />);

    expect(retryButton().disabled).toBe(true);
  });

  it('enables retry for a session that holds the write permission', () => {
    // Both keys, because the tab itself needs `settings.view.general` to be reached
    // at all — a session with only the write key never renders this panel, which is
    // itself the answer to what the gate is.
    mocks.hasPermission.mockImplementation((key: string) =>
      key === 'settings.view.general' || key === 'settings.update.system',
    );
    mocks.state = { ...base, failedCount: 1, totalCount: 1 };

    render(<OfflineSettings />);

    expect(retryButton().disabled).toBe(false);
  });

  it('names the missing permission on the disabled control, not just "disabled"', () => {
    mocks.hasPermission.mockImplementation((key: string) => key === 'settings.view.general');
    mocks.state = { ...base, failedCount: 1, totalCount: 1 };

    render(<OfflineSettings />);

    expect(retryButton().title).toMatch(/settings\.update\.system/);
  });
});

describe('#24 the panel shows the queue it is counting', () => {
  it('renders the URL and method of a task the server refused', async () => {
    mocks.queueTasks.mockResolvedValue([
      {
        id: 'q1',
        url: '/transactions',
        method: 'post',
        operation: 'POST transactions',
        status: 'blocked',
        attempts: 2,
        entity: 'transactions',
        lastError: 'لا تملك صلاحية transactions.create',
      },
    ]);
    mocks.state = { ...base, blockedCount: 1, totalCount: 1 };

    render(<OfflineSettings />);

    // The whole point: the sentence "a permission is missing" is now answerable.
    expect(await screen.findByText('post /transactions')).toBeInTheDocument();
    expect(screen.getByText(/لا تملك صلاحية transactions\.create/)).toBeInTheDocument();
    expect(screen.getByText('مرفوضة من الخادم')).toBeInTheDocument();
  });

  it('shows how many attempts a task has spent', async () => {
    mocks.queueTasks.mockResolvedValue([
      { id: 'q1', url: '/items', method: 'delete', operation: 'DELETE items', status: 'dead-letter', attempts: 8, entity: 'items' },
    ]);
    mocks.state = { ...base, deadLetterCount: 1, totalCount: 1 };

    render(<OfflineSettings />);

    expect(await screen.findByText('8')).toBeInTheDocument();
  });
});