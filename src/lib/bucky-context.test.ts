import assert from "node:assert/strict";
import test from "node:test";
import { mergeRetrievedKnowledge } from "./bucky-context";
import type { SearchResult } from "./embeddings";

function result(sourceId: string, chunkIndex = 0): SearchResult {
  return { sourceType: "document", sourceId, chunkIndex, content: sourceId, score: 1 };
}

test("multi-query retrieval preserves both facets and rewards corroboration", () => {
  const merged = mergeRetrievedKnowledge([
    [result("ancestry"), result("shared"), result("unrelated-a")],
    [result("shared"), result("succession"), result("unrelated-b")],
  ], 3);
  assert.deepEqual(
    merged.map((entry) => entry.sourceId),
    ["shared", "ancestry", "succession"]
  );
});
