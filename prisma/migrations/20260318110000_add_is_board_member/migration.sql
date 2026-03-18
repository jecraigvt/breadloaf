-- AlterTable
ALTER TABLE "FamilyMember" ADD COLUMN IF NOT EXISTS "isBoardMember" BOOLEAN NOT NULL DEFAULT false;
