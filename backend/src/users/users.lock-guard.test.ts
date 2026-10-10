import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Locking an account has two problems.
 *
 * **There is no self-check, and that one is fixed here.** `deleteUser` refuses when
 * `id === actor.id`, and `bulkDelete` does the same; `setLockStatus` did not. So a
 * holder of `users.lock` could lock themselves out through the same screen that
 * refuses to let them delete themselves.
 *
 * **`assertNotLastSuperAdmin` is a read, then a write, with nothing between them.**
 * It counts the active SuperAdmins excluding the rows being locked — which is why it
 * passes. Two concurrent locks both read `remaining === 1`, both pass, and the system
 * ends with zero active SuperAdmins.
 *
 * That one is deliberately NOT fixed in this change. The fix that closes it is a
 * `SELECT … FOR UPDATE` over the SuperAdmin rows inside a transaction, which changes
 * the locking behaviour of the account path on a live system; it belongs in its own
 * batch with its own e2e, not appended to the one that closes the self-guard. What
 * these tests do is pin the guard that exists, so the race cannot be mistaken for
 * being closed by accident.
 */
const prisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  activeSession: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

const service = new UsersService(prisma as never);
(
  service as unknown as { auditService: { log: ReturnType<typeof vi.fn> } }
).auditService = { log: vi.fn().mockResolvedValue(undefined) };
vi.spyOn(service as never, 'publish').mockImplementation(() => undefined);

/** A SuperAdmin, so the role guard does not answer before the ones under test. */
const actor = { id: 'actor-1', userId: 'actor-1', actorUsername: 'super', role: 'SuperAdmin' };
const otherAdmin = { id: 'admin-2', userId: 'admin-2', actorUsername: 'other', role: 'SuperAdmin' };

const targetUser = {
  id: 'target-1',
  username: 'target',
  role: { id: 'role-s', name: 'SuperAdmin' },
  createdOpeningBalances: [],
  isActive: true,
  isLocked: false,
  failedAttempts: 0,
};

const lock = (id: string, who = actor) =>
  (
    service as unknown as {
      setLockStatus: (id: string, dto: unknown, a: unknown) => Promise<unknown>;
    }
  ).setLockStatus(id, { locked: true, reason: 'إجراء إداري' }, who);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(targetUser);
  // Two active SuperAdmins exist: the target and one other. This is the state in which
  // the current code's read passes and the race still ends with zero.
  prisma.user.findMany.mockResolvedValue([{ id: 'target-1', role: { name: 'SuperAdmin' } }]);
  prisma.user.count.mockResolvedValue(1);
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
    ...targetUser,
    ...(data as Record<string, unknown>),
    id: where.id,
  }));
  prisma.activeSession.updateMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({ id: 'a1' });
});

describe('locking an account is scoped like deleting one', () => {
  it('refuses to lock yourself', async () => {
    await expect(lock('actor-1')).rejects.toThrow(BadRequestException);
    await expect(lock('actor-1')).rejects.toThrow(/cannot lock your own account/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('still locks somebody else', async () => {
    await expect(lock('target-1')).resolves.toBeDefined();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  /**
   * Not a claim that the race is closed. This is the assertion that keeps the
   * remaining hole from being widened by accident: if the pre-check disappears, the
   * common case stops being refused, and the only thing standing between an operator
   * and the last SuperAdmin is timing.
   */
  it('still refuses the single-SuperAdmin case when it can see it', async () => {
    prisma.user.count.mockResolvedValue(0);

    await expect(lock('target-1')).rejects.toThrow(/SuperAdmin/);
  });
});
