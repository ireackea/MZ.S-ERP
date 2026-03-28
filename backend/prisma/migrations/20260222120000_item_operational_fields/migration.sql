-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT,
    "code" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "category" TEXT NOT NULL DEFAULT 'غير مصنف',
    "minLimit" DECIMAL NOT NULL DEFAULT 0,
    "maxLimit" DECIMAL NOT NULL DEFAULT 1000,
    "orderLimit" DECIMAL,
    "currentStock" DECIMAL NOT NULL DEFAULT 0,
    "description" TEXT
);
INSERT INTO "new_Item" ("category", "description", "id", "name", "publicId", "unit")
SELECT coalesce("category", 'غير مصنف') AS "category", "description", "id", "name", "publicId", "unit"
FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_publicId_key" ON "Item"("publicId");
CREATE INDEX "Item_name_idx" ON "Item"("name");
CREATE INDEX "Item_barcode_idx" ON "Item"("barcode");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
