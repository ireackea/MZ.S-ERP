-- Gives a bulk import an identity, so it can be named, measured, and undone.
--
-- A 500-row import used to leave nothing behind that identified it. The audit row
-- named every created item by joining their publicIds into one indexed column, which
-- overflowed a b-tree entry at about sixty-five rows and made the write fail *after*
-- the rows were committed — so the one record that should have described the
-- mutation was the thing that broke, and the audit row's `entityId` became a batch
-- id with nothing behind it to point at.
--
-- This is what a batch id points at. It answers the three questions an operator
-- actually has after an import: what did it do, which rows did it touch, and can I
-- take it back.
--
-- `status` is a string rather than an enum so that adding a state later is a
-- migration of values rather than a type change on a table that already holds
-- production rows. The values in use are `succeeded`, `partial` and `failed`.
--
-- `errors` is a Json column and NOT an indexed text column, deliberately. The
-- overflow this migration exists beside was caused by putting a variable-length
-- list into an indexed column; the rejection list is unbounded, so it belongs
-- somewhere that is not measured against 2704 bytes. `ItemImportError` below exists
-- for the same reason at a queryable grain.
--
-- Idempotent by construction: every statement is CREATE ... IF NOT EXISTS, so this
-- runs identically on a fresh database and on one that has already been migrated.
-- The seed is skipped when a profile already exists, so re-running cannot create a
-- second default order and violate the partial unique index.

CREATE TABLE IF NOT EXISTS "public"."ItemImportBatch" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "publicId"      TEXT NOT NULL,
  "sourceFileName" TEXT,
  -- A digest of the submitted rows. Re-importing the same file is then a detectable
  -- no-op rather than a second attempt to insert the same catalogue, which is what
  -- made a codeless file double the catalogue with no message.
  "fileHash"      TEXT,
  -- strict = all or nothing. partial = the rows that validated, in one transaction.
  "mode"          TEXT NOT NULL DEFAULT 'strict',
  "status"        TEXT NOT NULL DEFAULT 'running',
  "totalRows"     INTEGER NOT NULL DEFAULT 0,
  "createdCount"  INTEGER NOT NULL DEFAULT 0,
  "updatedCount"  INTEGER NOT NULL DEFAULT 0,
  "skippedCount"  INTEGER NOT NULL DEFAULT 0,
  "failedCount"   INTEGER NOT NULL DEFAULT 0,
  "durationMs"    INTEGER,
  "createdBy"     TEXT,
  "actorUsername" TEXT,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  "errors"        JSONB,
  CONSTRAINT "ItemImportBatch_pkey" PRIMARY KEY ("id")
);

-- The publicId is what a route takes and what the audit row names, so it is unique
-- by construction rather than by convention. The index is a partial unique one
-- because the column is a text identifier and the id column is what joins.
CREATE UNIQUE INDEX IF NOT EXISTS "ItemImportBatch_publicId_key"
  ON "public"."ItemImportBatch" ("publicId");

-- Looked up by digest when the same file is submitted twice.
CREATE INDEX IF NOT EXISTS "ItemImportBatch_fileHash_idx"
  ON "public"."ItemImportBatch" ("fileHash");

-- Listed newest-first in the studio's history panel. Deliberately not a foreign key
-- on `createdBy`: users are deleted, and an import's provenance must outlive the
-- account that performed it.
CREATE INDEX IF NOT EXISTS "ItemImportBatch_startedAt_idx"
  ON "public"."ItemImportBatch" ("startedAt" DESC);

-- One entry per rejected row, at a grain a client can page through. Separate from
-- the Json column above because this one is queried per row and that one is only
-- ever read whole.
CREATE TABLE IF NOT EXISTS "public"."ItemImportError" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId"   UUID NOT NULL,
  "rowNumber" INTEGER,
  "field"     TEXT,
  "message"   TEXT NOT NULL,
  "value"     TEXT,
  CONSTRAINT "ItemImportError_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ItemImportError_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "public"."ItemImportBatch" ("id") ON DELETE CASCADE
);

-- Paged by batch, so the index is on the pair rather than on the column alone.
CREATE INDEX IF NOT EXISTS "ItemImportError_batchId_rowNumber_idx"
  ON "public"."ItemImportError" ("batchId", "rowNumber");

-- Which import last touched an item. This is what makes a revert possible without
-- guessing: an item is in a batch or it is not.
--
-- Nullable and deliberately not indexed on its own: almost every item will be NULL
-- and most catalogue reads never touch the column, so an index would be paid for
-- and never used. The lookup that matters is "every item of one batch", which uses
-- the index below.
ALTER TABLE "public"."Item" ADD COLUMN IF NOT EXISTS "lastImportBatchId" UUID;

ALTER TABLE "public"."Item"
  ADD CONSTRAINT "Item_lastImportBatchId_fkey"
  FOREIGN KEY ("lastImportBatchId") REFERENCES "public"."ItemImportBatch" ("id")
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Item_lastImportBatchId_idx"
  ON "public"."Item" ("lastImportBatchId")
  WHERE "lastImportBatchId" IS NOT NULL;

-- The import serialisation guarantee, recorded here so the key and the promise live
-- in the same file.
--
-- `nextSortOrder` reads `max(sortOrder) + 1` outside any transaction, so two
-- operators importing at once both read the same maximum and both wrote from that
-- base: overlapping ranks, rows interleaved, and no constraint anywhere to notice.
-- The same window let a second import insert codes the first had already taken,
-- because the duplicate pre-check also runs before the write.
--
-- The import now takes a transaction-scoped advisory lock on this exact key before
-- it reads the rank base, so the second import waits instead of colliding. It is
-- the first advisory lock in this codebase, which is why the key is written down
-- here rather than being an inline literal nobody would recognise later.
--
--   SELECT pg_advisory_xact_lock(hashtext('mzs.items.import'));
--
-- Scoped to the transaction deliberately: it releases on commit *and* on rollback,
-- so a failed import cannot leave the catalogue locked. A session-level lock would
-- need a matching unlock on every error path, and the one path that forgets is the
-- one that matters.
--
-- No table backs this. An advisory lock is a name, not a row, and a table that
-- exists only to hold a name is a structure with no reader.
