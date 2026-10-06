import { describe, it, expect } from 'vitest';
import {
  buildImportPlan,
  fingerprintImportRows,
  describeImportMode,
  type ExistingKey,
  type ImportRowInput,
} from './import-batch';

/**
 * The plan is the whole decision. If these are right, the write path is a commit of
 * what they describe — and if they are wrong, no transaction can rescue it, because a
 * transaction only makes the wrong thing durable faster.
 *
 * Written as pure tests with no database, which is the point of `import-batch.ts`
 * being pure. The behaviour being pinned here used to be reachable only by
 * importing against the live catalogue.
 */

const row = (over: Partial<ImportRowInput> = {}): ImportRowInput => ({
  name: 'صنف',
  category: 'عام',
  unit: 'kg',
  ...over,
});

const existing = (...rows: Partial<ExistingKey>[]): ExistingKey[] =>
  rows.map((entry) => ({
    publicId: 'item-1',
    code: null,
    barcode: null,
    name: 'موجود',
    isArchived: false,
    ...entry,
  }));

describe('buildImportPlan — creates', () => {
  it('keeps a valid row', () => {
    const plan = buildImportPlan([row({ name: 'سكر' })], [], { mode: 'partial' });
    expect(plan.creates).toHaveLength(1);
    expect(plan.rejections).toHaveLength(0);
    expect(plan.creates[0].name).toBe('سكر');
  });

  it('keeps rows in file order, because the file order is the order the operator arranged', () => {
    const plan = buildImportPlan(
      [row({ name: 'أ' }), row({ name: 'ب' }), row({ name: 'ج' })],
      [],
      { mode: 'partial' },
    );
    expect(plan.creates.map((entry) => entry.name)).toEqual(['أ', 'ب', 'ج']);
  });

  it('carries the normalised values, not the raw input', () => {
    const plan = buildImportPlan([row({ name: '  سكر  ', minLimit: 5 })], [], { mode: 'partial' });
    expect(plan.creates[0].name).toBe('سكر');
    expect(plan.creates[0].minLimit).toBe(5);
  });
});

describe('buildImportPlan — rejections', () => {
  it('reports every problem with a row, not the first', () => {
    // No name and no unit. The old loop had seven `continue`s in a row and reported
    // one problem per row, so this produced a single message about the name and the
    // operator met the missing unit on the second round trip.
    const plan = buildImportPlan(
      [{ name: '', category: 'عام', unit: '' } as unknown as ImportRowInput],
      [],
      { mode: 'partial' },
    );
    const fields = plan.rejections.map((entry) => entry.field);
    expect(fields).toContain('name');
    expect(fields).toContain('unit');
    expect(plan.rejections.length).toBeGreaterThanOrEqual(2);
  });

  it('counts a row once per problem, not once per row', () => {
    const plan = buildImportPlan(
      [
        { name: '', category: 'عام', unit: 'kg' } as unknown as ImportRowInput,
        { name: 'سليم', category: 'عام', unit: 'kg' },
      ],
      [],
      { mode: 'partial' },
    );
    expect(plan.rejectionCount).toBeGreaterThanOrEqual(1);
    expect(plan.creates).toHaveLength(1);
  });

  it('uses the sheet row the client claimed', () => {
    const plan = buildImportPlan([row({ sourceRow: 17 })], [], { mode: 'partial' });
    expect(plan.creates[0].rowNumber).toBe(17);
  });

  it('falls back to a dense index when the claimed row is unusable', () => {
    const plan = buildImportPlan(
      [row({ sourceRow: -4 }), row({ sourceRow: 99.5 })],
      [],
      { mode: 'partial' },
    );
    expect(plan.creates.map((entry) => entry.rowNumber)).toEqual([2, 3]);
  });
});

describe('buildImportPlan — in-file duplicates', () => {
  it('tells every colliding row it collides, not only the second', () => {
    // The first row looks fine until the second one exists. Reporting only the
    // second is how a spreadsheet gets fixed and re-imported and fixed again.
    const plan = buildImportPlan(
      [row({ code: 'ABC' }), row({ code: 'abc' })],
      [],
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.rejections.filter((entry) => entry.field === 'code')).toHaveLength(2);
  });

  it('folds case and padding, the way the unique index folds', () => {
    const plan = buildImportPlan(
      [row({ code: '  ABC ' }), row({ code: 'abc' })],
      [],
      { mode: 'partial' },
    );
    expect(plan.rejections.filter((entry) => entry.field === 'code')).toHaveLength(2);
  });

  it('ignores a duplicate among rows that are absent', () => {
    const plan = buildImportPlan(
      [row({ name: 'أ', code: 'A1' }), row({ name: 'ب', code: 'B2' })],
      [],
      { mode: 'partial' },
    );
    expect(plan.rejections).toHaveLength(0);
  });
});

