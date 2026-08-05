import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryReanalysisAction,
  reanalysisTextDelta,
  shouldSkipCompletedReanalysis,
} from "./archive-reanalysis-plan";

test("reanalysis previews expose content changes without printing full text", () => {
  const delta = reanalysisTextDelta("old content", "new content");
  assert.equal(delta.changed, true);
  assert.equal(delta.beforeChars, 11);
  assert.equal(delta.afterChars, 11);
  assert.notEqual(delta.beforeFingerprint, delta.afterFingerprint);
});

test("every existing category is preserved regardless of the AI suggestion", () => {
  assert.deepEqual(
    categoryReanalysisAction({
      currentCategoryId: "human-category",
      currentCategoryName: "Corporate Filings",
      suggestedCategory: "Other",
    }),
    {
      action: "preserve",
      currentCategory: "Corporate Filings",
      suggestedCategory: "Other",
    }
  );
});

test("the journal makes apply resumable and retries failures only on request", () => {
  const entry = {
    sourceChecksum: "abc",
    analysisState: "provider_error",
    completedAt: "2026-08-05T00:00:00.000Z",
  };
  assert.equal(
    shouldSkipCompletedReanalysis({
      entry,
      sourceChecksum: "abc",
      retryFailures: false,
    }),
    true
  );
  assert.equal(
    shouldSkipCompletedReanalysis({
      entry,
      sourceChecksum: "abc",
      retryFailures: true,
    }),
    false
  );
  assert.equal(
    shouldSkipCompletedReanalysis({
      entry,
      sourceChecksum: "changed",
      retryFailures: false,
    }),
    false
  );
});
