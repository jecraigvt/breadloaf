CREATE TABLE "BuckyJob" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "request" JSONB NOT NULL, "sourceDocumentId" TEXT, "sourceVersion" TEXT,
  "checkpoint" JSONB, "result" JSONB, "initiatedById" TEXT, "initiatedByName" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0, "fallbackAfter" TIMESTAMP(3) NOT NULL, "apiNotBefore" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "generation" INTEGER NOT NULL DEFAULT 0,
  "dedupeKey" TEXT, "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BuckyJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuckyJob_kind_check" CHECK ("kind" IN ('document_analysis','archive_review','site_improvement')),
  CONSTRAINT "BuckyJob_status_check" CHECK ("status" IN ('queued','running','succeeded','needs_review','failed','cancelled'))
);
CREATE TABLE "BuckyWorker" (
  "id" TEXT NOT NULL, "label" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL, "paused" BOOLEAN NOT NULL DEFAULT false, "lastSeenAt" TIMESTAMP(3),
  "quotaRemaining" DOUBLE PRECISION, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BuckyWorker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuckyWorker_provider_check" CHECK ("provider" IN ('local','api'))
);
CREATE TABLE "BuckyJobAttempt" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "workerId" TEXT NOT NULL, "generation" INTEGER NOT NULL,
  "leaseToken" TEXT NOT NULL, "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running', "reservedCents" INTEGER NOT NULL DEFAULT 0,
  "costCents" INTEGER, "budgetMonth" TEXT, "usage" JSONB, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "BuckyJobAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuckyJobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BuckyJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BuckyJobAttempt_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "BuckyWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BuckyJobAttempt_reserved_check" CHECK ("reservedCents" >= 0),
  CONSTRAINT "BuckyJobAttempt_cost_check" CHECK ("costCents" IS NULL OR "costCents" >= 0)
);
CREATE TABLE "BuckyApiBudget" (
  "month" TEXT NOT NULL, "spentCents" INTEGER NOT NULL DEFAULT 0, "reservedCents" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BuckyApiBudget_pkey" PRIMARY KEY ("month"),
  CONSTRAINT "BuckyApiBudget_nonnegative_check" CHECK ("spentCents" >= 0 AND "reservedCents" >= 0)
);
CREATE UNIQUE INDEX "BuckyJob_dedupeKey_key" ON "BuckyJob"("dedupeKey");
CREATE INDEX "BuckyJob_status_priority_nextAttemptAt_idx" ON "BuckyJob"("status", "priority", "nextAttemptAt");
CREATE INDEX "BuckyJob_sourceDocumentId_createdAt_idx" ON "BuckyJob"("sourceDocumentId", "createdAt");
CREATE INDEX "BuckyJob_fallbackAfter_idx" ON "BuckyJob"("fallbackAfter");
CREATE UNIQUE INDEX "BuckyWorker_tokenHash_key" ON "BuckyWorker"("tokenHash");
CREATE UNIQUE INDEX "BuckyJobAttempt_leaseToken_key" ON "BuckyJobAttempt"("leaseToken");
CREATE UNIQUE INDEX "BuckyJobAttempt_jobId_generation_key" ON "BuckyJobAttempt"("jobId", "generation");
CREATE INDEX "BuckyJobAttempt_workerId_status_leaseExpiresAt_idx" ON "BuckyJobAttempt"("workerId", "status", "leaseExpiresAt");
CREATE INDEX "BuckyJobAttempt_status_leaseExpiresAt_idx" ON "BuckyJobAttempt"("status", "leaseExpiresAt");
