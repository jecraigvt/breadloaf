import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSemanticCandidates,
  filterKeywordCandidates,
  fuseSearchResults,
  memoryIndexContent,
  rankHybridSearchCandidates,
  splitContentIntoChunks,
  tokenizeSearchQuery,
  type SearchResult,
} from "./embeddings";

test("keeps short knowledge in one chunk", () => {
  assert.deepEqual(splitContentIntoChunks("Well pump reset button is behind the blue cover."), [
    "Well pump reset button is behind the blue cover.",
  ]);
});

test("splits long sources into bounded overlapping chunks", () => {
  const content = Array.from({ length: 900 }, (_, index) => `Sentence ${index} describes the property system.`).join(" ");
  const chunks = splitContentIntoChunks(content);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 3600));
  assert.ok(chunks.join(" ").length > content.length, "overlap should preserve boundary context");
});

test("keyword terms retain useful exact identifiers", () => {
  assert.deepEqual(
    tokenizeSearchQuery("What do we know about Grundfos SQ 5-70 in the well?"),
    ["grundfos", "5-70", "well"]
  );
});

test("keyword terms discard short common words that caused substring noise", () => {
  assert.deepEqual(tokenizeSearchQuery("the heater will not ignite"), ["heater", "ignite"]);
  assert.deepEqual(tokenizeSearchQuery("who handles the insurance renewal?"), ["insurance", "renewal"]);
});

test("memory indexing preserves the dedicated physical location", () => {
  const content = memoryIndexContent({
    topic: "Box of Bestor photographs",
    type: "semantic",
    subject: "Bestor family",
    location: "Attic, north wall, shelf 3",
    scope: "family",
    content: "A gray box of labeled photographs from the 1940s.",
    source: "Bulk narration by Jim Craig",
  });

  assert.match(content, /Location: Attic, north wall, shelf 3/);
});

function result(sourceId: string, score: number): SearchResult {
  return { sourceType: "document", sourceId, chunkIndex: 0, content: sourceId, score };
}

test("semantic filtering uses the query's top score rather than an absolute model constant", () => {
  assert.deepEqual(
    filterSemanticCandidates([
      result("heating", 0.252),
      result("photo", 0.225),
      result("directory", 0.17),
    ], true).map((entry) => entry.sourceId),
    ["heating", "photo"]
  );
  assert.deepEqual(
    filterSemanticCandidates([
      result("strong", 0.64),
      result("weak", 0.27),
    ], true).map((entry) => entry.sourceId),
    ["strong"]
  );
});

test("uncorroborated semantic noise must stand out from its runner-up", () => {
  assert.deepEqual(
    filterSemanticCandidates([
      result("purple-photo", 0.277),
      result("monkey-photo", 0.252),
      result("dishwasher-memory", 0.25),
      result("photo-two", 0.242),
      result("photo-three", 0.236),
    ], false),
    []
  );
  assert.deepEqual(
    filterSemanticCandidates([
      result("clear-semantic-match", 0.64),
      result("runner-up", 0.27),
      result("third", 0.25),
      result("fourth", 0.24),
      result("fifth", 0.22),
    ], false).map((entry) => entry.sourceId),
    ["clear-semantic-match"]
  );
});

test("retrieval guards can be evaluated against the same raw candidates", () => {
  const candidates = {
    semantic: [
      result("target", 0.3),
      result("runner-up", 0.27),
      result("third", 0.26),
      result("fourth", 0.25),
      result("fifth", 0.24),
    ],
    keyword: [],
  };
  assert.deepEqual(
    rankHybridSearchCandidates(candidates, 3, {
      relativeSemanticFloor: 0.72,
      uncorroboratedTopSpread: 1.2,
    }).map((entry) => entry.sourceId),
    ["target", "runner-up", "third"]
  );
  assert.deepEqual(
    rankHybridSearchCandidates(candidates, 3, {
      relativeSemanticFloor: 0.72,
      uncorroboratedTopSpread: 1.3,
    }),
    []
  );
});

test("keyword retrieval requires enough of the query to be grounded", () => {
  assert.deepEqual(filterKeywordCandidates([result("dishwasher-only", 0.32)]), []);
  assert.deepEqual(
    filterKeywordCandidates([result("heater-and-ignite", 0.8)]).map((entry) => entry.sourceId),
    ["heater-and-ignite"]
  );
});

test("a weak keyword match cannot erase a clear semantic lead", () => {
  const fused = fuseSearchResults(
    [result("heating", 0.252), result("photo", 0.225)],
    [result("photo", 0.45), result("directory", 0.4)]
  );
  assert.deepEqual(fused.map((entry) => entry.sourceId), ["heating", "photo", "directory"]);
});
