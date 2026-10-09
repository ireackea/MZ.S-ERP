import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferenceDataService } from './reference-data.service';

/**
 * This module had no backend test at all, which is how two things survived in it.
 *
 * **The panel counted usage from the loaded catalogue.** `state.items` is capped at
 * 1000 rows, so past a thousand active items a category referenced only by items
 * beyond the cap reported "not currently in use", its Delete button was enabled,
 * and the banner agreed with the button. Gate 4.4 counts from the database instead;
 * the grouping tests below are the ones that would have caught the original.
 *
 * **Uniqueness was enforced twice, in JavaScript, and the database agreed anyway.**
 * `ensureValueIsNew` scans and compares before inserting, which is a check that two
 * concurrent requests can both pass. What actually closes the race is the unique
 * index on `(kind, lower(value))` — and it is invisible to the datamodel, which is
 * how the migration that would have dropped it got queued. These tests pin the
 * JavaScript half; the index half is verified by the schema, not by a mock.
 */
const prisma = {
  referenceDataValue: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
};

const realtimeService = { emitSync: vi.fn() };
const auditService = { logItemAction: vi.fn().mockResolvedValue(undefined) };

const service = new ReferenceDataService(
  prisma as never,
  realtimeService as never,
  auditService as never,
);

const actor = { userId: 'user-1', actorUsername: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing declared, nothing used. Each test states only the rows it cares
  // about, so a test cannot pass because an earlier one left state behind.
  prisma.referenceDataValue.findMany.mockResolvedValue([]);
  prisma.item.findMany.mockResolvedValue([]);
  prisma.item.groupBy.mockResolvedValue([]);
  prisma.referenceDataValue.deleteMany.mockResolvedValue({ count: 0 });
});

describe('values are normalised before anything compares them', () => {
  it('collapses runs of whitespace and trims, so "  كجم   نظيف " is one value', async () => {
    prisma.referenceDataValue.create.mockImplementation(async ({ data }: { data: { value: string } }) => ({
      id: 'r1',
      ...data,
    }));

    await service.createValue('unit', { value: '  كجم   نظيف ' } as never, actor);

    expect(prisma.referenceDataValue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: 'كجم نظيف' }) }),
    );
  });

  it('treats a letter-case variant as the same value', async () => {
    prisma.referenceDataValue.findMany.mockResolvedValue([{ id: 'r1', value: 'Kg' }]);

    await expect(service.createValue('unit', { value: 'kG' } as never, actor))
      .rejects.toThrow(/موجود بالفعل/);
    expect(prisma.referenceDataValue.create).not.toHaveBeenCalled();
  });

  it('refuses a value the catalogue already uses, even when nothing declared it', async () => {
    // The case that made the union in findAll() necessary: "مواد أولية" is in use on
    // items and was never declared. Declaring it now must not produce a second entry.
    prisma.item.findMany.mockResolvedValue([{ category: 'مواد أولية', unit: 'كجم' }]);

    await expect(service.createValue('category', { value: 'مواد أولية' } as never, actor))
      .rejects.toThrow(/موجود بالفعل ضمن الأصناف/);
    expect(prisma.referenceDataValue.create).not.toHaveBeenCalled();
  });

  it('refuses an empty value and one past the column limit', async () => {
    await expect(service.createValue('category', { value: '   ' } as never, actor))
      .rejects.toThrow(/مطلوب/);
    await expect(service.createValue('category', { value: 'x'.repeat(121) } as never, actor))
      .rejects.toThrow(/120/);
  });
});

describe('deleting a value is refused while items reference it', () => {
  it('names the count instead of a bare rejection', async () => {
    prisma.item.findMany.mockResolvedValue([
      { category: 'أكياس', unit: 'كيس' },
      { category: 'أكياس', unit: 'كيس' },
      { category: 'أكياس', unit: 'كيس' },
    ]);

    await expect(service.deleteValue('category', 'أكياس', actor))
      .rejects.toThrow(/3/);
    expect(prisma.referenceDataValue.deleteMany).not.toHaveBeenCalled();
  });

  it('matches usage on the normalised key, so odd spacing does not open a hole', async () => {
    prisma.item.findMany.mockResolvedValue([{ category: '  أكياس  ', unit: 'كيس' }]);

    await expect(service.deleteValue('category', 'أكياس', actor))
      .rejects.toThrow(/لا يمكن حذف/);
  });

  it('removes every row that normalises to the same value, and audits once', async () => {
    prisma.referenceDataValue.findMany.mockResolvedValue([
      { id: 'r1', value: 'كجم' },
      { id: 'r2', value: 'كجم ' },
    ]);
    prisma.referenceDataValue.deleteMany.mockResolvedValue({ count: 2 });

    await service.deleteValue('unit', 'كجم', actor);

    expect(prisma.referenceDataValue.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] } },
    });
    expect(auditService.logItemAction).toHaveBeenCalledTimes(1);
    expect(realtimeService.emitSync).toHaveBeenCalledTimes(1);
  });

  it('reports a value that was never declared', async () => {
    prisma.referenceDataValue.findMany.mockResolvedValue([]);
    await expect(service.deleteValue('unit', 'طن', actor)).rejects.toThrow(/غير موجود/);
  });
});

describe('usage counts come from the database, grouped, not from a page of items', () => {
  it('merges case and whitespace variants into one number', async () => {
    // The panel used to build this map itself from a truncated page, which is how a
    // referenced value could read as unused. Three rows, one displayed figure.
    prisma.item.groupBy.mockImplementation(async ({ by }: { by: string[] }) => {
      const field = by[0];
      const rows = field === 'category'
        ? [{ category: 'كيس', _count: { _all: 2 } }, { category: 'كيس ', _count: { _all: 3 } }]
        : [{ unit: 'كجم', _count: { _all: 7 } }];
      return rows;
    });

    const counts = await service.getUsageCounts();

    expect(counts.categories['كيس']).toBe(5);
    expect(counts.units['كجم']).toBe(7);
  });

  it('does not read the items table to answer it', async () => {
    await service.getUsageCounts();
    expect(prisma.item.findMany).not.toHaveBeenCalled();
    expect(prisma.item.groupBy).toHaveBeenCalledTimes(2);
  });

  it('excludes archived items, matching what the delete guard protects', async () => {
    await service.getUsageCounts();
    // Nested `objectContaining` because the query also excludes a null column; the
    // assertion is about the archive filter, not about the whole clause.
    for (const call of prisma.item.groupBy.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        where: expect.objectContaining({ isArchived: false }),
      }));
    }
  });

  it('drops a blank value rather than reporting it under an empty key', async () => {
    // `unit` is nullable, so a real groupBy returns a null group. Prisma 7 will not
    // accept `{ not: null }` to remove it, so the map has to be the thing that drops
    // it — otherwise a null unit is announced to the panel as a value called "".
    prisma.item.groupBy.mockResolvedValue([
      { category: '', _count: { _all: 4 } },
      { unit: null, _count: { _all: 2 } },
    ]);

    const counts = await service.getUsageCounts();

    expect(counts.categories).toEqual({});
    expect(counts.units).toEqual({});
  });
});