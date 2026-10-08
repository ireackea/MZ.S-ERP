import { BadRequestException } from '@nestjs/common';

/**
 * The one rule about archived items, shared by the three modules that resolve an item for
 * a write.
 *
 * `isArchived` is honoured by `item.service` (hidden from lists), `formulation` and
 * `import-batch`. It was honoured by none of the three paths that *write* against an item:
 * movements, stocktaking counts and order lines. Measured on the movements path before the
 * fix — a movement was recorded against an item with `isArchived = true`, read out of the
 * database as transaction 835 — so a retired item kept accumulating stock, which then fed
 * balances, deficits and every report downstream.
 *
 * Three modules each re-implementing "refuse archived" is how the first two drifted in the
 * first place, so the rule lives here once. It takes the row the caller already selected,
 * because all three resolvers need `id` and `unit` anyway and an extra query per resolve
 * would be paid on every line of every import.
 *
 * The refusal names the item. "Archived" without a subject leaves an operator holding 200
 * rows in a bulk import working out which one it was.
 */
export const assertItemIsNotArchived = (
  item: { isArchived?: boolean | null; name?: string | null; publicId?: string | null },
  identifier?: string,
): void => {
  if (!item?.isArchived) return;
  const label = item.name || item.publicId || identifier || String(item.isArchived);
  throw new BadRequestException(
    `Item "${label}" is archived and cannot be used in a new operation. `
    + 'Restore it first if it is back in use.',
  );
};