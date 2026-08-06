import assert from "node:assert/strict";
import test from "node:test";
import { matchFamilyRoster } from "./family-member-matcher";

const existing = [
  { id: "sandy-id", name: "William Craig", displayName: "Sandy" },
  { id: "will-id", name: "William Craig", displayName: "Will" },
  { id: "colleen-id", name: "Colleen Craig", displayName: "Colleen" },
];

test("the shared matcher prefers exact display names over ambiguous legal names", () => {
  const result = matchFamilyRoster(existing, [
    { key: "sandy", name: "William Craig", displayName: "Sandy", surname: "Craig" },
    { key: "will", name: "William Craig", displayName: "Will", surname: "Craig" },
  ]);

  assert.equal(result.matchedId.get("sandy"), "sandy-id");
  assert.equal(result.matchedId.get("will"), "will-id");
  assert.deepEqual(result.ambiguous, []);
});

test("the shared matcher refuses a bare ambiguous William Craig", () => {
  const result = matchFamilyRoster(existing, [
    { key: "william", name: "William Craig", displayName: "William Craig", surname: "Craig" },
  ]);

  assert.equal(result.matchedId.size, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.deepEqual(new Set(result.ambiguous[0].rowIds), new Set(["sandy-id", "will-id"]));
  assert.doesNotMatch(result.ambiguous[0].message, /selected|first/i);
});

test("the shared matcher falls back to one unique full name", () => {
  const result = matchFamilyRoster(existing, [
    { key: "colleen", name: "Colleen Craig", displayName: "Colleen Craig", surname: "Craig" },
  ]);

  assert.equal(result.matchedId.get("colleen"), "colleen-id");
  assert.deepEqual(result.ambiguous, []);
});
