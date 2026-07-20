-- Durable Bucky oversight and no-cost archive safety foundation.
ALTER TABLE "Document"
    ADD COLUMN "checksum" TEXT,
    ADD COLUMN "accessScope" TEXT NOT NULL DEFAULT 'family',
    ADD COLUMN "backupStatus" TEXT NOT NULL DEFAULT 'local-only',
    ADD COLUMN "deletedAt" TIMESTAMP(3),
    ADD COLUMN "deletedBy" TEXT;

CREATE INDEX "Document_checksum_idx" ON "Document"("checksum");
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");
CREATE INDEX "Document_accessScope_idx" ON "Document"("accessScope");

CREATE TABLE "PositionAssignment" (
    "id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "memberId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'Bucky',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PositionAssignment_position_endedAt_idx" ON "PositionAssignment"("position", "endedAt");
CREATE INDEX "PositionAssignment_memberId_idx" ON "PositionAssignment"("memberId");
CREATE INDEX "PositionAssignment_effectiveAt_idx" ON "PositionAssignment"("effectiveAt");
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BuckyQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "targetPerson" TEXT,
    "questionType" TEXT NOT NULL DEFAULT 'clarification',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "options" JSONB,
    "proposedAction" JSONB,
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuckyQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuckyQuestion_status_createdAt_idx" ON "BuckyQuestion"("status", "createdAt");
CREATE INDEX "BuckyQuestion_targetPerson_status_idx" ON "BuckyQuestion"("targetPerson", "status");

CREATE TABLE "BuckyLedgerEntry" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'Bucky',
    "initiatedBy" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceLabel" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "revertedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuckyLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuckyLedgerEntry_createdAt_idx" ON "BuckyLedgerEntry"("createdAt");
CREATE INDEX "BuckyLedgerEntry_actionType_idx" ON "BuckyLedgerEntry"("actionType");
CREATE INDEX "BuckyLedgerEntry_entityType_entityId_idx" ON "BuckyLedgerEntry"("entityType", "entityId");
