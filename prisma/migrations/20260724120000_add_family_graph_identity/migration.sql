-- Family graph + lightweight per-person identity.
-- Additive only: every new FamilyMember column is nullable or defaulted, so the
-- existing directory rows keep working untouched until the reconciliation script runs.
ALTER TABLE "FamilyMember"
    ADD COLUMN "displayName" TEXT,
    ADD COLUMN "surname" TEXT,
    ADD COLUMN "maidenName" TEXT,
    ADD COLUMN "photoUrl" TEXT,
    ADD COLUMN "isBranchRoot" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "isMinor" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "canClaim" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "deceased" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "needsReview" TEXT,
    ADD COLUMN "isCurator" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "claimedAt" TIMESTAMP(3),
    ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "FamilyMember_claimedAt_idx" ON "FamilyMember"("claimedAt");

-- Parent edges point from parent to child and attach to individual parents, so a
-- remarriage never reparents an earlier marriage's children.
CREATE TABLE "FamilyRelationship" (
    "id" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyRelationship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilyRelationship_fromMemberId_toMemberId_type_key"
    ON "FamilyRelationship"("fromMemberId", "toMemberId", "type");
CREATE INDEX "FamilyRelationship_fromMemberId_type_idx" ON "FamilyRelationship"("fromMemberId", "type");
CREATE INDEX "FamilyRelationship_toMemberId_type_idx" ON "FamilyRelationship"("toMemberId", "type");

ALTER TABLE "FamilyRelationship"
    ADD CONSTRAINT "FamilyRelationship_fromMemberId_fkey"
    FOREIGN KEY ("fromMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyRelationship"
    ADD CONSTRAINT "FamilyRelationship_toMemberId_fkey"
    FOREIGN KEY ("toMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Optional per-person PIN. Stays empty until someone opts into locking their profile.
CREATE TABLE "FamilyCredential" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilyCredential_memberId_key" ON "FamilyCredential"("memberId");

ALTER TABLE "FamilyCredential"
    ADD CONSTRAINT "FamilyCredential_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Revoked rather than deleted, so these double as the claim audit trail.
CREATE TABLE "FamilySession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "claimedVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "FamilySession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilySession_tokenHash_key" ON "FamilySession"("tokenHash");
CREATE INDEX "FamilySession_memberId_idx" ON "FamilySession"("memberId");
CREATE INDEX "FamilySession_expiresAt_idx" ON "FamilySession"("expiresAt");

ALTER TABLE "FamilySession"
    ADD CONSTRAINT "FamilySession_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
