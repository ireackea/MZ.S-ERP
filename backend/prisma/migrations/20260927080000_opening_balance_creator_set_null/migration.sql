-- FC-SEC-011 — let a user who authored an opening balance still be deletable.
--
-- `OpeningBalance.creator` was the only relation in the schema with no
-- onDelete, so Postgres defaulted to NO ACTION. Deleting a user who had ever
-- set an opening balance would have returned a 500 from DELETE /users/:id.
--
-- It never fired, but only because the service never wrote `createdBy` — the
-- author of a fiscal-year starting position was never recorded at all. The
-- next commit starts writing it, which would have armed this constraint, so the
-- relation is relaxed to match every other creator relation in the schema: the
-- balance survives, the reference becomes null, and the audit trail keeps the
-- username in its message text.

ALTER TABLE "OpeningBalance"
  DROP CONSTRAINT IF EXISTS "OpeningBalance_creatorId_fkey";

ALTER TABLE "OpeningBalance"
  ADD CONSTRAINT "OpeningBalance_creatorId_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
