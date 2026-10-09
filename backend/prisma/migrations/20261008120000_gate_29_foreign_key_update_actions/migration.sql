-- Gate 2.9 — make the two import-batch foreign keys say what the datamodel says.
--
-- These constraints were created without an ON UPDATE action, so they default to
-- NO ACTION. Prisma's referential action for the update side is CASCADE, and it
-- compares that against the live definition — a difference it cannot ignore. The
-- result was that every generated migration carried, on every future run:
--
--   ALTER TABLE "Item" DROP CONSTRAINT "Item_lastImportBatchId_fkey";
--   ALTER TABLE "ItemImportBatch"... ADD CONSTRAINT ... ON UPDATE CASCADE;
--
-- A drop and a re-add of a foreign key on `Item`, the largest table in the system,
-- under an ACCESS EXCLUSIVE lock — to change a clause that has never mattered,
-- because a batch id is generated on insert and never updated. The migration never
-- said "this rebuilds a constraint on the items table", so nobody would have looked.
--
-- Both blocks below are guarded: if a deployment already has the intended clause,
-- the block does nothing. That matters because this migration is also the one that
-- teaches an existing database what the datamodel expects, and a hand-applied
-- fix upstream should not make it fail.

DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'Item_lastImportBatchId_fkey';

  IF current_def IS NOT NULL AND current_def NOT ILIKE '%ON UPDATE CASCADE%' THEN
    ALTER TABLE "Item" DROP CONSTRAINT "Item_lastImportBatchId_fkey";
    ALTER TABLE "Item" ADD CONSTRAINT "Item_lastImportBatchId_fkey"
      FOREIGN KEY ("lastImportBatchId") REFERENCES "ItemImportBatch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  current_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'ItemImportError_batchId_fkey';

  IF current_def IS NOT NULL AND current_def NOT ILIKE '%ON UPDATE CASCADE%' THEN
    ALTER TABLE "ItemImportError" DROP CONSTRAINT "ItemImportError_batchId_fkey";
    ALTER TABLE "ItemImportError" ADD CONSTRAINT "ItemImportError_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "ItemImportBatch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;