import assert from "node:assert/strict";
import test from "node:test";
import { buildLedgerInput, stripToolAuditMetadata } from "./bucky-ledger";

test("logs a successful future tool even without a custom summary", () => {
  const entry = buildLedgerInput(
    "future_tool",
    {},
    { success: true, item: { id: "item-1" } },
    "Craig family"
  );
  assert.equal(entry?.summary, "Completed: Future tool");
  assert.equal(entry?.entityId, "item-1");
});

test("does not log failed tool calls", () => {
  assert.equal(buildLedgerInput("future_tool", {}, { success: false }), null);
});

test("only advertises undo for actions with implemented handlers", () => {
  const unsupported = buildLedgerInput("save_asset", {}, {
    success: true,
    _audit: { reversible: true, beforeState: { name: "Old" }, afterState: { name: "New" } },
  });
  const supported = buildLedgerInput("set_document_category", {}, {
    success: true,
    document: { id: "doc-1", title: "Deed" },
    category: "Legal",
    _audit: {
      entityType: "document",
      entityId: "doc-1",
      reversible: true,
      beforeState: { documentId: "doc-1", categoryId: null },
      afterState: { documentId: "doc-1", categoryId: "legal" },
    },
  });

  assert.equal(unsupported?.reversible, false);
  assert.equal(supported?.reversible, true);
  assert.deepEqual(stripToolAuditMetadata({ success: true, _audit: { reversible: true } }), { success: true });
});
