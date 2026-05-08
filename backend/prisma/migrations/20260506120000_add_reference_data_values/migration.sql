-- CreateTable
CREATE TABLE "reference_data_values" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "reference_data_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reference_data_values_kind_check" CHECK ("kind" IN ('category', 'unit'))
);

-- CreateIndex
CREATE INDEX "reference_data_values_kind_idx" ON "reference_data_values"("kind");

-- CreateIndex
CREATE INDEX "reference_data_values_value_idx" ON "reference_data_values"("value");

-- CreateIndex
CREATE UNIQUE INDEX "reference_data_values_kind_value_lower_key" ON "reference_data_values"("kind", lower("value"));