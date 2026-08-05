import assert from "node:assert/strict";
import test from "node:test";
import { ARCHIVE_GOLDEN_QUESTIONS } from "./archive-golden-questions";

test("the golden set has 25 unique real questions including negative controls", () => {
  assert.equal(ARCHIVE_GOLDEN_QUESTIONS.length, 25);
  assert.equal(new Set(ARCHIVE_GOLDEN_QUESTIONS.map((item) => item.id)).size, 25);
  assert.equal(new Set(ARCHIVE_GOLDEN_QUESTIONS.map((item) => item.question)).size, 25);
  assert.equal(
    ARCHIVE_GOLDEN_QUESTIONS.filter((item) => item.expectedDocuments.length === 0).length,
    2
  );
});

test("the handoff seed questions and expected documents are preserved", () => {
  const expected = new Map([
    ["pictures of people in our ancestry", "Bestor Photos 170"],
    ["what do the bylaws say about succession", "Breadloaf Hill Corporation Bylaws"],
    ["what is our vision for the property", "Breadloaf Hill Vision"],
    ["how does inheritance work here", "History of the Inheritance Section (2013)"],
    ["when is the board meeting", "2025 Annual Board Meeting Minutes"],
    ["who mowed the meadow", "Voice Memo Jul 31 at 934 AM"],
    ["the heater will not ignite", "Archived Photo (2026-07-22) — Weil-McLain boiler"],
  ]);

  expected.forEach((title, question) => {
    const fixture = ARCHIVE_GOLDEN_QUESTIONS.find((item) => item.question === question);
    assert.ok(fixture, `missing seed question: ${question}`);
    assert.equal(fixture.expectedDocuments[0]?.title, title);
  });
  assert.deepEqual(
    ARCHIVE_GOLDEN_QUESTIONS.find(
      (item) => item.question === "purple monkey dishwasher"
    )?.expectedDocuments,
    []
  );
});
