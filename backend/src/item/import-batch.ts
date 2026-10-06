import { createHash } from 'crypto';
import { normalizeItemRow, describeOverlong, type NormalizedItemRow } from './item-normalize';

/**
 * Decides what an import will do, without touching the database.
 *
 * This module is pure on purpose. It is the shared half of two endpoints that must
 * never disagree:
 *
 *   POST /items/import-excel          — writes the plan
 *   POST /items/import-excel/validate — reports the plan and stops
 *
 * A dry-run that re-implemented the rules would drift from the write path within a
 * release, and a dry-run is only worth having if it is literally the same decision.
 * So the rules live here, once, and the write path is the dry-run plus a commit.
 */

export type ImportMode = 'strict' | 'partial';

export type ImportRowInput = {
  publicId?: string;
  name: string;
  code?: string;
  barcode?: string;
  category?: string;
  unit?: string;
  minLimit?: number;
  maxLimit?: number;
  orderLimit?: number;
  packageWeight?: number;
  englishName?: string;
  description?: string;
  sourceRow?: number;
};

export type ImportRejection = {
  row: number;
  field: string;
  message: string;
  value?: unknown;
};

export type ImportPlanRow = NormalizedItemRow & {
  rowNumber: number;
  /** Set when the client identified an existing item to update rather than create. */
  targetPublicId?: string;
  /**
   * The *archived* item this row's code or barcode already belongs to, if any.
   *
   * A match here is not a conflict. The item is out of the catalogue by decision, so
   * treating its code as taken made a deliberately retired code permanently
   * un-importable — and named a retired item as the holder, which sent the operator
   * looking for a conflict on a screen that filters archived rows out by default. The
   * row is allowed through and this is reported, so the choice between "revive it" and
   * "let it stay retired" belongs to the operator rather than to a rule that cannot
   * tell the two situations apart.
   */
  archivedMatch?: { publicId: string; name: string };
  /**
   * Whether an update to an archived item must clear the flag.
   *
   * Without this the row's changes are written to a row that stays invisible in every
   * filtered list, and the operator's import appears to have done nothing.
   */
  reactivate: boolean;
};

export type ImportPlan = {
  /** Rows to insert, in file order. File order is the order the operator arranged. */
  creates: ImportPlanRow[];
  /** Rows to update in place, keyed by the item's publicId. */
  updates: Array<ImportPlanRow & { targetPublicId: string }>;
  rejections: ImportRejection[];
  /** Every problem, one entry per problem rather than one per row. */
  rejectionCount: number;
  total: number;
};

export type ExistingKey = {
  code: string | null;
  barcode: string | null;
  publicId: string;
  name: string;
  isArchived: boolean;
};

const fold = (value: unknown) => String(value ?? '').trim().toLowerCase();

/**
 * A digest of the rows as submitted, so the same file is recognisable as the same
 * file.
 *
 * Sorted keys, so key order in the JSON cannot change the digest — otherwise a
 * client that serialises its object properties in a different order would produce a
 * different hash for identical content and the duplicate-file check would never
 * fire. Rows keep their order, because re-ordering a spreadsheet is a real change
 * to what the operator asked for.
 */
