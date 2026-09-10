import assert from "node:assert/strict";
import test from "node:test";
import { dictationDisplaySummary, validateDictationAnalysis, type DictationSource } from "./dictation-analysis";

const transcript = "Eric repaired the southeast roof over the Great Room on August 28, 2026. Two sheets of plywood were replaced.";
const source: DictationSource = {
  key: "document:minutes", title: "April board minutes", url: "/documents/minutes", updatedAt: "2026-04-20T00:00:00.000Z",
  text: "The board decided to file an insurance claim for storm damage to the southeast roof over the Great Room.",
};
const analysis = {
  displaySummary: "Eric repaired the Great Room roof in August 2026.",
  internalSummary: "Eric repaired the southeast roof over the Great Room on August 28, 2026; two sheets of plywood were replaced.",
  connections: [{ sourceKey: source.key, confidence: "likely", explanation: "The roof work is likely related to the board's earlier claim decision, based on the same roof location; approval or payment is not established.",
    dictationEvidence: "southeast roof over the Great Room", sourceEvidence: "decided to file an insurance claim" }],
};

test("a roof/insurance hypothesis cites both sources and cannot become a confirmed fact", () => {
  const result = validateDictationAnalysis(analysis, transcript, [source]);
  assert.equal(result.connections[0].confidence, "likely");
  assert.equal(result.connections[0].sourceUrl, "/documents/minutes");
  assert.equal(result.displaySummary, analysis.displaySummary);
  assert.throws(() => validateDictationAnalysis({ ...analysis, connections: [{ ...analysis.connections[0], confidence: "confirmed" }] }, transcript, [source]));
});

test("unknown source IDs and invented evidence cannot become saved connections", () => {
  for (const replacement of [
    { sourceKey: "document:invented" }, { sourceEvidence: "The insurer approved the claim" },
    { dictationEvidence: "The insurer paid for the roof" },
  ]) {
    const result = validateDictationAnalysis({ ...analysis, connections: [{ ...analysis.connections[0], ...replacement }] }, transcript, [source]);
    assert.deepEqual(result.connections, []);
  }
});

test("model-supplied URLs and transcript replacements are discarded", () => {
  const result = validateDictationAnalysis({ ...analysis, transcript: "rewritten", connections: [{ ...analysis.connections[0], sourceUrl: "https://invented.example" }] }, transcript, [source]);
  assert.equal("transcript" in result, false);
  assert.equal(result.connections[0].sourceUrl, source.url);
  assert.equal(transcript, "Eric repaired the southeast roof over the Great Room on August 28, 2026. Two sheets of plywood were replaced.");
});

test("the display stays one sentence without changing source text or confusing initials", () => {
  assert.equal(dictationDisplaySummary("Dr. Craig repaired the pump. A second sentence."), "Dr. Craig repaired the pump.");
  assert.throws(() => validateDictationAnalysis({ ...analysis, displaySummary: "The roof was repaired. The claim was approved." }, transcript, [source]));
  assert.equal(dictationDisplaySummary(null, "Roof work"), "Recording: Roof work.");
});

test("unrelated records need no connection; refusals do not produce an analysis", () => {
  assert.deepEqual(validateDictationAnalysis({ ...analysis, connections: [] }, transcript, []).connections, []);
  assert.throws(() => validateDictationAnalysis(null, transcript, [source]));
});
