-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "publicId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "unit" TEXT
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" INTEGER,
    FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseInvoice" TEXT,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "salaryOfWorker" DECIMAL,
    "supplierOrReceiver" TEXT NOT NULL,
    "truckNumber" TEXT,
    "driverName" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "theme" TEXT NOT NULL DEFAULT 'classic',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_publicId_key" ON "Item"("publicId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_itemId_financialYear_key" ON "OpeningBalance"("itemId" ASC, "financialYear" ASC);

-- CreateIndex
CREATE INDEX "OpeningBalance_financialYear_idx" ON "OpeningBalance"("financialYear" ASC);

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type" ASC);

-- CreateIndex
CREATE INDEX "Transaction_itemId_idx" ON "Transaction"("itemId" ASC);

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);
