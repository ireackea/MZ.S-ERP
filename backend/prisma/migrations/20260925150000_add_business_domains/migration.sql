CREATE TABLE "public"."Partner" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."Order" (
  "id" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "totalAmount" DECIMAL(65,30),
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "itemId" INTEGER NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unit" TEXT,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."StocktakingSession" (
  "id" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL DEFAULT 'default',
  "status" TEXT NOT NULL DEFAULT 'open',
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "archivedPdfName" TEXT,
  "archivedPdfMime" TEXT,
  "archivedPdfData" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StocktakingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."StocktakingEntry" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "itemId" INTEGER NOT NULL,
  "actualCount" DECIMAL(65,30),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StocktakingEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."StocktakingCount" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "value" DECIMAL(65,30) NOT NULL,
  "countedById" TEXT,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StocktakingCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Partner_name_key" ON "public"."Partner"("name");
CREATE INDEX "Partner_type_idx" ON "public"."Partner"("type");
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "public"."Order"("orderNumber");
CREATE INDEX "Order_partnerId_idx" ON "public"."Order"("partnerId");
CREATE INDEX "Order_warehouseId_idx" ON "public"."Order"("warehouseId");
CREATE INDEX "Order_status_idx" ON "public"."Order"("status");
CREATE INDEX "Order_date_idx" ON "public"."Order"("date");
CREATE UNIQUE INDEX "OrderItem_orderId_itemId_key" ON "public"."OrderItem"("orderId", "itemId");
CREATE INDEX "OrderItem_itemId_idx" ON "public"."OrderItem"("itemId");
CREATE UNIQUE INDEX "StocktakingSession_monthKey_warehouseId_key" ON "public"."StocktakingSession"("monthKey", "warehouseId");
CREATE INDEX "StocktakingSession_status_idx" ON "public"."StocktakingSession"("status");
CREATE UNIQUE INDEX "StocktakingEntry_sessionId_itemId_key" ON "public"."StocktakingEntry"("sessionId", "itemId");
CREATE INDEX "StocktakingEntry_itemId_idx" ON "public"."StocktakingEntry"("itemId");
CREATE INDEX "StocktakingCount_entryId_idx" ON "public"."StocktakingCount"("entryId");
CREATE INDEX "StocktakingCount_countedById_idx" ON "public"."StocktakingCount"("countedById");

ALTER TABLE "public"."Partner" ADD CONSTRAINT "Partner_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."StocktakingSession" ADD CONSTRAINT "StocktakingSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."StocktakingEntry" ADD CONSTRAINT "StocktakingEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."StocktakingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."StocktakingEntry" ADD CONSTRAINT "StocktakingEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."StocktakingCount" ADD CONSTRAINT "StocktakingCount_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."StocktakingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."StocktakingCount" ADD CONSTRAINT "StocktakingCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
