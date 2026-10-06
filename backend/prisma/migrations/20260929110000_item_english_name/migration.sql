-- The English name had no column.
--
-- `Item` has never had one. Which is odd, because every layer above the database
-- carries the field: the DTO accepts `englishName`, the import template offers a
-- column for it, the client-side matcher will fill it, the payload builder sends it
-- as its own key, and the exporter emits it. All of that is real, tested code. None
-- of it reached storage, on any path — not the import, not `create`, not `update`,
-- not `syncItems` — because `itemWriteData` could not set a key that has no column,
-- so it quietly did not.
--
-- So an operator typing an English name into the studio watched it disappear with
-- no error anywhere: the request succeeded, the row was written, the field was
-- gone. The failure mode is silence, which is the expensive kind.
--
-- Nullable and additive, so it cannot break an existing row or an existing query.
-- Nothing reads it yet, and nothing should until the studio is told it exists.
--
-- The length matches the shared `ITEM_FIELD_LIMITS.name` bound rather than being
-- chosen here, so the template cannot offer a width the column will refuse.

ALTER TABLE "public"."Item" ADD COLUMN IF NOT EXISTS "englishName" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'Item_englishName_length'
  ) THEN
    ALTER TABLE "public"."Item"
      ADD CONSTRAINT "Item_englishName_length"
      CHECK (char_length("englishName") <= 255);
  END IF;
END
$$;

-- Not indexed. Nothing looks an item up by its English name, and an index here
-- would be paid for on every insert and read by nothing.
