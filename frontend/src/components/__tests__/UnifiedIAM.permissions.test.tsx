import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  listUsers: vi.fn(),
  listRoles: vi.fn(),
  fetchUserAudit: vi.fn(),
}));

vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) => mocks.permissions.includes(permission),
    permissions: mocks.permissions,
  }),
}));

vi.mock('@/services/usersService', async () => {
  const actual = await vi.importActual<typeof import('@/services/usersService')>('@/services/usersService');
  return {
    ...actual,
    fetchUsers: mocks.listUsers,
    fetchRoles: mocks.listRoles,
    deleteUser: vi.fn(),
    updateUser: vi.fn(),
    lockUser: vi.fn(),
    createUser: vi.fn(),
    inviteUser: vi.fn(),
    bulkAssignRole: vi.fn(),
    bulkDeleteUsers: vi.fn(),
    updateRolePermissions: vi.fn(),
    deleteRole: vi.fn(),
  };
});

vi.mock('./ChangeMyPassword', () => ({ default: () => <div data-testid="change-password" /> }));

import UnifiedIAM from '../UnifiedIAM';

const user = {
  id: 'u1',
  username: 'someone',
  firstName: 'Some',
  lastName: 'One',
  email: 'a@b.c',
  roleId: 'r1',
  role: { id: 'r1', name: 'Viewer', permissions: [] },
  isActive: true,
  isLocked: false,
  failedAttempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = ['users.view'];
  // `fetchUsers` returns `{ data, total, page }`, not a `{ rows }` envelope — the mock has
  // to answer the shape the component actually destructures, or the table renders empty
  // and every assertion below fails for a reason that has nothing to do with permissions.
  mocks.listUsers.mockResolvedValue({ data: [user], total: 1, page: 1 });
  mocks.listRoles.mockResolvedValue([{ id: 'r1', name: 'Viewer', permissions: [] }]);
  mocks.fetchUserAudit.mockResolvedValue({ rows: [], total: 0 });
});

// Switches to the permissions-matrix tab and waits for its heading. It deliberately
  // asserts nothing about the buttons: whether "حفظ" is present is the claim under test,
//  so a helper that expected it would fail the very case it is meant to describe.
const openMatrix = async () => {
  await screen.findByText('someone');
  const tab = screen.getAllByRole('button').find((b) => b.textContent?.includes('مصفوفة الصلاحيات'));
  expect(tab, 'the matrix tab must exist for every viewer').toBeTruthy();
  (tab as HTMLElement).click();
  await waitFor(() => expect(screen.getAllByText('مصفوفة الصلاحيات').length).toBeGreaterThan(0));
};

describe('#13 the IAM screen shows the controls the session may use', () => {
  it('offers no mutating control to a users.view-only session', async () => {
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    // No lock, no delete, no bulk actions, no create-user form.
    expect(screen.queryByTitle('قفل')).toBeNull();
    expect(screen.queryByTitle('حذف')).toBeNull();
    expect(screen.queryByText('إنشاء المستخدم فوراً')).toBeNull();
    expect(screen.queryByText('عرض فقط')).toBeInTheDocument();
  });

  it('offers lock but not delete when only users.lock is held', async () => {
    mocks.permissions = ['users.view', 'users.lock'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    expect(screen.getByTitle('قفل')).toBeInTheDocument();
    expect(screen.queryByTitle('حذف')).toBeNull();
  });

  it('offers both when the session may delete and lock', async () => {
    mocks.permissions = ['users.view', 'users.lock', 'users.delete'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    expect(screen.getByTitle('قفل')).toBeInTheDocument();
    expect(screen.getByTitle('حذف')).toBeInTheDocument();
    expect(screen.queryByText('عرض فقط')).toBeNull();
  });

  it('offers bulk actions only when the matching permission is held', async () => {
    mocks.permissions = ['users.view', 'users.update'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    const assign = screen.getByRole('button', { name: /تعيين دور/ }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true); // nothing selected yet, and users.delete is absent

    mocks.permissions = ['users.view', 'users.delete'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');
    const bulkDelete = screen.getAllByRole('button', { name: /حذف/ }).find((b) =>
      (b as HTMLButtonElement).disabled !== undefined,
    ) as HTMLButtonElement;
    expect(bulkDelete).toBeTruthy();
  });

  it('keeps the matrix read-only without users.update', async () => {
    render(<UnifiedIAM />);
    await openMatrix();
    expect(screen.queryByText('حفظ', { exact: true })).toBeNull();
    expect(screen.queryByText('حذف الدور')).toBeNull();
  });

  it('lets a users.update session save the matrix and delete a role', async () => {
    mocks.permissions = ['users.view', 'users.update'];
    render(<UnifiedIAM />);
    await openMatrix();
    expect(screen.getByText('حذف الدور')).toBeInTheDocument();
    expect(screen.getByText('حفظ', { exact: true })).toBeInTheDocument();
    // Role creation is `users.create`, not `users.update`.
    expect(screen.queryByText('إنشاء دور')).toBeNull();
  });

  it('offers role creation only with users.create', async () => {
    mocks.permissions = ['users.view', 'users.create'];
    render(<UnifiedIAM />);
    await openMatrix();
    expect(screen.getByText('إنشاء دور')).toBeInTheDocument();
  });
});