-- Gate 2.8 — the audit trail is the substrate for everything this plan adds.
--
-- Three of the changes in this round write to `audit_logs` and read it back:
-- the reset record (2.4), the settings audit (2.1), and the pending-invitation
-- queue. All three query it the way the audit screen does.
--
-- The live index set covered action, entityType, entityId, actorId, status and
-- timestamp. It did not cover `targetUserId`, which is the only filter
-- `GET /users/:id/audit` uses and the column every user-management action writes.
-- It also had no index for free-text `search`, which is five `ILIKE '%…%'`
-- predicates — a sequential scan, twice per request, because the count() repeats
-- the same where clause.
--
-- `pg_trgm` is created in its own migration so an operator can grant usage
-- deliberately. The GIN index is not created here if the extension is absent: a
-- migration that fails because of a missing extension is worse than a slow query
-- that is at least documented.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The per-user account history. Written on every create, update, delete, lock,
-- unlock and password change.
CREATE INDEX IF NOT EXISTS "audit_logs_targetUserId_idx"
  ON "audit_logs" USING btree ("targetUserId");

-- `search` covers the message, actorUsername, entityId, entityType and
-- targetResource. The Prisma field is `details`; the column is `message` (@map), and
-- the first attempt indexed the field name and failed with "column details does
-- not exist" - leaving a partial migration behind, because the statements before
-- it had already run.
--
-- A btree cannot serve `ILIKE '%…%'`; a trigram GIN index can, and without it every
-- audited search scans the table twice.
CREATE INDEX IF NOT EXISTS "audit_logs_message_trgm_idx"
  ON "audit_logs" USING gin ("message" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "audit_logs_actorUsername_trgm_idx"
  ON "audit_logs" USING gin ("actorUsername" gin_trgm_ops);

-- Ordering: the audit screen sorts by timestamp desc on every page. The existing
-- btree is ascending, so a backward scan is planned; this one is not.
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_desc_idx"
  ON "audit_logs" ("timestamp" DESC);
