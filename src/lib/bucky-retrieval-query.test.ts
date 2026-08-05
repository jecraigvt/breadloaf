import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRetrievalQueries } from "./bucky-retrieval-query";

test("normalizes and deduplicates up to four retrieval queries", () => {
  assert.deepEqual(
    normalizeRetrievalQueries("raw fallback", [
      "  ancestry   photos ",
      "Ancestry photos",
      "succession rules",
      "annual assessment",
      "water pressure",
      "ignored fifth query",
    ]),
    ["ancestry photos", "succession rules", "annual assessment", "water pressure"]
  );
});

test("falls back to the raw message only when no distilled query survives", () => {
  assert.deepEqual(
    normalizeRetrievalQueries("  Where is the generator?  ", ["", "   "]),
    ["Where is the generator?"]
  );
});
