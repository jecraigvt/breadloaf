import assert from "node:assert/strict";
import test from "node:test";
import {
  formatArchiveCategoryDirectory,
  mergeRetrievedKnowledge,
} from "./bucky-context";
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

test("archive category directory uses exact names and family-access counts", () => {
  assert.equal(
    formatArchiveCategoryDirectory([
      { name: "Corporate Filings", _count: { documents: 9 } },
      { name: "Photos", _count: { documents: 6 } },
    ], 2),
    "- Corporate Filings (9)\n- Photos (6)\n- Unfiled / no category (2; filing state, not a category name)"
  );
});
