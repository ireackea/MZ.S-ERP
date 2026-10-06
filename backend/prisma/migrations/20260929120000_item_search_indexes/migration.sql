-- Makes the item search an index lookup instead of a table scan.
--
-- `findAll` searches with `contains`, which Prisma compiles to
-- `lower(name) LIKE '%term%'`. A b-tree index is useless for that: it can only serve
-- a prefix, and the term is wrapped in wildcards, so every search was a sequential
-- scan of the whole table. EXPLAIN confirms it on the live data — `Seq Scan on
-- "Item"` — and that is fine at 126 rows and unacceptable at 126,000, which is the
-- size a catalogue reaches in a year or two. The cost curve is the problem: it is
-- linear in table size on every keystroke of a search box.
--
-- `pg_trgm` indexes the *contents* of a string, so a pattern with leading and
-- trailing wildcards becomes index-addressable. This is the index that makes
-- `contains` search work at all.
--
-- The expression index on `lower(...)` is not decoration: the query lowercases both
-- sides, and an index on the raw column would not be matched by it. The index
-- expression has to be the query expression, for the same reason the folded code
-- index in 20260929050000 had to be `lower(btrim(...))` — a plain index here would
-- be silently unused, and the only symptom is the same seq scan.
--
-- `gin_trgm_ops` is the operator class; the default b-tree opclass on a text column
-- is what makes the naive version of this migration not help.
--
-- Idempotent throughout, and `pg_trgm` is created in its own migration
-- (20260927110000) so an operator can grant usage on it separately — this one
-- depends on that, and says so rather than assuming it.

-- Fail loudly if the extension is absent instead of quietly skipping the indexes.
-- A migration that runs to completion having created nothing is the exact shape of
-- "it worked, the search is still slow", which is a bug discovered in production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION
      'pg_trgm is required by this migration. Install it as a superuser, then re-run: CREATE EXTENSION IF NOT EXISTS pg_trgm;';
  END IF;
END
$$;

-- The three searchable columns. `name` first because it is what a search box is for.
CREATE INDEX IF NOT EXISTS "Item_name_trgm_key"
  ON "public"."Item" USING gin (lower("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Item_code_trgm_key"
  ON "public"."Item" USING gin (lower("code") gin_trgm_ops);

-- `category` is in the search OR-list and is also the filter column, so it gets the
-- same treatment. It is low-cardinality, which is where a trigram index earns less —
-- but the search still does `contains` against it, and without an index that term
-- forces the whole OR into a sequential scan even when the other two are indexed.
CREATE INDEX IF NOT EXISTS "Item_category_trgm_key"
  ON "public"."Item" USING gin (lower("category") gin_trgm_ops);

-- Barcode was not searchable at all before this wave's companion change, which is
-- the gap that made the index worth adding: a stock lookup by barcode — the one
-- lookup an operator does with a scanner — had to go through the general search, and
-- would have missed every barcode containing a leading zero once it was there.
--
-- Partial, because 51 of 126 items in this catalogue have no barcode at all and an
-- index entry for an empty string is pure overhead.
CREATE INDEX IF NOT EXISTS "Item_barcode_search_key"
  ON "public"."Item" USING btree (lower("barcode"))
  WHERE "barcode" IS NOT NULL AND btrim("barcode") <> '';
