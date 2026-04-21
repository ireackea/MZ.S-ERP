-- CreateTable
CREATE TABLE "formulations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetItemId" INTEGER NOT NULL,
    "expectedCostPerTon" DECIMAL(65,30),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "formulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulation_items" (
    "id" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "percentage" DECIMAL(65,30) NOT NULL,
    "weightPerTon" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formulation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formulations_code_key" ON "formulations"("code");

-- CreateIndex
CREATE INDEX "formulations_targetItemId_idx" ON "formulations"("targetItemId");

-- CreateIndex
CREATE INDEX "formulations_name_idx" ON "formulations"("name");

-- CreateIndex
CREATE INDEX "formulations_isActive_idx" ON "formulations"("isActive");

-- CreateIndex
CREATE INDEX "formulation_items_itemId_idx" ON "formulation_items"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "formulation_items_formulationId_itemId_key" ON "formulation_items"("formulationId", "itemId");

-- AddForeignKey
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_items" ADD CONSTRAINT "formulation_items_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_items" ADD CONSTRAINT "formulation_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
