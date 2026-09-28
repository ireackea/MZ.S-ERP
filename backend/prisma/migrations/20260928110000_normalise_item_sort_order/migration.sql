-- Makes the catalog order self-repairing, because nothing enforced it.
--
-- Until now `sortOrder` was a column any row could duplicate, and the column
-- default of 1000000 handed the *same* rank to every row inserted by a path that
-- did not set it. Two rows sharing a rank is not a display glitch: the read path
-- breaks the tie by id, so which of the two comes first is decided by which row
-- the database happened to return, and the order an operator arranged can
-- silently invert.
--
-- A row at exactly the default is the fingerprint of that collision: a whole
-- import, or a batch of manual adds, all landing on 1000000.
--
-- Idempotent. On a healthy database every statement here is a no-op, which is
-- the point: this runs on every environment, including restored ones where the
-- data arrived with the old behaviour baked in.

-- 1. Split every shared rank, keeping each cluster's existing order.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "sortOrder"
      ORDER BY "id" ASC
    ) AS within_rank,
    FIRST_VALUE("sortOrder") OVER (
      PARTITION BY "sortOrder"
      ORDER BY "id" ASC
    ) AS keep
  FROM "public"."Item"
  WHERE "sortOrder" IS NOT NULL
)
UPDATE "public"."Item" AS item
SET "sortOrder" = ranked.keep::int + ((ranked.within_rank - 1)::int)
FROM ranked
WHERE item."id" = ranked."id"
  AND ranked.within_rank > 1;

-- 2. Rows that never got a rank join the end, in insertion order, so the tail of
--    the catalog is deterministic rather than alphabetical.
WITH tail AS (
  SELECT
    "id",
    (SELECT coalesce(max("sortOrder"), -1) FROM "public"."Item" WHERE "sortOrder" IS NOT NULL)
      + ROW_NUMBER() OVER (ORDER BY "id" ASC) AS rank
  FROM "public"."Item"
  WHERE "sortOrder" IS NULL
)
UPDATE "public"."Item" AS item
SET "sortOrder" = tail.rank
FROM tail
WHERE item."id" = tail."id";
