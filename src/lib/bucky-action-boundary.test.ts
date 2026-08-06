import assert from "node:assert/strict";
import test from "node:test";
import { BUCKY_ACTION_BOUNDARY } from "./bucky-action-boundary";

test("unsupported actions require an honest saved-but-not-applied response", () => {
  assert.match(BUCKY_ACTION_BOUNDARY, /exactly the systems represented by your available tools/i);
  assert.match(BUCKY_ACTION_BOUNDARY, /including the family tree/i);
  assert.match(BUCKY_ACTION_BOUNDARY, /what you saved/i);
  assert.match(BUCKY_ACTION_BOUNDARY, /could not perform/i);
  assert.match(BUCKY_ACTION_BOUNDARY, /remains unapplied/i);
  assert.doesNotMatch(BUCKY_ACTION_BOUNDARY, /I(?:'ve| have) (?:updated|changed) the family tree/i);
});
