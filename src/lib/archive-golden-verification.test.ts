import assert from "node:assert/strict";
import test from "node:test";
import {
  describeGoldenDocumentFailure,
  isGoldenDocumentReady,
} from "./archive-golden-verification";

test("a golden hit must have ok state and real analysis content", () => {
  assert.equal(
    isGoldenDocumentReady({
      analysisState: "ok",
      aiSummary: "Succession requires approval by the shareholders.",
      aiExtractedText: null,
    }),
    true
  );
  assert.equal(
    isGoldenDocumentReady({
      analysisState: "unsupported_type",
      aiSummary: null,
      aiExtractedText: null,
    }),
    false
  );
  assert.equal(
    isGoldenDocumentReady({
      analysisState: "ok",
      aiSummary: "Document uploaded — categorize manually or ask Bucky about it",
      aiExtractedText: null,
    }),
    false
  );
});

test("golden failure reasons distinguish bad state from empty content", () => {
  assert.equal(
    describeGoldenDocumentFailure({
      analysisState: "too_large",
      aiSummary: null,
      aiExtractedText: null,
    }),
    "analysisState is too_large"
  );
  assert.equal(
    describeGoldenDocumentFailure({
      analysisState: "ok",
      aiSummary: null,
      aiExtractedText: null,
    }),
    "analysisState is ok but no meaningful analysis text exists"
  );
});
