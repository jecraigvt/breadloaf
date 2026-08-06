-- Recorded harness runs, so the health panel reports a measurement instead of a
-- constant. Additive only; the existing hardcoded values remain the fallback
-- until the first run is recorded.
CREATE TABLE "ArchiveVerification" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "passed" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "controlsPassed" INTEGER NOT NULL,
    "controlsTotal" INTEGER NOT NULL,
    "failures" JSONB,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArchiveVerification_suite_measuredAt_idx"
    ON "ArchiveVerification"("suite", "measuredAt");
