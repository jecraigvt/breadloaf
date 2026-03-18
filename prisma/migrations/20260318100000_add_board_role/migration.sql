-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN "boardRole" TEXT;
ALTER TABLE "FamilyMember" ADD COLUMN "isBoardMember" BOOLEAN NOT NULL DEFAULT false;
