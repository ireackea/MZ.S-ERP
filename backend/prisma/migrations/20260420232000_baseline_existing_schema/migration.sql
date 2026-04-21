-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Item" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT,
    "code" TEXT,
    "codeGenerated" BOOLEAN NOT NULL DEFAULT false,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "category" TEXT NOT NULL DEFAULT 'غير مصنف',
    "minLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxLimit" DECIMAL(65,30) NOT NULL DEFAULT 1000,
    "orderLimit" DECIMAL(65,30),
    "currentStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "description" TEXT,
    "imageUrl" TEXT,
    "attachments" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OpeningBalance" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transaction" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "itemId" INTEGER NOT NULL,
    "warehouseId" TEXT,
    "warehouseInvoice" TEXT,
    "supplierInvoice" TEXT,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "supplierNet" DECIMAL(65,30),
    "difference" DECIMAL(65,30),
    "packageCount" DECIMAL(65,30),
    "weightSlip" TEXT,
    "salaryOfWorker" DECIMAL(65,30),
    "supplierOrReceiver" TEXT NOT NULL,
    "truckNumber" TEXT,
    "trailerNumber" TEXT,
    "driverName" TEXT,
    "entryTime" TEXT,
    "exitTime" TEXT,
    "unloadingRuleId" TEXT,
    "unloadingDuration" INTEGER,
    "delayDuration" INTEGER,
    "delayPenalty" DECIMAL(65,30),
    "calculatedFine" DECIMAL(65,30),
    "notes" TEXT,
    "attachmentData" TEXT,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "googleDriveLink" TEXT,
    "createdByUserId" TEXT,
    "timestamp" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."active_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deviceFingerprint" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "message" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "metadata" TEXT,
    "actorUsername" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetResource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "roleId" TEXT NOT NULL,
    "invitedById" TEXT,
    "recipientUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "action" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockoutUntil" TIMESTAMP(3),
    "theme" TEXT NOT NULL DEFAULT 'classic',
    "roleId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "googleId" TEXT,
    "inviteToken" TEXT,
    "inviteExpires" TIMESTAMP(3),
    "isEmailConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Item_barcode_idx" ON "public"."Item"("barcode" ASC);

-- CreateIndex
CREATE INDEX "Item_code_idx" ON "public"."Item"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "public"."Item"("code" ASC);

-- CreateIndex
CREATE INDEX "Item_isArchived_idx" ON "public"."Item"("isArchived" ASC);

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "public"."Item"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Item_publicId_key" ON "public"."Item"("publicId" ASC);

-- CreateIndex
CREATE INDEX "OpeningBalance_financialYear_idx" ON "public"."OpeningBalance"("financialYear" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_itemId_financialYear_key" ON "public"."OpeningBalance"("itemId" ASC, "financialYear" ASC);

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "public"."Transaction"("date" ASC);

-- CreateIndex
CREATE INDEX "Transaction_itemId_idx" ON "public"."Transaction"("itemId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_publicId_key" ON "public"."Transaction"("publicId" ASC);

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "public"."Transaction"("type" ASC);

-- CreateIndex
CREATE INDEX "Transaction_warehouseInvoice_idx" ON "public"."Transaction"("warehouseInvoice" ASC);

-- CreateIndex
CREATE INDEX "active_sessions_expiresAt_idx" ON "public"."active_sessions"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "active_sessions_isRevoked_idx" ON "public"."active_sessions"("isRevoked" ASC);

-- CreateIndex
CREATE INDEX "active_sessions_tokenHash_idx" ON "public"."active_sessions"("tokenHash" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "active_sessions_tokenHash_key" ON "public"."active_sessions"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "active_sessions_userId_idx" ON "public"."active_sessions"("userId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "public"."audit_logs"("action" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "public"."audit_logs"("actorId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entityId_idx" ON "public"."audit_logs"("entityId" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_idx" ON "public"."audit_logs"("entityType" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "public"."audit_logs"("status" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "public"."audit_logs"("timestamp" ASC);

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "public"."invitations"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_recipientUserId_key" ON "public"."invitations"("recipientUserId" ASC);

-- CreateIndex
CREATE INDEX "invitations_status_idx" ON "public"."invitations"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "public"."invitations"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "public"."permissions"("key" ASC);

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "public"."role_permissions"("permissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "public"."role_permissions"("roleId" ASC, "permissionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "public"."roles"("name" ASC);

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "public"."user_roles"("roleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "public"."user_roles"("userId" ASC, "roleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "public"."users"("googleId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "public"."users"("inviteToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username" ASC);

-- AddForeignKey
ALTER TABLE "public"."OpeningBalance" ADD CONSTRAINT "OpeningBalance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OpeningBalance" ADD CONSTRAINT "OpeningBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "public"."Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."active_sessions" ADD CONSTRAINT "active_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
