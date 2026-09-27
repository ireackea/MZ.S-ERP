-- FC-SEC-012 — separate a security lock from a deactivation.
--
-- `setLockStatus` set isActive=false to lock an account, which is the same
-- column a plain deactivation writes. The two states were therefore
-- indistinguishable in the data, in the user list (which labelled every
-- inactive account "locked"), and in the filters: a deactivated account matched
-- neither `active` (isActive is false) nor `locked` (lockoutUntil is null), so
-- it could not be found by any status filter at all.
--
-- Existing rows are back-filled from what is actually observable, with no
-- guessing: a row is a lock only when it carries a lockout timestamp. A
-- deactivated account with no timestamp was deactivated, not locked, and stays
-- that way.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users"
   SET "isLocked" = true
 WHERE "isActive" = false
   AND "lockoutUntil" IS NOT NULL;
