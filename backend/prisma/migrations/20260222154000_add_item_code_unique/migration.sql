-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT,
    "code" TEXT,
    "codeGenerated" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Item" ("barcode", "category", "code", "currentStock", "description", "id", "maxLimit", "minLimit", "name", "orderLimit", "publicId", "unit") SELECT "barcode", "category", "code", "currentStock", "description", "id", "maxLimit", "minLimit", "name", "orderLimit", "publicId", "unit" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_publicId_key" ON "Item"("publicId");
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");
CREATE INDEX "Item_name_idx" ON "Item"("name");
CREATE INDEX "Item_code_idx" ON "Item"("code");
CREATE INDEX "Item_barcode_idx" ON "Item"("barcode");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
