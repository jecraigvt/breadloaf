import assert from "node:assert/strict";
import test from "node:test";
import { needsDocumentRetitle, resolveDocumentTitle } from "./document-title";

test("keeps Bucky's descriptive title", () => {
  assert.equal(
    resolveDocumentTitle({
      suggestedTitle: "2025 Vermont Property Tax Bill",
      fileName: "scan003.pdf",
    }),
    "2025 Vermont Property Tax Bill"
  );
});

test("replaces a camera filename with a content-based title", () => {
  assert.equal(
    resolveDocumentTitle({
      suggestedTitle: "IMG_4821.jpg",
      fileName: "IMG_4821.jpg",
      summary: "This photo shows the well pump pressure tank and shutoff valve.",
      fileType: "image/jpeg",
    }),
    "Well pump pressure tank and shutoff valve"
  );
});

test("humanizes a useful filename when Bucky is unavailable", () => {
  assert.equal(
    resolveDocumentTitle({
      suggestedTitle: "2025-property-tax-bill.pdf",
      fileName: "2025-property-tax-bill.pdf",
      fileType: "application/pdf",
    }),
    "2025 Property Tax Bill"
  );
});

test("uses an honest review title when no content is available", () => {
  assert.equal(
    resolveDocumentTitle({
      suggestedTitle: "Voice Memo 7.m4a",
      fileName: "Voice Memo 7.m4a",
      fileType: "audio/m4a",
      createdAt: "2026-07-20T12:00:00.000Z",
    }),
    "Voice Memo (2026-07-20)"
  );
});

test("does not turn an intake status message into a title", () => {
  assert.equal(
    resolveDocumentTitle({
      suggestedTitle: "a6a9b27a-dcc4-49f3-97b7-aa1453bb6355.docx",
      fileName: "a6a9b27a-dcc4-49f3-97b7-aa1453bb6355.docx",
      summary: "Document uploaded — categorize manually or ask Bucky about it",
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      createdAt: "2026-07-20T12:00:00.000Z",
    }),
    "Archived Document (2026-07-20)"
  );
});

test("flags raw filenames and generic labels for backfill", () => {
  assert.equal(needsDocumentRetitle("scan003.pdf", "scan003.pdf"), true);
  assert.equal(needsDocumentRetitle("Untitled Document", "taxes.pdf"), true);
  assert.equal(needsDocumentRetitle("2025 Vermont Property Tax Bill", "scan003.pdf"), false);
});
