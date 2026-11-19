-- Double precision represents exact integer byte counts through 2^53 - 1 and
-- keeps the existing Document JSON contract numeric for older clients.
ALTER TABLE "Document" ALTER COLUMN "fileSize" TYPE DOUBLE PRECISION;
ALTER TABLE "Document" ADD COLUMN "archivePageJobId" TEXT;

CREATE TABLE "ArchiveImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "folderKey" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "groupImages" BOOLEAN NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "reservedFiles" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ArchiveImport_memberId_folderKey_key" ON "ArchiveImport"("memberId", "folderKey");
CREATE INDEX "ArchiveImport_memberId_createdAt_idx" ON "ArchiveImport"("memberId", "createdAt");

CREATE TABLE "ArchiveImportFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL REFERENCES "ArchiveImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "relativePath" TEXT NOT NULL,
    "groupPath" TEXT,
    "position" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "driveFolder" TEXT NOT NULL,
    "uploadUrl" TEXT,
    "documentId" TEXT REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ArchiveImportFile_driveId_key" ON "ArchiveImportFile"("driveId");
CREATE UNIQUE INDEX "ArchiveImportFile_documentId_key" ON "ArchiveImportFile"("documentId");
CREATE UNIQUE INDEX "ArchiveImportFile_importId_relativePath_key" ON "ArchiveImportFile"("importId", "relativePath");
CREATE UNIQUE INDEX "ArchiveImportFile_importId_position_key" ON "ArchiveImportFile"("importId", "position");
CREATE INDEX "ArchiveImportFile_importId_groupPath_position_idx" ON "ArchiveImportFile"("importId", "groupPath", "position");

CREATE TABLE "ArchivePage" (
    "jobId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "years" INTEGER[] NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL,
    PRIMARY KEY ("jobId", "number")
);
CREATE INDEX "ArchivePage_years_idx" ON "ArchivePage" USING GIN ("years");
CREATE INDEX "ArchivePage_documentId_jobId_idx" ON "ArchivePage"("documentId", "jobId");
CREATE INDEX "ArchivePage_text_search_idx" ON "ArchivePage"
  USING GIN (to_tsvector('simple'::regconfig, "text" || ' ' || "summary"));
