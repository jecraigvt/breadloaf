import assert from "node:assert/strict";
import test from "node:test";
import {
  linkedDocumentFetchUrl,
  linkedHtmlToText,
} from "./link-document-analysis";

test("Google Docs links use the public plain-text export endpoint", () => {
  assert.equal(
    linkedDocumentFetchUrl(
      "https://docs.google.com/document/d/abc123/edit?tab=t.0"
    ).toString(),
    "https://docs.google.com/document/d/abc123/export?format=txt"
  );
});

test("linked HTML extraction removes scripts and decodes visible text", () => {
  assert.equal(
    linkedHtmlToText(
      "<html><script>ignore()</script><body>Woods&nbsp;Cabin &amp; roof</body></html>"
    ),
    "Woods Cabin & roof"
  );
});

test("linked-document fetching refuses non-web protocols", () => {
  assert.throws(() => linkedDocumentFetchUrl("file:///etc/passwd"), /Unsupported link protocol/);
});
