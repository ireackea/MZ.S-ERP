-- Gate 2.1 — the company identity has no home on the server.
--
-- "General settings" saved into a Zustand store and nowhere else. `saveSettings`
-- in storage.ts had zero call sites, and there was no settings module in the
-- backend at all, so an administrator edited the company name, logo and default
-- unloading duration, was told it was saved, and found the defaults back after a
-- reload. Those values are printed on every report: the stock card, the
-- statement, the daily operations print, and the stocktake header.
--
-- The table is key/value rather than one column per setting, because the settings
-- grow and a migration should not be needed to add a preference. The cost of
-- key/value is that the schema cannot enforce a type, so three columns carry it
-- instead: `valueType` for the UI to render the right control and to validate on
-- write, and `category` so the settings screen can group without hardcoding a
-- list on both sides.
--
-- `updatedById` and `reason` exist so the question "who changed the company name
-- on this report, and when" has an answer. A settings table without an author is
-- a settings table nobody can audit, and the audit log is a separate, lossy place
-- to look.

CREATE TABLE IF NOT EXISTS "system_settings" (
    "key"         TEXT NOT NULL,
    "value"       TEXT,
    "valueType"   TEXT NOT NULL DEFAULT 'string',
    "category"    TEXT NOT NULL DEFAULT 'general',
    "label"       TEXT,
    "updatedById" TEXT,
    "reason"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- The settings screen reads by category, so that is the access path.
CREATE INDEX IF NOT EXISTS "system_settings_category_idx" ON "system_settings" ("category");

-- ON DELETE SET NULL, not CASCADE: deleting a user must not delete the company
-- settings they last edited. The same choice the opening-balance author uses.
CREATE INDEX IF NOT EXISTS "system_settings_updatedById_idx" ON "system_settings" ("updatedById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_updatedById_fkey'
  ) THEN
    ALTER TABLE "system_settings"
      ADD CONSTRAINT "system_settings_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
