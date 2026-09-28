-- The catalog order that "حفظ ترتيب الأصناف" claims to save.
--
-- Until now the button wrote to a Zustand array and nothing else, so the order
-- died on reload. There was nowhere to put it: no column existed.
--
-- The backfill deliberately reproduces the order the operator already sees
-- today (name ascending), so the first save after this migration changes nothing
-- on screen. Backfilling to something else would silently reorder 648 items the
-- moment the image was rebuilt.

ALTER TABLE "public"."Item"
  ADD COLUMN "sortOrder" INTEGER;

-- Rank by the order already in effect. `id` breaks ties so the result is
-- deterministic across runs and machines, which matters because a tie broken by
-- physical row order would differ between two databases restored from the same
-- dump.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "name" ASC, "id" ASC) - 1 AS rank
  FROM "public"."Item"
)
UPDATE "public"."Item" AS item
SET "sortOrder" = ranked.rank
FROM ranked
WHERE item."id" = ranked."id";

-- Rows inserted by any path that does not know this column land after
-- everything an operator has ranked. Without the default such a row would be
-- NULL, and a NULL in the middle of an ordered list is a decision nobody made.
ALTER TABLE "public"."Item"
  ALTER COLUMN "sortOrder" SET DEFAULT 1000000;

CREATE INDEX "Item_sortOrder_idx" ON "public"."Item"("sortOrder");
