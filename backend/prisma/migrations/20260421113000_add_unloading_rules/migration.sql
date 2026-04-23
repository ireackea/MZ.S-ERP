-- CreateTable
CREATE TABLE "unloading_rules" (
    "id" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "allowedDurationMinutes" INTEGER NOT NULL,
    "penaltyRatePerMinute" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "unloading_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unloading_rules_ruleName_key" ON "unloading_rules"("ruleName");

-- CreateIndex
CREATE INDEX "unloading_rules_ruleName_idx" ON "unloading_rules"("ruleName");

-- CreateIndex
CREATE INDEX "unloading_rules_isActive_idx" ON "unloading_rules"("isActive");