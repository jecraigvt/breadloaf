import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_SIZE_LIMIT,
  classifyHistoricalAnalysis,
  isHistoricalAnalysisPlaceholder,
  meaningfulAnalysisContent,
  normalizeStoredAnalysis,
} from "./document-analysis";

test("recognizes both historical intake placeholders as non-content", () => {
  assert.equal(
    isHistoricalAnalysisPlaceholder(
      "Document uploaded — categorize manually or ask Bucky about it"
    ),
    true
  );
  assert.equal(
    isHistoricalAnalysisPlaceholder(
      "File too large for AI analysis — categorize manually"
    ),
    true
  );
  assert.equal(
    meaningfulAnalysisContent(
      "Document uploaded — categorize manually or ask Bucky about it",
      null
    ),
    ""
  );
});

test("never stores AI content for a failed analysis", () => {
  assert.deepEqual(
    normalizeStoredAnalysis({
      analysisState: "unsupported_type",
      analysisError: "Legacy Word files are unsupported.",
      aiSummary: "Document uploaded — categorize manually or ask Bucky about it",
      aiExtractedText: "",
    }),
    {
      analysisState: "unsupported_type",
      analysisError: "Legacy Word files are unsupported.",
      aiSummary: null,
      aiExtractedText: null,
    }
  );
  assert.equal(
    normalizeStoredAnalysis({ analysisState: "ok", aiSummary: null }).analysisState,
    "provider_error"
  );
});

test("classifies historical content and each failure state", () => {
  assert.deepEqual(
    classifyHistoricalAnalysis({
      fileType: "application/pdf",
      fileSize: 100,
      aiSummary: "A real summary of the annual meeting.",
    }),
    { state: "ok", error: null }
  );
  assert.equal(
    classifyHistoricalAnalysis({
      fileType: "application/pdf",
      fileSize: AI_SIZE_LIMIT + 1,
    }).state,
    "too_large"
  );
  assert.equal(
    classifyHistoricalAnalysis({
      fileType: "application/msword",
      fileSize: 100,
      aiSummary: "Document uploaded — categorize manually or ask Bucky about it",
    }).state,
    "unsupported_type"
  );
  assert.equal(
    classifyHistoricalAnalysis({
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileSize: 100,
      aiSummary: "Document uploaded — categorize manually or ask Bucky about it",
    }).state,
    "provider_error"
  );
});
