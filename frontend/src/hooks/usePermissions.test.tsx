import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermissions } from './usePermissions';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock('./useSession', () => ({
  useSession: mocks.useSession,
}));

describe('usePermissions', () => {
  beforeEach(() => {
    mocks.useSession.mockReset();
  });

  it('FC-SEC-005: يطابق مفاتيح الكتالوج القانونية فقط', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'manager',
          permissions: ['items.view', 'transactions.view', 'reports.view', 'opening-balances.view'],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('items.view')).toBe(true);
    expect(result.current.hasPermission('transactions.view')).toBe(true);
    expect(result.current.hasPermission('opening-balances.view')).toBe(true);
    expect(result.current.hasPermission('reports.view')).toBe(true);

    // Stocktaking is its own catalog permission, never implied by items.view.
    expect(result.current.hasPermission('inventory.view.stocktaking')).toBe(false);
  });

  it('FC-SEC-005: مفاتيح قديمة لم تعد تُقبل، وFail-Closed', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'manager',
          permissions: ['items.view'],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    // The legacy gate keys are gone. A key the catalog does not define must
    // never match, otherwise a typo would read as a grant.
    expect(result.current.hasPermission('inventory.view.items')).toBe(false);
    expect(result.current.hasPermission('settings.view.users')).toBe(false);
    expect(result.current.hasPermission('items.delete')).toBe(false);
  });

  it('FC-SEC-005: لا يمنح صلاحيات محلية عندما تكون قائمة صلاحيات الخادم فارغة', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'SuperAdmin',
          permissions: [],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    // A zero-permission session must stay zero. The old role-name fallback
    // turned exactly this into a full Admin grant in the display layer.
    expect(result.current.permissions).toEqual([]);
    expect(result.current.hasPermission('admin.reset_system')).toBe(false);
    expect(result.current.hasPermission('users.view')).toBe(false);
  });
});