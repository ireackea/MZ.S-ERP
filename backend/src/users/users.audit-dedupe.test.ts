import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

/**
 * Every user mutation wrote the same event twice.
 *
 * `writeAudit` writes a row with `targetResource: 'users.audit'` and a legacy action
 * name ('create', 'invite', 'role_permissions_update'…), and immediately after it
 * `auditService.log` writes another with `targetResource: 'users'` and the canonical
 * name ('USER_UPDATE', 'INVITATION_SENT'…). Nine pairs of them.
 *
 * The screen reads `auditService.queryLogs({ targetUserId })` and maps the action
 * through `mapAuditActionToUserAction`, which understands the canonical names and
 * returns null for the legacy ones. So for most events exactly one of the two rows is
 * even visible; for the three where a legacy name is also mapped, both are, and the
 * trail double-counts. Either way the table carries a row per event that no reader
 * will ever consume.
 *
 * The fix is to stop writing the unreadable one, not to teach the reader about it:
 * `writeAudit`'s rows are a smaller, differently-named copy of what
 * `auditService.log` already records with the actor's role, the status and the
 * metadata. The query filters on `targetUserId`, not `targetResource`, so nothing
 * downstream keys on the rows being removed.
 */
const prisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    // `assertNotLastSuperAdmin` reads the targets' roles through this, and honouring
    // the filter matters: returning every row made the race test exclude both
    // accounts and refuse everything.
    findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[] } } }) =>
      where?.id?.in ? [] : []),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  role: { findUnique: vi.fn(), findMany: vi.fn() },
  activeSession: { updateMany: vi.fn() },
  invitation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};

const audit = { log: vi.fn().mockResolvedValue(undefined), logItemAction: vi.fn().mockResolvedValue(undefined) };

const actor = { id: 'actor-1', userId: 'actor-1', actorUsername: 'admin', role: 'Admin' };
const target = {
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
  passwordHash: 'hash',
  passwordSetByUser: true,
};

const rowsWritten = () => audit.log.mock.calls.map(([entry]: [{ action: string; targetResource: string }]) => entry);

let service: UsersService;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(target);
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'Viewer', permissions: [] });
  prisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'Viewer', permissions: [] }]);
  prisma.user.count.mockResolvedValue(1);
  prisma.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
    ...target,
    ...(data as Record<string, unknown>),
    id: where.id,
  }));
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.activeSession.updateMany.mockResolvedValue({ count: 1 });

  service = new UsersService(prisma as never);
  (service as unknown as { auditService: { log: ReturnType<typeof vi.fn> } }).auditService = audit;
  vi.spyOn(service as never, 'publish').mockImplementation(() => undefined);
});

describe('one event, one audit row', () => {
  it('writes a single row when a user is updated', async () => {
    await (service as unknown as { updateUser: (id: string, d: unknown, a: unknown) => Promise<unknown> })
      .updateUser('target-1', { email: 'a@b.c' }, actor);

    const rows = rowsWritten();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('USER_UPDATE');
    // The legacy row, which no reader consumes, is the one that must be gone.
    expect(rows.every((row: { targetResource: string }) => row.targetResource !== 'users.audit')).toBe(true);
  });

  it('writes a single row when an account is locked', async () => {
    await (service as unknown as { setLockStatus: (id: string, d: unknown, a: unknown) => Promise<unknown> })
      .setLockStatus('target-1', { locked: true, reason: 'x' }, actor);

    const rows = rowsWritten();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('USER_LOCK');
  });

  it('writes a single row when a role is reassigned in bulk', async () => {
    prisma.user.count.mockResolvedValue(1);

    await (service as unknown as { bulkAssignRole: (d: unknown, a: unknown) => Promise<unknown> })
      .bulkAssignRole({ roleId: 'role-1', userIds: ['target-1'] }, actor);

    const rows = rowsWritten();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('BULK_ASSIGN_ROLE');
  });
});
