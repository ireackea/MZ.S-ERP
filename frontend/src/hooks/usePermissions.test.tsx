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

  it('يجسر معرفات المسارات الحديثة إلى صلاحيات الخلفية الحالية', () => {
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

    expect(result.current.hasPermission('inventory.view.operations')).toBe(true);
    expect(result.current.hasPermission('inventory.view.items')).toBe(true);
    expect(result.current.hasPermission('inventory.view.stocktaking')).toBe(true);
    expect(result.current.hasPermission('inventory.view.opening_balances')).toBe(true);
    expect(result.current.hasPermission('inventory.reports.stock_card')).toBe(true);
    expect(result.current.hasPermission('inventory.reports.statement')).toBe(true);
  });

  it('يدعم settings.view كمدخل متوافق لعرض الإعدادات العامة', () => {
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

    expect(result.current.hasPermission('settings.view')).toBe(true);
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
});