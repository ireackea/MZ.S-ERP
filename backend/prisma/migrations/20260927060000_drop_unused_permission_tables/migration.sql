-- FC-SEC-007 — drop the three tables that no code ever read or wrote.
--
-- `permissions`, `role_permissions` and `user_roles` were a normalised
-- permission model that was never wired up. Authorisation runs entirely off
-- `users.roleId` and the `roles.permissions` JSON column, and all three tables
-- held zero rows on every install.
--
-- The risk they posed was structural rather than behavioural: a future
-- maintainer would reasonably assume the normalised tables were authoritative,
-- start reading from them, and silently lose every role permission in the
-- system. `ensureDefaultRoles` also only ever repaired `roles`, so a grant
-- written to the dead tables would never be reconciled.
--
-- Safe to drop: all three are empty, and the only writer was the backup
-- snapshot, which has been updated to stop reading them. A restore of an older
-- backup file that still carries these fields is accepted and ignored, because
-- the values could not have been anything but empty.

DROP TABLE IF EXISTS "user_roles";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "permissions";
