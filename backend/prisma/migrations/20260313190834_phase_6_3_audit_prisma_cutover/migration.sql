-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "ipAddress" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_active_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "deviceFingerprint" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "active_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_active_sessions" ("createdAt", "deviceFingerprint", "expiresAt", "id", "ipAddress", "isRevoked", "lastActivityAt", "role", "userAgent", "userId", "username") SELECT "createdAt", "deviceFingerprint", "expiresAt", "id", "ipAddress", "isRevoked", "lastActivityAt", "role", "userAgent", "userId", "username" FROM "active_sessions";
DROP TABLE "active_sessions";
ALTER TABLE "new_active_sessions" RENAME TO "active_sessions";
CREATE UNIQUE INDEX "active_sessions_tokenHash_key" ON "active_sessions"("tokenHash");
CREATE INDEX "active_sessions_userId_idx" ON "active_sessions"("userId");
CREATE INDEX "active_sessions_tokenHash_idx" ON "active_sessions"("tokenHash");
CREATE INDEX "active_sessions_expiresAt_idx" ON "active_sessions"("expiresAt");
CREATE INDEX "active_sessions_isRevoked_idx" ON "active_sessions"("isRevoked");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
