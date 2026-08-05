import assert from "node:assert/strict";
import test from "node:test";
import {
  distinctiveTitleWords,
  leakedTitleWords,
  verificationPassRate,
} from "./archive-verification";

test("derived questions cannot borrow distinctive title words", () => {
  const forbidden = distinctiveTitleWords(
    "Emergency Generator Operating Instructions"
  );
  assert.deepEqual(forbidden, ["emergency", "generator", "operating"]);
  assert.deepEqual(
    leakedTitleWords("How do I operate the emergency generator?", forbidden),
    ["emergency", "generator"]
  );
  assert.deepEqual(
    leakedTitleWords("How do I connect backup power to the electrical panel?", forbidden),
    []
  );
});

test("negative controls count in the same pass-rate denominator", () => {
  const documentResults = [{ passed: true }, { passed: false }];
  const negativeControls = [{ passed: true }, { passed: false }];
  assert.equal(
    verificationPassRate([...documentResults, ...negativeControls]),
    50
  );
});
