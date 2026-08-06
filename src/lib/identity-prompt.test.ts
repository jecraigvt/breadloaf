import assert from "node:assert/strict";
import test from "node:test";
import {
  choicesForDoorFamily,
  claimedViaForIdentityClaim,
  shouldPromptForIdentity,
  type IdentityChoice,
} from "./identity-prompt";

const choices: IdentityChoice[] = [
  { id: "tom", displayName: "Tom", fullName: "Thomas Craig", branch: "Tom's family" },
  { id: "jeremy", displayName: "Jeremy", fullName: "Jeremy Craig", branch: "Tom's family" },
  { id: "greg", displayName: "Greg", fullName: "Gregory Craig", branch: "Greg's family" },
  { id: "forebear", displayName: "Lorenza", fullName: "Lorenza", branch: null },
];

test("the door family limits the initial identity choices", () => {
  assert.deepEqual(
    choicesForDoorFamily(choices, "Tom").map((choice) => choice.id),
    ["tom", "jeremy"]
  );
  assert.deepEqual(
    choicesForDoorFamily(choices, "Greg's family").map((choice) => choice.id),
    ["greg"]
  );
});

test("the identity prompt is driven by door, actor, and sticky-skip state", () => {
  assert.equal(
    shouldPromptForIdentity({ doorFamily: "Tom", hasActor: false, wasSkipped: false }),
    true
  );
  assert.equal(
    shouldPromptForIdentity({ doorFamily: "Tom", hasActor: true, wasSkipped: false }),
    false
  );
  assert.equal(
    shouldPromptForIdentity({ doorFamily: "Tom", hasActor: false, wasSkipped: true }),
    false
  );
  assert.equal(
    shouldPromptForIdentity({ doorFamily: null, hasActor: false, wasSkipped: false }),
    false
  );
});

test("door claims use the pin audit path while ordinary tree taps do not", () => {
  assert.equal(claimedViaForIdentityClaim("door", false), "pin");
  assert.equal(claimedViaForIdentityClaim("tree", false), "tap");
  assert.equal(claimedViaForIdentityClaim("tree", true), "pin");
});
