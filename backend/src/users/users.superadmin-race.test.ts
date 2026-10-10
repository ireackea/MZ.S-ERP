import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Two administrators, two windows, each locking the other.
 *
 * `assertNotLastSuperAdmin` counts the active SuperAdmins and then the caller writes,
 * with nothing between them. With exactly two SuperAdmins, A locking B and B locking A
 * concurrently: A's count excludes B and still sees A, so it passes; B's count excludes
 * A and still sees B, so it passes. Both commit and the system has **zero** active
 * SuperAdmins - the state where nobody can administer it, reached through the one
 * action the check exists to prevent.
 *
 * This is the reachable shape. A single administrator clearing out accounts is not a
 * race, because their own row stays active and the invariant holds. Locking your own
 * account is refused by a different guard entirely, and asserting on that rejection
 * would be counting the wrong refusal.
 */
const roleSuper = { id: 'role-s', name: 'SuperAdmin' };

const makePrisma = () => {
  const rows = [
    { id: 'actor-1', roleId: 'role-s', isActive: true, isLocked: false, username: 'one', role: roleSuper, createdOpeningBalances: [] },
    { id: 'actor-2', roleId: 'role-s', isActive: true, isLocked: false, username: 'two', role: roleSuper, createdOpeningBalances: [] },
  ];

  /**
   * A barrier over the count query, which stays open once opened.
   *
   * Without it the two requests interleave in whatever order the microtasks resolve,
   * and the test passes for a reason unrelated to the guard: one write lands before the
   * other one's count resolves, so the second sees the committed state and is refused.
   * Holding every count until both have been issued is what makes the window real -
   * both checks reading the same stale number, which is the defect.
   *
   * It stays open afterwards because a serialised second request issues its count only
   * after the first has committed, and a barrier that closed again would wait forever
   * on a count nobody is left to release.
   */
  let opened = false;
  let waiting: Array<() => void> = [];
  const holdCounts = () => new Promise<void>((resolve) => {
    if (opened) {
      resolve();
      return;
    }
    waiting.push(resolve);
  });

  const user = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
    // Must honour the filter: the `assertNotLastSuperAdmin` call uses it
    // are the targets, and returning everything made it exclude both accounts.
    findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) =>
      where?.id?.in ? rows.filter((row) => where.id?.in?.includes(row.id)) : rows),
    count: vi.fn(async ({ where }: { where: Record<string, any> }) => {
      await holdCounts();
      const notIn = where?.id?.notIn ?? [];
      return rows.filter(
        (row) => row.roleId === 'role-s' && row.isActive && !notIn.includes(row.id),
      ).length;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((entry) => entry.id === where.id);
      if (!row) throw new Error('not found');
      // Deliberately blind. A real database does not know what a SuperAdmin is, so it
      // cannot refuse this write - the rule has to live in the service. A mock that
      // enforced it here would make the serialisation test pass whether or not the
      // guard worked, which is a test passing for the wrong reason.
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
      const targets = rows.filter((row) => where.id.in.includes(row.id));
      targets.forEach((row) => Object.assign(row, data));
      return { count: targets.length };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = rows.findIndex((row) => row.id === where.id);
      const [removed] = rows.splice(index, 1);
      return { ...removed };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      const kept = rows.filter((row) => !where.id.in.includes(row.id));
      const count = rows.length - kept.length;
      rows.length = 0;
      rows.push(...kept);
      return { count };
    }),
  };

  return {
    user,
    rows,
    /** Let every held count resolve - the moment both writes become possible. */
    releaseCounts: () => {
      opened = true;
      const pending = waiting;
      waiting = [];
      pending.forEach((resolve) => resolve());
    },
  };
};

const audit = { log: vi.fn().mockResolvedValue(undefined), logItemAction: vi.fn().mockResolvedValue(undefined) };

const adminOne = { id: 'actor-1', userId: 'actor-1', actorUsername: 'one', role: 'SuperAdmin' };
const adminTwo = { id: 'actor-2', userId: 'actor-2', actorUsername: 'two', role: 'SuperAdmin' };

let prisma: ReturnType<typeof makePrisma>;
let service: UsersService;

beforeEach(() => {
  vi.clearAllMocks();
  prisma = makePrisma();
  service = new UsersService(prisma as never);
  (service as unknown as { auditService: { log: ReturnType<typeof vi.fn> } }).auditService = audit;
  vi.spyOn(service as never, 'publish').mockImplementation(() => undefined);
});

const lock = (id: string, actor: typeof adminOne) =>
  (service as unknown as { setLockStatus: (id: string, d: unknown, a: unknown) => Promise<unknown> })
    .setLockStatus(id, { locked: true, reason: 'إجراء إداري' }, actor);

describe('two concurrent locks cannot both pass the last-SuperAdmin check', () => {
  it('refuses one of two simultaneous locks of each other', async () => {
    const oneLocksTwo = lock('actor-2', adminOne);
    const twoLocksOne = lock('actor-1', adminTwo);

    // Both are paused inside their own count. This is the window.
    prisma.releaseCounts();

    const outcomes = await Promise.allSettled([oneLocksTwo, twoLocksOne]);


    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    // And the invariant that matters: one active SuperAdmin is still standing.
    expect(prisma.rows.filter((row) => row.isActive && row.roleId === 'role-s')).toHaveLength(1);
  });

  it('refuses the second one when the first has already committed', async () => {
    // The serialised case: no overlap, so the second count reads committed state and
    // the refusal is a legitimate one rather than a race outcome.
    const first = lock('actor-2', adminOne);
    prisma.releaseCounts();
    await first;
    // The barrier is open now, so the second count reads committed state.
    await expect(lock('actor-1', adminTwo)).rejects.toThrow(ConflictException);
  });

  it('still permits both when a third active SuperAdmin exists', async () => {
    // Serialisation must not have become a blanket prohibition.
    prisma.rows.push({
      id: 'actor-3', roleId: 'role-s', isActive: true, isLocked: false, username: 'three', role: roleSuper, createdOpeningBalances: [],
    });

    const first = lock('actor-2', adminOne);
    prisma.releaseCounts();
    await first;
    await expect(lock('actor-1', adminTwo)).resolves.toBeDefined();
    expect(prisma.rows.filter((row) => row.isActive && row.roleId === 'role-s')).toHaveLength(1);
  });
});
