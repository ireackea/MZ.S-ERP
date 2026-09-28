-- Named, saved catalogue orders.
--
-- `Item.sortOrder` can hold exactly one order, so a second arrangement meant
-- overwriting the first with no way back. This adds the named orders: a profile
-- is a saved arrangement, one of them is active, and the active one is
-- materialised into `Item.sortOrder` for reading.
--
-- The seed is the important part. The order the operator has *now* becomes a
-- profile called "الترتيب الحالي", and it is the active one — so the upgrade is
-- invisible. An operator who has arranged their catalogue by hand, or imported
-- it from a spreadsheet, keeps that arrangement and can now name it and keep
-- copies of alternatives.

CREATE TABLE "public"."ItemOrderProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemOrderProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ItemOrderEntry" (
    "profileId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "ItemOrderEntry_pkey" PRIMARY KEY ("profileId", "itemId")
);

-- One active order, guaranteed by the database.
--
-- Not by application code, because the failure this prevents is two operators
-- clicking "apply" at once and leaving the catalogue with two answers to "what
-- order is this?". A partial unique index makes that impossible rather than
-- unlikely: only one row where isActive is true can exist.
CREATE UNIQUE INDEX "ItemOrderProfile_one_active"
    ON "public"."ItemOrderProfile" ("isActive")
    WHERE "isActive" = true;

CREATE UNIQUE INDEX "ItemOrderProfile_name_key" ON "public"."ItemOrderProfile"("name");
CREATE INDEX "ItemOrderProfile_isActive_idx" ON "public"."ItemOrderProfile"("isActive");
CREATE INDEX "ItemOrderEntry_profileId_rank_idx" ON "public"."ItemOrderEntry"("profileId", "rank");

ALTER TABLE "public"."ItemOrderEntry"
    ADD CONSTRAINT "ItemOrderEntry_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "public"."ItemOrderProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ItemOrderEntry"
    ADD CONSTRAINT "ItemOrderEntry_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the current order as a named profile, and make it the active one.
--
-- `updatedAt` is not nullable and has no database default, because Prisma's
-- @updatedAt is applied by the client. The seed writes it explicitly.
WITH seeded AS (
    INSERT INTO "public"."ItemOrderProfile" ("id", "name", "isActive", "itemCount", "updatedAt")
    VALUES (
        'order-profile-default',
        'الترتيب الحالي',
        true,
        (SELECT count(*)::int FROM "public"."Item"),
        now()
    )
    RETURNING "id"
)
INSERT INTO "public"."ItemOrderEntry" ("profileId", "itemId", "rank")
SELECT
    (SELECT "id" FROM seeded),
    "id",
    -- The live rank, not a renumbering. A profile records positions as they were;
    -- dense is a property of the materialised column, not of the saved order.
    coalesce("sortOrder", row_number() OVER (ORDER BY "id" ASC)::int)
FROM "public"."Item";
