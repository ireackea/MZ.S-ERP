-- DEF-001 — a stock deficit is demand the ledger recorded that no physical
-- stock covered. The balance is clamped at zero and the unfulfilled remainder
-- is recorded here, so the invariant
--     currentStock = ledgerNet + openDeficit
-- holds and the movement is never silently rewritten.
CREATE TABLE "public"."StockDeficit" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourceTransactionId" TEXT,
    "settledByTransactionId" TEXT,
    "reason" TEXT,
    "resolution" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "StockDeficit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockDeficit_publicId_key" ON "public"."StockDeficit"("publicId");

CREATE INDEX "StockDeficit_itemId_status_idx" ON "public"."StockDeficit"("itemId", "status");

CREATE INDEX "StockDeficit_status_createdAt_idx" ON "public"."StockDeficit"("status", "createdAt");

CREATE INDEX "StockDeficit_warehouseId_status_idx" ON "public"."StockDeficit"("warehouseId", "status");

ALTER TABLE "public"."StockDeficit"
  ADD CONSTRAINT "StockDeficit_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
