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

  it('FC-SEC-002: يوسّع معرّفات المسارات القديمة إلىصلاحيات الكتالوج', () => {
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

    // Legacy UI gates still resolve to the canonical backend grants.
    expect(result.current.hasPermission('inventory.view.operations')).toBe(true);
    expect(result.current.hasPermission('inventory.view.items')).toBe(true);
    expect(result.current.hasPermission('inventory.view.opening_balances')).toBe(true);
    expect(result.current.hasPermission('inventory.reports.stock_card')).toBe(true);
    expect(result.current.hasPermission('inventory.reports.statement')).toBe(true);

    // Stocktaking is its own catalog permission now — it is NOT implied by items.view.
    expect(result.current.hasPermission('inventory.view.stocktaking')).toBe(false);
  });

  it('FC-SEC-002: يمنح الجرد لمن يملك inventory.*', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'manager',
          permissions: ['inventory.*'],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('inventory.view.stocktaking')).toBe(true);
    expect(result.current.hasPermission('inventory.close.stocktaking')).toBe(true);
  });

  it('FC-SEC-002: يدعم settings.view القديم كمدخل متوافق', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'admin',
          permissions: ['settings.view'],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    // A role still holding the legacy grant satisfies the canonical check.
    expect(result.current.hasPermission('settings.view.general')).toBe(true);
  });

  it('يعتبر admin.reset_system كافيًا لعرض تبويب إعادة الضبط', () => {
    mocks.useSession.mockReturnValue({
      data: {
        isAuthenticated: true,
        user: {
          role: 'admin',
          permissions: ['admin.reset_system'],
        },
      },
    });

    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('settings.view.reset')).toBe(true);
    expect(result.current.hasPermission('admin.reset_system')).toBe(true);
  });

  it('لا يمنح صلاحيات محلية عندما تكون قائمة صلاحيات الخادم فارغة', () => {
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

    expect(result.current.permissions).toEqual([]);
    expect(result.current.hasPermission('admin.reset_system')).toBe(false);
  });
});