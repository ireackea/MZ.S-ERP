-- FC-SEC-010 — let the superadmin rotate away from the value in .env.
--
-- `reconcileSuperAdminAccount` rewrote the stored hash to ADMIN_PASSWORD on
-- every boot whenever it did not match, so the superadmin password was
-- permanently the value in the .env file and could never be rotated. Anyone who
-- could read that file held the most powerful credential in the system.
--
-- `password_set_by_user` is false by default, so an existing install keeps
-- behaving exactly as before until the operator sets their own password. After
-- that the env value is never written again. `must_change_password` is false
-- too, so nobody is locked out of an existing session by this migration.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordSetByUser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
