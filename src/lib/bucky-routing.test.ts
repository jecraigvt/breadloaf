import assert from "node:assert/strict";
import test from "node:test";
import { selectAssistantModelTier } from "./bucky-routing";

test("uses Flash for ordinary actions and lookups", () => {
  assert.equal(selectAssistantModelTier("Add milk to the grocery list"), "flash");
  assert.equal(selectAssistantModelTier("How much did the roof cost?"), "flash");
  assert.equal(selectAssistantModelTier("Review the roof warranty"), "flash");
});

test("reserves Pro for explicit heavy analysis", () => {
  assert.equal(selectAssistantModelTier("Give me a comprehensive analysis of all expense records"), "pro");
  assert.equal(selectAssistantModelTier("Compare all documents across the last five years"), "pro");
  assert.equal(selectAssistantModelTier("Build a scenario analysis for the renovation"), "pro");
});
