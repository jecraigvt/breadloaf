import assert from "node:assert/strict";
import test from "node:test";
import { questionShapeProblem } from "./archive-roundtrip-question";

test("round-trip questions reject structured or multilingual output debris", () => {
  assert.equal(questionShapeProblem("Which numbered line supplies the washer?"), null);
  assert.match(
    questionShapeProblem("Which line supplies the washer?} final only JSON.?") || "",
    /complete question|structured-output debris/
  );
  assert.match(
    questionShapeProblem("Which line supplies the washer 中国文?") || "",
    /non-Latin output debris/
  );
});
