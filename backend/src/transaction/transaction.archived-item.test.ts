import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionService } from './transaction.service';

/**
 * The transaction module shipped 1638 lines with no test file at all, and the gap below
 * is what that bought: `isArchived` was honoured by `item.service`, `formulation` and
 * `import-batch`, and not by the one path that writes the movement.
 *
 * Measured before the fix: a movement was recorded against an item with
 * `isArchived = true` (transaction id 835, verified in the database). The item list hides
 * such items, so the screen looked correct — the stock did not.
 *
 * These call the two resolvers directly rather than going through `createOne`. They are
 * the single funnel every create and update path uses, so a rule asserted here is a rule
 * that cannot be bypassed by finding another caller — which is how the unloading-rule
 * rule (gate 4.2) is tested, and the reason that one holds.
 */
const prisma = {
  item: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

const service = new TransactionService(
  prisma as never,
  {} as never,
  {} as never,
  {} as never,
);

// The resolvers are private because callers should not depend on them; a test that needs
// them reaches them the way the code does not, deliberately.
const resolveItemId = (identifier: string) =>
  (service as unknown as { resolveItemId: (id: string) => Promise<number> }).resolveItemId(identifier);
const resolveItemIdMap = (identifiers: Array<string>) =>
  (service as unknown as { resolveItemIdMap: (ids: string[]) => Promise<Map<string, number>> })
    .resolveItemIdMap(identifiers);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an archived item cannot receive a movement', () => {
  it('refuses a single-item create and names the item', async () => {
    prisma.item.findFirst.mockResolvedValue({ id: 7, isArchived: true, name: 'صنف معزول' });

    await expect(resolveItemId('zz-7')).rejects.toThrow(/archived/);
    // The name is in the message because the alternative is "archived" with no subject,
    // and the operator is holding 200 rows in a bulk import.
    await expect(resolveItemId('zz-7')).rejects.toThrow(/صنف معزول/);
  });

  it('resolves an active item as before', async () => {
    prisma.item.findFirst.mockResolvedValue({ id: 7, isArchived: false, name: 'صنف نشط' });
    await expect(resolveItemId('zz-7')).resolves.toBe(7);
  });

  it('still distinguishes "no such item" from "archived"', async () => {
    prisma.item.findFirst.mockResolvedValue(null);
    await expect(resolveItemId('nope')).rejects.toThrow(/Item not found/);
  });

  it('refuses a bulk import that contains an archived item', async () => {
    prisma.item.findMany.mockResolvedValue([
      { id: 1, publicId: 'ok-1', isArchived: false, name: 'سليم' },
      { id: 2, publicId: 'arch-2', isArchived: true, name: 'مؤرشف' },
    ]);

    await expect(resolveItemIdMap(['ok-1', 'arch-2'])).rejects.toThrow(/مؤرشف/);
  });

  it('names an archived item by its numeric id too, not only by publicId', async () => {
    // Both identifiers resolve to the same row, so refusing only the publicId spelling
    // leaves the door open through the other one.
    prisma.item.findMany.mockResolvedValue([
      { id: 2, publicId: 'arch-2', isArchived: true, name: 'مؤرشف' },
    ]);

    await expect(resolveItemIdMap(['2'])).rejects.toThrow(/مؤرشف/);
  });

  it('lets a whole active batch through', async () => {
    prisma.item.findMany.mockResolvedValue([
      { id: 1, publicId: 'ok-1', isArchived: false, name: 'سليم' },
      { id: 3, publicId: 'ok-3', isArchived: false, name: 'سليم٢' },
    ]);

    const map = await resolveItemIdMap(['ok-1', 'ok-3']);
    expect(map.get('ok-1')).toBe(1);
    expect(map.get('ok-3')).toBe(3);
  });
});