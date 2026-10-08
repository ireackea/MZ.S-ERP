import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  retryFailed: vi.fn(),
}));

vi.mock('@/hooks/useOfflineSync', () => ({
  useOfflineSync: () => ({ ...mocks.state, retryFailed: mocks.retryFailed }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
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
};

const retryButton = () => screen.getByRole('button', { name: /إعادة محاولة الكل/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { ...base };
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