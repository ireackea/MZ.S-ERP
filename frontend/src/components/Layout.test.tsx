import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';
import type { User } from '../types';

vi.mock('../hooks/useOfflineSync', () => ({
  useOfflineSync: () => ({
    isOffline: false,
    pendingCount: 0,
  }),
}));

const renderLayout = (currentUser: User) =>
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <Layout currentUser={currentUser}>
        <div>content</div>
      </Layout>
    </MemoryRouter>,
  );

describe('Layout', () => {
  it('يخفي عناصر التنقل التي لا يملك المستخدم صلاحيتها', () => {
    const restrictedUser = {
      id: 'user-1',
      name: 'Restricted User',
      username: 'restricted.user',
      role: 'manager',
      roleId: 'manager',
      permissions: ['sales.view.orders'],
      active: true,
      isActive: true,
      status: 'active',
      scope: 'all',
    } as User;

    renderLayout(restrictedUser);

    expect(screen.getByRole('link', { name: 'طلبات الشراء' })).toBeInTheDocument();
    expect(screen.queryByText('إدارة المستخدمين')).not.toBeInTheDocument();
    expect(screen.queryByText('الإعدادات')).not.toBeInTheDocument();
    expect(screen.queryByText('عمليات المخازن')).not.toBeInTheDocument();
  });

  it('يعرض جميع عناصر التنقل للمسؤول', () => {
    const adminUser = {
      id: 'admin-1',
      name: 'Admin User',
      username: 'admin.user',
      role: 'Admin',
      roleId: 'Admin',
      permissions: [
        'users.*',
        'settings.*',
        'reports.*',
        'items.*',
        'transactions.*',
        'formulation.*',
        'opening-balances.*',
        'backup.*',
        'theme.*',
      ],
      active: true,
      isActive: true,
      status: 'active',
      scope: 'all',
    } as User;

    renderLayout(adminUser);

    expect(screen.getByText('إدارة المستخدمين')).toBeInTheDocument();
    expect(screen.getByText('الإعدادات')).toBeInTheDocument();
    expect(screen.getByText('عمليات المخازن')).toBeInTheDocument();
  });

  it('يقبل صلاحيات الخلفية canonical داخل عناصر التنقل الحديثة', () => {
    const backendScopedUser = {
      id: 'user-2',
      name: 'Backend Scoped User',
      username: 'backend.scoped',
      role: 'manager',
      roleId: 'manager',
      permissions: ['items.view', 'transactions.view', 'reports.view', 'opening-balances.view'],
      active: true,
      isActive: true,
      status: 'active',
      scope: 'all',
    } as User;

    renderLayout(backendScopedUser);

    expect(screen.getAllByRole('link', { name: 'عمليات المخازن' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'الأصناف' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'الجرد' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'بطاقة الصنف' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'كشف حساب' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'أرصدة افتتاحية' }).length).toBeGreaterThan(0);
  });
});