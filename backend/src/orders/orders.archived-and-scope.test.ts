import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

/**
 * Two things this module got wrong, both found by driving it rather than reading it.
 *
 * **An order could be edited from outside its warehouse.** `remove` checked the scope and
 * `update` did not. Measured: a session holding only `sales.update.orders` cancelled an
 * order in a warehouse it is not scoped to, and the same session was refused when it
 * tried to delete that order — one controller, two answers, the difference being the verb.
 * Editing is the softer of the two, which is exactly why it needed the check: a cancelled
 * sale does not look like a deletion, it looks like a status somebody has to notice.
 *
 * **An order line could name a retired item.** The same missing rule the movement and
 * stocktaking paths had, which is why it now lives in `../common/item-guard`.
 */
const prisma = {
  item: { findMany: vi.fn() },
  order: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  partner: { findUnique: vi.fn() },
  // `executeIdempotently` opens the transaction before the guard runs, so the mock has to
  // offer one. Handing the work straight through keeps these tests about the guard: what is
  // asserted is which error escapes, not how the idempotency record is written.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  // `executeIdempotently` writes the record after the work succeeds, so the mock needs
  // `create` as well as `findUnique`.
  idempotencyRecord: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'idem-1' }),
    update: vi.fn(),
  },
};

// A real time service, because `mapOrder` formats the date on the way out and this test is
// asserting that the update *reached* the write rather than being refused by the guard.
const timeService = {
  getBusinessDateKey: (value: unknown) => String(value),
  parseDate: (value: unknown) => new Date(String(value)),
};

// After the transaction, `update` announces the change and writes an audit row. Both are
// part of "the write happened"; stubbing them keeps the assertion on the guard.
const realtimeService = { emitSync: vi.fn() };
const auditService = { logItemAction: vi.fn().mockResolvedValue(undefined) };

const service = new OrdersService(
  prisma as never,
  auditService as never,
  realtimeService as never,
  timeService as never,
);

const call = <T>(name: string, ...args: unknown[]): Promise<T> =>
  (service as unknown as Record<string, (...a: unknown[]) => Promise<T>>)[name](...args);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.item.findMany.mockResolvedValue([]);
});

describe('an order line refuses an archived item', () => {
  it('refuses a batch containing one, and names it', async () => {
    prisma.item.findMany.mockResolvedValue([
      { id: 1, publicId: 'ok-1', unit: 'kg', name: 'سليم', isArchived: false },
      { id: 2, publicId: 'arch-2', unit: 'kg', name: 'معزول', isArchived: true },
    ]);

    await expect(call('resolveItems', ['ok-1', 'arch-2'])).rejects.toThrow(/معزول/);
  });

  it('lets a wholly active batch through', async () => {
    prisma.item.findMany.mockResolvedValue([
      { id: 1, publicId: 'ok-1', unit: 'kg', name: 'سليم', isArchived: false },
    ]);
    const map = await call<Map<string, { id: number }>>('resolveItems', ['ok-1']);
    expect(map.get('ok-1')).toEqual({ id: 1, unit: 'kg' });
  });

  it('still distinguishes a missing item from an archived one', async () => {
    prisma.item.findMany.mockResolvedValue([]);
    await expect(call('resolveItems', ['nope'])).rejects.toThrow(/Item not found/);
  });
});

describe('editing an order is scoped like deleting one', () => {
  // The idempotency helper owns the transaction; these assertions are about the guard that
  // runs inside it, so the mocked client only needs the two calls the guard makes.
  beforeEach(() => {
    (service as unknown as { transactionService: unknown });
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', warehouseId: 'other-warehouse' });
  });

  it('refuses an update from outside the warehouse', async () => {
    await expect(call('update', 'o1', { status: 'cancelled' }, 'u1', 'user', 'key-12345678', 'default'))
      .rejects.toThrow(/outside the permitted warehouse scope/);
  });

  it('allows an administrator whose scope is all', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', warehouseId: 'other-warehouse' });
    prisma.order.update.mockResolvedValue({
      id: 'o1', orderNumber: 'n', type: 'sale', partnerId: 'p', date: new Date(), status: 'cancelled',
      totalAmount: null, notes: null, warehouseId: 'other-warehouse', items: [],
    });
    // Reaches the update rather than the guard: proved by the absence of a scope refusal.
    await expect(call('update', 'o1', { status: 'cancelled' }, 'u1', 'user', 'key-12345678', 'all'))
      .resolves.toBeDefined();
  });

  it('refuses a completion from outside the warehouse', async () => {
    prisma.order.findUnique.mockResolvedValue({ status: 'pending', warehouseId: 'other-warehouse' });
    await expect(call('complete', 'o1', 'default', 'u1', 'user', 'key-12345678'))
      .rejects.toThrow(/outside the permitted warehouse scope/);
  });
});