describe('buildImportPlan — codes already in the catalogue', () => {
  it('refuses a code that another item holds', () => {
    const plan = buildImportPlan(
      [row({ code: 'taken' })],
      existing({ publicId: 'item-9', code: 'TAKEN', name: 'موجود' }),
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.rejections[0].message).toContain('موجود');
  });

  it('refuses a barcode that another item holds', () => {
    const plan = buildImportPlan(
      [row({ barcode: '111' })],
      existing({ publicId: 'item-9', barcode: '111', name: 'موجود' }),
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.rejections[0].field).toBe('barcode');
  });

  it('lets a row through when it carries no code at all', () => {
    const plan = buildImportPlan(
      [row({ name: 'بلا كود' })],
      existing({ publicId: 'item-9', code: 'TAKEN' }),
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(1);
  });
});

/**
 * An archived item is not a live conflict.
 *
 * The pre-check read `isArchived` and then ignored it, so an archived item's code was
 * treated exactly like a live one: the row was refused with "الكود مستخدم مسبقًا
 * للصنف: X", naming a retired item as though it were in the catalogue. Two consequences
 * followed from that one omission, and both are real:
 *
 *   A code that had been deliberately retired became permanently un-importable. There
 *   is no way to bring that item back through the import, and no way to reuse the code
 *   either — the operator is told it is taken, by something that is not there.
 *
 *   The message was actively wrong. "Used by another item" invites the operator to go
 *   and look for a conflict that does not exist, in a screen where archived items are
 *   filtered out by default, so they find nothing and conclude the file is bad.
 *
 * So an archived match is reported *as* an archived match, the row is allowed through,
 * and the studio offers reactivate-or-create. The decision is the operator's; the
 * server's job is to tell the truth about which of the two it found.
 */
describe('buildImportPlan — an archived item does not block the import', () => {
  const archived = existing({ publicId: 'item-old', code: 'RETIRED', name: 'صنف مؤرشف', isArchived: true });

  it('lets a row whose code belongs to an archived item through', () => {
    const plan = buildImportPlan([row({ code: 'retired' })], archived, { mode: 'partial' });
    expect(plan.creates, 'archiving must not make a code permanently un-importable').toHaveLength(1);
    expect(plan.rejections).toHaveLength(0);
  });

  it('still lets an archived barcode through', () => {
    const plan = buildImportPlan(
      [row({ barcode: '999' })],
      existing({ publicId: 'item-old', barcode: '999', name: 'صنف مؤرشف', isArchived: true }),
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(1);
  });

  it('reports the archived match so the operator can choose to revive it', () => {
    const plan = buildImportPlan([row({ code: 'retired' })], archived, { mode: 'partial' });
    expect(
      plan.creates[0].archivedMatch?.publicId,
      'the row must carry the id of the archived item, or reviving it is impossible',
    ).toBe('item-old');
    expect(plan.creates[0].archivedMatch?.name).toBe('صنف مؤرشف');
  });

  it('does not attach an archived match when the code is free', () => {
    const plan = buildImportPlan([row({ code: 'brand-new' })], archived, { mode: 'partial' });
    expect(plan.creates[0].archivedMatch).toBeUndefined();
  });

  it('a live item still blocks, even when an archived one shares nothing', () => {
    const plan = buildImportPlan(
      [row({ code: 'live' })],
      [...archived, ...existing({ publicId: 'item-now', code: 'LIVE', name: 'حيّ' })],
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.rejections[0].message).toContain('حيّ');
  });

  it('revives the archived item when the row points at it', () => {
    // The row carries the archived item's publicId, so it is an update — and an update
    // to an archived item has to clear the flag, or the operator's file lands and the
    // item stays invisible in every list that filters archived rows.
    const plan = buildImportPlan(
      [row({ publicId: 'item-old', code: 'RETIRED', name: 'عاد' })],
      archived,
      { mode: 'partial' },
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetPublicId).toBe('item-old');
    expect(
      plan.updates[0].reactivate,
      'an update to an archived item must clear the flag, or the change is invisible',
    ).toBe(true);
  });

  it('does not demand revival for a live item', () => {
    const plan = buildImportPlan(
      [row({ publicId: 'item-now', code: 'LIVE' })],
      existing({ publicId: 'item-now', code: 'LIVE', name: 'حيّ' }),
      { mode: 'partial' },
    );
    expect(plan.updates[0].reactivate).toBe(false);
  });
});

describe('buildImportPlan — updates', () => {
  it('updates the item the client named, rather than creating a second one', () => {
    const plan = buildImportPlan(
      [row({ publicId: 'item-9', name: 'الاسم الجديد', code: 'TAKEN' })],
      existing({ publicId: 'item-9', code: 'TAKEN', name: 'القديم' }),
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].targetPublicId).toBe('item-9');
    expect(plan.updates[0].name).toBe('الاسم الجديد');
  });

  it('lets an updated row keep its own code, which is the point of an update', () => {
    // The item being updated is the thing using the code. Refusing it as "already
    // used" would make an update impossible to express.
    const plan = buildImportPlan(
      [row({ publicId: 'item-9', code: 'TAKEN' })],
      existing({ publicId: 'item-9', code: 'TAKEN', name: 'القديم' }),
      { mode: 'partial' },
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.rejections).toHaveLength(0);
  });

  it('refuses a code held by a different item, even on an update', () => {
    const plan = buildImportPlan(
      [row({ publicId: 'item-9', code: 'OTHER' })],
      [
        ...existing({ publicId: 'item-9', code: 'MINE', name: 'القديم' }),
        ...existing({ publicId: 'item-8', code: 'OTHER', name: 'غيري' }),
      ],
      { mode: 'partial' },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.rejections[0].message).toContain('غيري');
  });

  it('creates rather than updates when the named item is not in the catalogue', () => {
    // A stale id must not become a silent insert, which is the duplicate this path
    // exists to prevent.
    const plan = buildImportPlan(
      [row({ publicId: 'item-gone', name: 'جديد' })],
      existing({ publicId: 'item-9' }),
      { mode: 'partial' },
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(1);
  });
});

describe('buildImportPlan — modes', () => {
  it('partial imports the good rows and reports the rest', () => {
    const plan = buildImportPlan(
      [row({ name: 'سليم' }), { name: '', category: 'عام', unit: 'kg' } as unknown as ImportRowInput],
      [],
      { mode: 'partial' },
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.rejectionCount).toBeGreaterThan(0);
  });

  it('strict imports nothing at all if one row is refused', () => {
    const plan = buildImportPlan(
      [row({ name: 'سليم' }), { name: '', category: 'عام', unit: 'kg' } as unknown as ImportRowInput],
      [],
      { mode: 'strict' },
    );
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    // The refusals are still reported. A strict refusal that does not say which rows
    // is a wall rather than an answer.
    expect(plan.rejections.length).toBeGreaterThan(0);
  });

  it('strict behaves like partial when everything is valid', () => {
    const plan = buildImportPlan([row({ name: 'سليم' })], [], { mode: 'strict' });
    expect(plan.creates).toHaveLength(1);
    expect(plan.rejections).toHaveLength(0);
  });

  it('describes both modes', () => {
    expect(describeImportMode('strict')).toContain('لا يُستورد');
    expect(describeImportMode('partial')).toContain('تُستورد');
  });
});

describe('fingerprintImportRows', () => {
  it('is stable across key order, because key order is not a change in content', () => {
    const a = fingerprintImportRows([{ name: 'س', unit: 'kg', code: 'A' } as ImportRowInput]);
    const b = fingerprintImportRows([{ code: 'A', name: 'س', unit: 'kg' } as ImportRowInput]);
    expect(a).toBe(b);
  });

  it('ignores surrounding whitespace, which a spreadsheet adds silently', () => {
    const a = fingerprintImportRows([row({ name: 'سكر' })]);
    const b = fingerprintImportRows([row({ name: '  سكر ' })]);
    expect(a).toBe(b);
  });

  it('changes when the content changes', () => {
    const a = fingerprintImportRows([row({ name: 'سكر' })]);
    const b = fingerprintImportRows([row({ name: 'ملح' })]);
    expect(a).not.toBe(b);
  });

  it('changes when the row order changes, because re-ordering is a real change', () => {
    const a = fingerprintImportRows([row({ name: 'أ' }), row({ name: 'ب' })]);
    const b = fingerprintImportRows([row({ name: 'ب' }), row({ name: 'أ' })]);
    expect(a).not.toBe(b);
  });

  it('ignores an undefined field rather than folding it into the digest', () => {
    const a = fingerprintImportRows([row({ name: 'سكر' })]);
    const b = fingerprintImportRows([{ ...row({ name: 'سكر' }), sourceRow: undefined } as ImportRowInput]);
    expect(a).toBe(b);
  });
});
