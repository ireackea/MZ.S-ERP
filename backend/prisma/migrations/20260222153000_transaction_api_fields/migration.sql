-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" TEXT,
    "warehouseInvoice" TEXT,
    "supplierInvoice" TEXT,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "supplierNet" DECIMAL,
    "difference" DECIMAL,
    "packageCount" DECIMAL,
    "weightSlip" TEXT,
    "salaryOfWorker" DECIMAL,
    "supplierOrReceiver" TEXT NOT NULL,
    "truckNumber" TEXT,
    "trailerNumber" TEXT,
    "driverName" TEXT,
    "entryTime" TEXT,
    "exitTime" TEXT,
    "unloadingRuleId" TEXT,
    "unloadingDuration" INTEGER,
    "delayDuration" INTEGER,
    "delayPenalty" DECIMAL,
    "calculatedFine" DECIMAL,
    "notes" TEXT,
    "attachmentData" TEXT,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "googleDriveLink" TEXT,
    "createdByUserId" TEXT,
    "timestamp" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Transaction" (
    "id",
    "publicId",
    "date",
    "itemId",
    "warehouseInvoice",
    "type",
    "quantity",
    "salaryOfWorker",
    "supplierOrReceiver",
    "truckNumber",
    "driverName",
    "notes",
    "createdAt",
    "updatedAt",
    "timestamp"
)
SELECT
    "id",
    printf('tx-%d', "id"),
    "date",
    "itemId",
    "warehouseInvoice",
    "type",
    "quantity",
    "salaryOfWorker",
    "supplierOrReceiver",
    "truckNumber",
    "driverName",
    "notes",
    "createdAt",
    "updatedAt",
    CAST(strftime('%s', "date") AS INTEGER) * 1000
FROM "Transaction";

DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";

CREATE UNIQUE INDEX "Transaction_publicId_key" ON "Transaction"("publicId");
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");
CREATE INDEX "Transaction_itemId_idx" ON "Transaction"("itemId");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_warehouseInvoice_idx" ON "Transaction"("warehouseInvoice");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
