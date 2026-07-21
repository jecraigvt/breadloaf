import assert from "node:assert/strict";
import test from "node:test";
import { splitContentIntoChunks, tokenizeSearchQuery } from "./embeddings";

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
