UPDATE "public"."Transaction"
SET "unloadingRuleId" = NULL
WHERE "unloadingRuleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."unloading_rules"
    WHERE "public"."unloading_rules"."id" = "public"."Transaction"."unloadingRuleId"
  );

CREATE INDEX "Transaction_unloadingRuleId_idx" ON "public"."Transaction"("unloadingRuleId");

ALTER TABLE "public"."Transaction"
ADD CONSTRAINT "Transaction_unloadingRuleId_fkey"
FOREIGN KEY ("unloadingRuleId") REFERENCES "public"."unloading_rules"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;