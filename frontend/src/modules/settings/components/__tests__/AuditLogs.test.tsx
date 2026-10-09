import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two of these three assertions fail on the code that ships, and the third passes.
 * That ratio is the point of writing them before the fix.
 *
 * **Pagination and filtering did not reach the server.** `loadAuditLogs` was
 * `useCallback(…, [])` — no dependencies — so it captured `page` and every filter
 * from the first render and kept them forever. The effect that fires on a filter
 * change (`AuditLogs.tsx:189-199`) did re-run and re-request, but it called the
 * same frozen function, so it sent the original page and the original filters
 * again. Gate 3.2's comment at :186-188 describes the symptom as what the fix
 * prevents, while the defect was permanent.
 *
 * **The export left out `entityType`.** The list query sends it and the export does
 * not, so the row the audit screen counts and the rows the file contains are two
 * different sets — and the "exported 1000 of N" warning is measured against the
 * count of the wrong one.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@api/client', () => ({ default: { get: mocks.get } }));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@services/toastService', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import AuditLogs from '../AuditLogs';

/** Enough rows that the pagination control renders at all. */
const TOTAL = 137;
const FIXTURE = (offset = 0) => ({
  rows: [{ id: `row-${offset}`, timestamp: new Date().toISOString(), action: 'LOGIN_FAILED', entityType: 'User', entityId: 'u1', actorUsername: 'superadmin', actorRole: 'SuperAdmin', status: 'failed', message: 'bad password', ipAddress: '127.0.0.1' }],
  total: TOTAL,
  limit: 50,
  offset,
});

const csvText = 'action,entityType\nLOGIN_FAILED,User\n';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/audit/logs/facets') {
      return { data: { actions: ['LOGIN_FAILED'], entityTypes: ['User'] } };
    }
    if (url === '/audit/logs/export') {
      return { data: new Blob([csvText], { type: 'text/csv' }) };
    }
    return { data: FIXTURE() };
  });
  // jsdom has neither of these and the export path uses both.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
  globalThis.URL.revokeObjectURL = vi.fn();
});

/** The last call to the list endpoint — the one whose params are in question. */
const lastListParams = () => {
  const calls = mocks.get.mock.calls
    .filter((call: unknown[]) => call[0] === '/audit/logs')
    .map((call: unknown[]) => call[1] as { params?: Record<string, unknown> } | undefined);
  return calls[calls.length - 1];
};

describe('the audit screen asks the server for what is on screen', () => {
  it('sends the new offset when the page advances', async () => {
    render(<AuditLogs />);
    await waitFor(() => expect(lastListParams()).toBeDefined());
    expect(lastListParams()?.params?.offset).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));

    await waitFor(() => expect(lastListParams()?.params?.offset).toBe(50));
  });

  it('sends the entity filter the operator chose', async () => {
    render(<AuditLogs />);
    await waitFor(() => expect(lastListParams()).toBeDefined());

    fireEvent.change(screen.getByDisplayValue('كل الكيانات'), { target: { value: 'User' } });

    await waitFor(() => expect(lastListParams()?.params?.entityType).toBe('User'));
  });

  it('sends the action filter the operator chose', async () => {
    render(<AuditLogs />);
    await waitFor(() => expect(lastListParams()).toBeDefined());

    fireEvent.change(screen.getByDisplayValue('كل الإجراءات'), { target: { value: 'LOGIN_FAILED' } });

    await waitFor(() => expect(lastListParams()?.params?.action).toBe('LOGIN_FAILED'));
  });

  it('exports the same filtered set the row count is measured against', async () => {
    render(<AuditLogs />);
    await waitFor(() => expect(lastListParams()).toBeDefined());
    fireEvent.change(screen.getByDisplayValue('كل الكيانات'), { target: { value: 'User' } });
    await waitFor(() => expect(lastListParams()?.params?.entityType).toBe('User'));

    fireEvent.click(screen.getByRole('button', { name: /تصدير CSV/ }));

    await waitFor(() => {
      const call = mocks.get.mock.calls.find((entry: unknown[]) => entry[0] === '/audit/logs/export');
      expect(call).toBeDefined();
      expect((call?.[1] as { params?: Record<string, unknown> })?.params?.entityType).toBe('User');
    });
  });
});
