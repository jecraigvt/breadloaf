-- Tiered Bucky memory: lifecycle-aware durable memories and chunked retrieval.
ALTER TABLE "JarvisMemory"
    ADD COLUMN "sourceType" TEXT,
    ADD COLUMN "sourceId" TEXT,
    ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'property',
    ADD COLUMN "subject" TEXT,
    ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    ADD COLUMN "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    ADD COLUMN "validFrom" TIMESTAMP(3),
    ADD COLUMN "validUntil" TIMESTAMP(3),
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN "supersededById" TEXT,
    ADD COLUMN "lastUsedAt" TIMESTAMP(3),
    ADD COLUMN "useCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "accessScope" TEXT NOT NULL DEFAULT 'family';

CREATE INDEX "JarvisMemory_status_accessScope_idx" ON "JarvisMemory"("status", "accessScope");
CREATE INDEX "JarvisMemory_scope_subject_idx" ON "JarvisMemory"("scope", "subject");
CREATE INDEX "JarvisMemory_validUntil_idx" ON "JarvisMemory"("validUntil");

ALTER TABLE "Embedding"
    ADD COLUMN "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "Embedding_sourceType_sourceId_key";
CREATE UNIQUE INDEX "Embedding_sourceType_sourceId_chunkIndex_key"
    ON "Embedding"("sourceType", "sourceId", "chunkIndex");
CREATE INDEX "Embedding_sourceType_sourceId_idx" ON "Embedding"("sourceType", "sourceId");
