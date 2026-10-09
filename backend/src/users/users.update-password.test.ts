import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * `PUT /users/:id` used to accept `password`.
 *
 * The route is `users.update`. A holder of that permission could therefore set a new
 * password on any account they were allowed to edit, without knowing the current
 * one, while `changePassword` requires the current password and `resetPassword`
 * refuses to be used on yourself. `updateUser` had neither guard — the one path in
 * the system that could change a credential with nothing to prove the caller was
 * entitled to.
 *
 * Worse than the write itself: it was recorded as `USER_UPDATE`, a generic
 * "Updated user <name>", so a password set through the admin edit form is
 * indistinguishable in the trail from a name change. The event that most needs to be
 * noticeable is the one that left no sign of being that event.
 *
 * `POST /users/:id/reset-password` exists, is guarded the way this is not — it
 * refuses self-service, revokes sessions, forces a change, and audits as its own
 * action — and had no UI at all, so the unguarded path was the only one anyone could
 * reach. Removing it here and wiring that path into the screen is what makes the
 * credential write the honest one instead of merely one of two.
 */
const prisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  role: { findMany: vi.fn() },
  activeSession: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

// `id` and `userId` are both set: the service's audit rows read `userId`, while
// `resetPassword` compares `id === actor.id` for the self-service guard. A fixture
// with only one of them silently defeats that guard in a way that looks like a
// product defect.
const actor = {
  id: 'actor-1',
  userId: 'actor-1',
  actorUsername: 'admin',
  role: 'Admin',
};

const targetUser = {
  id: 'target-1',
  username: 'target',
  email: 'a@b.c',
  firstName: 'Some',
  lastName: 'One',
  role: { id: 'role-1', name: 'Viewer', permissions: [] },
  createdOpeningBalances: [],
  isActive: true,
  isLocked: false,
  failedAttempts: 0,
  lockoutUntil: null,
  isEmailConfirmed: false,
  mustChangePassword: false,
  passwordHash: 'old-hash',
  passwordSetByUser: true,
};

/**
 * The service constructs its own `AuditService(prisma)`, so a second constructor
 * argument is ignored and a real one reaches for `prisma.auditLog.create`. The field
 * is replaced to keep the trail a no-op: none of these assertions is about it.
 */
const service = new UsersService(prisma as never);
(
  service as unknown as { auditService: { log: ReturnType<typeof vi.fn> } }
).auditService = { log: vi.fn().mockResolvedValue(undefined) };
vi.spyOn(service as never, 'publish').mockImplementation(() => undefined);

const update = (dto: Record<string, unknown>) =>
  (
    service as unknown as {
      updateUser: (id: string, d: unknown, a: unknown) => Promise<unknown>;
    }
  ).updateUser('target-1', dto, actor);

const reset = (id: string, password: string, who = actor) =>
  (
    service as unknown as {
      resetPassword: (i: string, p: string, a: unknown) => Promise<unknown>;
    }
  ).resetPassword(id, password, who);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(targetUser);
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'Viewer', permissions: [] }]);
  prisma.user.count.mockResolvedValue(1);
  // The update re-includes the role and the opening balances it read before, so the
  // mock's answer has to carry them or `toUserDto` reads through undefined.
  prisma.user.update.mockResolvedValue({ ...targetUser, email: 'a@b.c' });
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.activeSession.updateMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({ id: 'a1' });
});

describe('updateUser no longer accepts a password', () => {
  it('refuses the field and names the endpoint that is meant for it', async () => {
    await expect(update({ password: 'Whatever1!' })).rejects.toThrow(BadRequestException);
    await expect(update({ password: 'Whatever1!' })).rejects.toThrow(/reset-password/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not touch the stored hash when password is sent', async () => {
    await expect(update({ password: 'Whatever1!' })).rejects.toThrow();

    for (const call of prisma.user.update.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.passwordHash).toBeUndefined();
    }
  });

  it('answers a policy-violating password with the same refusal, not silence', async () => {
    // Without this the field is dropped rather than answered, and a caller that sent
    // `password: '123'` would have no way to know it did nothing.
    await expect(update({ password: '123' })).rejects.toThrow(/reset-password/);
  });

  it('leaves every other field working', async () => {
    await expect(update({ email: 'a@b.c' })).resolves.toBeDefined();
    const data = (prisma.user.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.email).toBe('a@b.c');
    expect(data.passwordHash).toBeUndefined();
  });
});

describe('the password path that remains is the one that proves entitlement', () => {
  it('still refuses a SuperAdmin target to a non-SuperAdmin actor', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...targetUser,
      role: { id: 'role-s', name: 'SuperAdmin', permissions: [] },
    });

    await expect(reset('target-1', 'Whatever1!')).rejects.toThrow(ForbiddenException);
  });

  it('still refuses to reset your own password', async () => {
    // The guard is on the target's id, not the role, and it is what keeps this
    // endpoint from being an account takeover by a stale session.
    prisma.user.findUnique.mockResolvedValue({ ...targetUser, id: 'actor-1' });

    await expect(reset('actor-1', 'Whatever1!')).rejects.toThrow(/change my password/i);
  });

  it('still writes the hash and forces a change on the legitimate path', async () => {
    await expect(reset('target-1', 'Whatever1!')).resolves.toBeDefined();

    const data = (prisma.user.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(typeof data.passwordHash).toBe('string');
    expect(prisma.activeSession.updateMany).toHaveBeenCalled();
  });
});
