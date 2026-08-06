import assert from "node:assert/strict";
import test from "node:test";
import {
  BulkNarrationCommitSchema,
  makeEditableNarratedMemoryItems,
  narrationSourceId,
  NarratedMemoryItemsSchema,
} from "./bulk-narration";

test("bulk narration requires one complete, typed memory per segmented item", () => {
  const parsed = NarratedMemoryItemsSchema.parse({
    items: [{
      type: "semantic",
      topic: "Box of Bestor family photographs",
      subject: "Bestor family photographs",
      location: "Attic, north wall, shelf 3",
      scope: "family",
      content: "A gray archival box contains labeled Bestor family photographs from the 1940s.",
    }],
  });

  const editable = makeEditableNarratedMemoryItems(parsed.items);
  assert.equal(editable[0].clientId, "item-1");
  assert.equal(editable[0].location, "Attic, north wall, shelf 3");
});

test("bulk narration rejects an empty segmentation instead of reporting success", () => {
  assert.equal(NarratedMemoryItemsSchema.safeParse({ items: [] }).success, false);
});

test("the commit contract rejects blank required fields and preserves stable provenance", () => {
  const invalid = BulkNarrationCommitSchema.safeParse({
    captureId: "capture-123",
    items: [{
      clientId: "item-1",
      type: "semantic",
      topic: "  ",
      subject: null,
      location: null,
      scope: "property",
      content: "Something in the attic.",
    }],
  });

  assert.equal(invalid.success, false);
  assert.equal(narrationSourceId("capture-123", "item-1"), "capture-123:item-1");
});
