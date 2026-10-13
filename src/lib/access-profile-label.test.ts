import assert from "node:assert/strict";
import test from "node:test";
import { accessBirthYear, accessProfileLabels, type AccessProfileIdentity } from "./access-profile-label";

const person = (id: string, changes: Partial<AccessProfileIdentity> = {}): AccessProfileIdentity => ({
  id, name: "Alex Example", branch: "North", birthday: null, relTo: [], ...changes,
});

test("same-name profiles show their stored branch and birth year without disclosing a full birthday", () => {
  const labels = accessProfileLabels([
    person("synthetic-older", { birthday: "1951-02-03" }),
    person("synthetic-younger", { birthday: "1981-09-10" }),
    person("synthetic-other-branch", { branch: "South", birthday: "1981" }),
  ]);
  assert.equal(labels.get("synthetic-older"), "Alex Example · North branch · born 1951");
  assert.equal(labels.get("synthetic-younger"), "Alex Example · North branch · born 1981");
  assert.equal(labels.get("synthetic-other-branch"), "Alex Example · South branch · born 1981");
  assert.ok(!JSON.stringify(Array.from(labels.values())).includes("02-03"));
});

test("parent names distinguish identical names and branches when birth years are absent", () => {
  const labels = accessProfileLabels([
    person("synthetic-one", { relTo: [{ from: { name: "Parent Alpha" } }, { from: { name: "Parent Beta" } }] }),
    person("synthetic-two", { relTo: [{ from: { name: "Parent Gamma" } }] }),
  ]);
  assert.equal(labels.get("synthetic-one"), "Alex Example · North branch · child of Parent Alpha & Parent Beta");
  assert.equal(labels.get("synthetic-two"), "Alex Example · North branch · child of Parent Gamma");
});

test("incomplete identical profiles retain distinct directory references without invented family facts", () => {
  const labels = accessProfileLabels([person("synthetic-one", { branch: null }), person("synthetic-two", { branch: null })]);
  assert.equal(labels.get("synthetic-one"), "Alex Example · profile synthetic-one");
  assert.equal(labels.get("synthetic-two"), "Alex Example · profile synthetic-two");
  for (const value of [null, "", "March 5", "unknown", "2099-01-01", "1950 or 1951"]) assert.equal(accessBirthYear(value), null);
  assert.equal(accessBirthYear("March 5, 1971"), 1971);
});