export const fingerprintImportRows = (items: readonly ImportRowInput[]): string => {
  const canonical = items.map((item) => {
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) {
      const value = (item as Record<string, unknown>)[key];
      if (value === undefined) continue;
      record[key] = typeof value === 'string' ? value.trim() : value;
    }
    return record;
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

/**
 * Classifies every submitted row.
 *
 * The three outcomes are create, update, and reject. Reject carries one entry per
 * problem, so a row missing both a name and a unit produces two entries and the
 * operator fixes both at once.
 *
 * `existing` is whatever the caller read from the catalogue under the lock. It is a
 * parameter rather than a query so that this function stays pure and testable, and
 * so the read happens exactly once inside the transaction that will act on it —
 * reading the catalogue before taking the lock is the race this wave exists to
 * close.
 */
export const buildImportPlan = (
  items: readonly ImportRowInput[],
  existing: readonly ExistingKey[],
  options: { mode: ImportMode },
): ImportPlan => {
  const creates: ImportPlanRow[] = [];
  const updates: Array<ImportPlanRow & { targetPublicId: string }> = [];
  const rejections: ImportRejection[] = [];

  // In-file duplicate counts, folded the same way the unique index folds. Counting
  // before deciding means every colliding row is told it collides, not just the
  // second one — the first looks fine until the second exists.
  const codeCounts = new Map<string, number>();
  const barcodeCounts = new Map<string, number>();
  for (const item of items) {
    const code = fold(item.code);
    const barcode = fold(item.barcode);
    if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
    if (barcode) barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
  }

  // The catalogue is indexed twice: once for what is *live* and once for what is
  // *archived*. They are different situations and the plan has to keep them apart.
  //
  // Before this, one index held both and `isArchived` was read off the row and then
  // ignored. So an archived item's code was a hard conflict exactly like a live one:
  // the row was refused, and refused with a message naming a retired item as the
  // holder. That made a deliberately retired code permanently un-importable, and sent
  // the operator hunting for a conflict on a screen where archived rows are filtered
  // out — so they found nothing, and concluded their file was the problem.
  const liveCodes = new Map<string, ExistingKey>();
  const liveBarcodes = new Map<string, ExistingKey>();
  const archivedCodes = new Map<string, ExistingKey>();
  const archivedBarcodes = new Map<string, ExistingKey>();
  const existingItems = new Map<string, ExistingKey>();
  for (const row of existing) {
    const code = fold(row.code);
    const barcode = fold(row.barcode);
    const codes = row.isArchived ? archivedCodes : liveCodes;
    const barcodes = row.isArchived ? archivedBarcodes : liveBarcodes;
    if (code) codes.set(code, row);
    if (barcode) barcodes.set(barcode, row);
    existingItems.set(row.publicId, row);
  }

  items.forEach((item, index) => {
    // The sheet row the client claimed, so a message points at a line the operator
    // can see. Falls back to a dense index when the claim is absent or unusable: a
    // line that is off by a blank row beats a message with no line at all.
    //
    // Integrality is part of "unusable". `99.5` is finite and above 1, so a naive
    // check accepts it and every message for that row points at a line that does not
    // exist in the sheet. The DTO rejects a fractional `sourceRow` with `@IsInt()`,
    // but this function is also called on rows that have not been through the DTO,
    // and a guard that only exists in one of two paths is not a guard.
    const claimed = Number(item.sourceRow);
    const rowNumber = Number.isInteger(claimed) && claimed >= 1 ? claimed : index + 2;

    const { row, issues, codeKey, barcodeKey, overlong } = normalizeItemRow(item, {
      requireCategory: true,
    });

    const problems: Array<{ field: string; message: string; value?: unknown }> = [...issues];
    for (const field of overlong) {
      problems.push({ field, message: describeOverlong(field), value: row[field as keyof NormalizedItemRow] });
    }
    if (codeKey && (codeCounts.get(codeKey) || 0) > 1) {
      problems.push({ field: 'code', message: 'كود مكرر داخل ملف الاستيراد.', value: row.code });
    }
    if (barcodeKey && (barcodeCounts.get(barcodeKey) || 0) > 1) {
      problems.push({ field: 'barcode', message: 'باركود مكرر داخل ملف الاستيراد.', value: row.barcode });
    }

    // A row the client pointed at an existing item is an update, and its code and
    // barcode are that item's own — refusing it as "already used" would make an
    // update impossible to express, since the item being updated is the thing using
    // the code.
    const targetPublicId = String(item.publicId ?? '').trim();
    const target = targetPublicId ? existingItems.get(targetPublicId) : undefined;
    const isUpdate = Boolean(target);
    // An archived match is reported rather than enforced. It is information the
    // operator needs and it is not a reason to reject the row.
    let archivedMatch: { publicId: string; name: string } | undefined;

    if (isUpdate && target) {
      // Comparing against the target's own keys, not against "a name" — two different
      // items can share a name, and the old comparison-by-name would exempt an update
      // that collided with a *different* item which happened to be called the same
      // thing. The identity that matters is the publicId.
      if (codeKey) {
        const holder = liveCodes.get(codeKey);
        if (holder && holder.publicId !== targetPublicId) {
          problems.push({ field: 'code', message: `الكود مستخدم للصنف الآخر: ${holder.name}`, value: row.code });
        }
      }
      if (barcodeKey) {
        const holder = liveBarcodes.get(barcodeKey);
        if (holder && holder.publicId !== targetPublicId) {
          problems.push({ field: 'barcode', message: `الباركود مستخدم للصنف الآخر: ${holder.name}`, value: row.barcode });
        }
      }
    } else {
      if (codeKey) {
        const holder = liveCodes.get(codeKey);
        if (holder) {
          problems.push({ field: 'code', message: `الكود مستخدم مسبقًا للصنف: ${holder.name}`, value: row.code });
        } else {
          const archivedHolder = archivedCodes.get(codeKey);
          if (archivedHolder) {
            archivedMatch = { publicId: archivedHolder.publicId, name: archivedHolder.name };
          }
        }
      }
      if (barcodeKey) {
        const holder = liveBarcodes.get(barcodeKey);
        if (holder) {
          problems.push({ field: 'barcode', message: `الباركود مستخدم مسبقًا للصنف: ${holder.name}`, value: row.barcode });
        } else {
          const archivedHolder = archivedBarcodes.get(barcodeKey);
          if (archivedHolder && !archivedMatch) {
            archivedMatch = { publicId: archivedHolder.publicId, name: archivedHolder.name };
          }
        }
      }
    }

    if (problems.length > 0) {
      for (const problem of problems) {
        rejections.push({
          row: rowNumber,
          field: problem.field,
          message: problem.message,
          value: problem.value,
        });
      }
      return;
    }

    if (isUpdate && target) {
      updates.push({
        ...row,
        rowNumber,
        targetPublicId,
        archivedMatch,
        // An update to an archived row has to clear the flag. Otherwise the changes
        // are written to something that stays invisible in every filtered list and the
        // operator's import looks like it did nothing.
        reactivate: target.isArchived,
      });
    } else {
      creates.push({ ...row, rowNumber, archivedMatch, reactivate: false });
    }
  });

  // `strict` is opt-in and the default stays `partial`.
  //
  // Flipping the default would be the more defensible choice for a catalogue load,
  // and it is deliberately not done here. The existing contract is that a file with
  // one bad row among two hundred still lands the two hundred, the studio reports
  // the one, and the response is 201. An operator re-running the import after fixing
  // that row depends on it. A default change is a product decision, so the safer
  // mode is offered and the old behaviour is what happens unless asked otherwise.
  if (options.mode === 'strict' && rejections.length > 0) {
    return { creates: [], updates: [], rejections, rejectionCount: rejections.length, total: items.length };
  }

  return {
    creates,
    updates,
    rejections,
    rejectionCount: rejections.length,
    total: items.length,
  };
};

export const describeImportMode = (mode: ImportMode): string =>
  mode === 'strict'
    ? 'صارم: لا يُستورد أي صف إذا رفض أي صف في الملف.'
    : 'جزئي: تُستورد الصفوف الصحيحة ويُبلَّغ عن الباقية.';
