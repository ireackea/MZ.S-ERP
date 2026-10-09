import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  isSuper: false,
  listUsers: vi.fn(),
  listRoles: vi.fn(),
  fetchUserAudit: vi.fn(),
  resetUserPassword: vi.fn(),
  session: { data: { user: { id: 'actor-1' } } },
}));

/**
 * Mirrors `hasGrantedPermission` for the two shapes this spec needs: an explicit
 * list, or `*` which grants everything. `isSuper` is NOT treated as a wildcard
 * here — a separate flag that grants everything would make "a SuperAdmin without
 * `users.create`" untestable, and that pairing is exactly what gate 4.12 is about.
 */
vi.mock('@hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (permission: string) =>
      mocks.permissions.includes(permission) || mocks.permissions.includes('*'),
    permissions: mocks.permissions,
    isSuper: mocks.permissions.includes('*'),
  }),
}));

vi.mock('@/services/passwordService', () => ({
  resetUserPassword: mocks.resetUserPassword,
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => mocks.session,
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
  mocks.resetUserPassword.mockResolvedValue({ reset: true, username: 'target', mustChangePassword: true });
  window.confirm = vi.fn(() => true);
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

  /**
   * Gate 4.12 — the route decorators are `users.update`, but the service calls
   * `assertSuperAdmin` under them, so the two are not the same gate and the screen
   * was showing the looser one.
   *
   * The default Admin role holds `users.*`, so on a stock install every Admin saw
   * "حفظ" and "حذف الدور" and got a 403 for their trouble, with no hint that a role
   * rather than a permission was what they lacked. These tests now assert the screen
   * matches the server, which is the only version of "the UI tells the truth" that
   * means anything.
   */
  it('offers no role control to a users.update session that is not SuperAdmin', async () => {
    mocks.permissions = ['users.view', 'users.update', 'users.create'];
    render(<UnifiedIAM />);
    await openMatrix();

    expect(screen.queryByText('حذف الدور')).toBeNull();
    expect(screen.queryByText('حفظ', { exact: true })).toBeNull();
    expect(screen.queryByText('إنشاء دور')).toBeNull();
  });

  it('offers role controls to a SuperAdmin', async () => {
    mocks.permissions = ['users.view', '*'];
    render(<UnifiedIAM />);
    await openMatrix();

    expect(screen.getByText('حذف الدور')).toBeInTheDocument();
    expect(screen.getByText('حفظ', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('إنشاء دور')).toBeInTheDocument();
  });

  it('offers no role creation to a users.create session that is not SuperAdmin', async () => {
    // Reachable and the real near-miss: an account that may create *users* is not
    // thereby allowed to create *roles*. `POST /users/roles` is `users.create` and
    // the service additionally requires SuperAdmin, so both halves must hold.
    //
    // A SuperAdmin without `users.create` is not a state this can test, because `*`
    // grants everything by definition — that pairing is defensive in the component,
    // not observable here.
    mocks.permissions = ['users.view', 'users.create'];
    render(<UnifiedIAM />);
    await openMatrix();

    expect(screen.queryByText('إنشاء دور')).toBeNull();
    expect(screen.queryByText('حذف الدور')).toBeNull();
  });
});
/**
 * Gate 4.13 - the guarded password path had no UI at all.
 *
 * `resetUserPassword` existed in passwordService and nothing called it, because the
 * only way to change a credential was `PUT /users/:id` with a `password` field —
 * no current password, no self-check, and audited as a generic "Updated user". The
 * server now refuses that field and points at this endpoint, so the button is what
 * makes the refusal an answer rather than a dead end.
 */
describe('the password reset is reachable from the screen', () => {
  it('offers the reset to a users.update session', async () => {
    mocks.permissions = ['users.view', 'users.update'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    expect(screen.getByTitle(/إعادة تعيين كلمة المرور/)).toBeInTheDocument();
  });

  it('does not offer it to a session that cannot update users', async () => {
    mocks.permissions = ['users.view'];
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    expect(screen.queryByTitle(/إعادة تعيين كلمة المرور/)).toBeNull();
  });

  it('disables it on the actor\'s own row, because the endpoint refuses self-service', async () => {
    mocks.permissions = ['users.view', 'users.update'];
    // The fixture user is u1, not the session's actor-1, so point the session at them.
    mocks.session = { data: { user: { id: 'u1' } } };
    render(<UnifiedIAM />);
    await screen.findByText('someone');

    expect((screen.getByTitle(/إعادة تعيين كلمة المرور/) as HTMLButtonElement).disabled).toBe(true);
  });
});