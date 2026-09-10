-- Derived notes live separately from source transcripts, recordings and human edits.
CREATE TABLE "DictationAnalysis" (
    "filePath" TEXT NOT NULL,
    "transcriptHash" TEXT NOT NULL,
    "displaySummary" TEXT NOT NULL,
    "internalSummary" TEXT NOT NULL,
    "connections" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DictationAnalysis_pkey" PRIMARY KEY ("filePath")
);
