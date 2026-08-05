import assert from "node:assert/strict";
import test from "node:test";
import { parseToolArguments } from "./openai-json";

test("parses OpenAI function arguments as an object", () => {
  assert.deepEqual(parseToolArguments('{"name":"coffee","quantity":2}'), {
    name: "coffee",
    quantity: 2,
  });
});

test("rejects non-object OpenAI function arguments", () => {
  assert.throws(() => parseToolArguments('["coffee"]'), /invalid tool arguments/);
});
