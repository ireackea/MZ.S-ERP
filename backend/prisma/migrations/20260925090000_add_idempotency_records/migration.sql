CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_actorId_operation_key_key"
ON "idempotency_records" ("actorId", "operation", "key");

CREATE INDEX "idempotency_records_createdAt_idx"
ON "idempotency_records" ("createdAt");

ALTER TABLE "idempotency_records"
ADD CONSTRAINT "idempotency_records_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
