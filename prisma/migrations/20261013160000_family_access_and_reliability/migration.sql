-- AlterTable
ALTER TABLE "Stay" ADD COLUMN     "calendarSyncAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "calendarSyncError" TEXT,
ADD COLUMN     "calendarSyncLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "calendarSyncRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "calendarSyncState" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "authenticationReason" TEXT,
ADD COLUMN     "authenticationStatus" TEXT,
ADD COLUMN     "inboxUid" TEXT,
ADD COLUMN     "inboxUidValidity" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "processingPlan" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "senderName" TEXT,
ADD COLUMN     "sourceChecksum" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'received';

-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN     "accessApproved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FamilySession" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedEmail" TEXT;

-- CreateTable
CREATE TABLE "FamilySignInLink" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "destination" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilySignInLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ChecklistRun" (
    "id" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedBy" TEXT,
    "items" JSONB NOT NULL,

    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyAccessRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIntakeAction" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIntakeAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMailboxState" (
    "id" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "lastScannedUid" TEXT NOT NULL DEFAULT '0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMailboxState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilySignInLink_tokenHash_key" ON "FamilySignInLink"("tokenHash");

-- CreateIndex
CREATE INDEX "FamilySignInLink_memberId_createdAt_idx" ON "FamilySignInLink"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilySignInLink_expiresAt_idx" ON "FamilySignInLink"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthRateLimit_windowEndsAt_idx" ON "AuthRateLimit"("windowEndsAt");

-- CreateIndex
CREATE INDEX "ChecklistRun_list_archivedAt_idx" ON "ChecklistRun"("list", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyAccessRequest_email_key" ON "FamilyAccessRequest"("email");

-- CreateIndex
CREATE INDEX "FamilyAccessRequest_status_createdAt_idx" ON "FamilyAccessRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIntakeAction_actionKey_key" ON "EmailIntakeAction"("actionKey");

-- CreateIndex
CREATE INDEX "EmailIntakeAction_messageId_idx" ON "EmailIntakeAction"("messageId");

-- CreateIndex
CREATE INDEX "EmailLog_status_nextAttemptAt_idx" ON "EmailLog"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailLog_leaseExpiresAt_idx" ON "EmailLog"("leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "FamilySignInLink" ADD CONSTRAINT "FamilySignInLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing calendar links are reconciled before any later changes are pushed.
UPDATE "Stay" SET "calendarSyncState" = 'synced' WHERE "googleEventId" IS NOT NULL;
-- Old receipts have no retained source/plan. Do not replay possibly completed actions.
UPDATE "EmailLog" SET "status" = 'completed' WHERE "status" = 'received';

-- Jeremy approved using the existing directory. Missing, shared, and ineligible
-- addresses stay unapproved and require explicit caretaker review.
UPDATE "FamilyMember" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL;
UPDATE "FamilyMember" AS member SET "accessApproved" = true
WHERE member."canClaim" = true AND member."isMinor" = false AND member."deceased" = false
  AND member."email" ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  AND length(member."email") <= 254
  AND (SELECT count(*) FROM "FamilyMember" AS other WHERE other."email" = member."email") = 1;
CREATE UNIQUE INDEX "FamilyMember_approved_email_key" ON "FamilyMember"(lower("email"))
  WHERE "accessApproved" = true AND "email" IS NOT NULL;

CREATE TABLE "ArchiveBackupState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'idle',
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "latestReceipt" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArchiveBackupState_pkey" PRIMARY KEY ("id")
);
