ALTER TABLE "public"."Transaction"
  ADD COLUMN "adjustmentReason" TEXT,
  ADD COLUMN "adjustmentSourceReference" TEXT,
  ADD COLUMN "adjustmentDirection" TEXT;
