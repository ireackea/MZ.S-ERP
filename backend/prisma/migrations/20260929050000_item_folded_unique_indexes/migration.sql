-- Makes duplicate codes and barcodes impossible regardless of case or padding.
--
-- `bulkImportFromExcel` folded its lookup keys with trim + toLowerCase and then
-- queried `{ code: { in: uniqueCodes } }`, which is an exact comparison. A stored
-- 'ABC' was therefore invisible to a check looking for 'abc', and `Item_code_key`
-- is a case-sensitive b-tree unique index, so `P2002` did not fire either. The
-- catalogue ended up with two items whose codes differed only by case and
-- nothing said so — not the studio, not the server, not the database.
--
-- Read first, then decided: `scripts/audit/item-import-duplicate-probe.mjs` runs
-- in a read-only transaction and reported zero conflicts on the current data, so
-- this migration is a pure constraint and rewrites nothing. It must be re-run
-- before the index is ever created anywhere else; a conflict means an operator
-- decides, because each side may already have movements or balances.
--
-- The expression is `lower(btrim(...))` rather than `lower(...)` so that "AB "
-- and "AB" are the same code. It has to be written identically wherever the
-- catalogue is queried for duplicates, or the index will not be used and the
-- pre-check will disagree with the constraint.
--
-- Idempotent, and partial so that NULL and empty are not a shared value: a
-- codeless item is legal, and there are many of them. That is a separate defect
-- from this one — the import de-duplicates only on code and barcode — and a
-- partial unique index is what lets this migration be strict about the codes
-- that exist without failing on the ones that do not.
--
-- Mirrors `reference_data_values_kind_value_lower_key` (20260506120000) for the
-- same reason, and `ItemOrderProfile_one_active` (20260928120000) for the same
-- shape: the index is the guarantee, not application code that happens to check.

CREATE UNIQUE INDEX IF NOT EXISTS "Item_code_folded_key"
  ON "public"."Item" (lower(btrim("code")))
  WHERE "code" IS NOT NULL AND btrim("code") <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "Item_barcode_folded_key"
  ON "public"."Item" (lower(btrim("barcode")))
  WHERE "barcode" IS NOT NULL AND btrim("barcode") <> '';
