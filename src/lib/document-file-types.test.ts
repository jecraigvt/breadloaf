import assert from "node:assert/strict";
import test from "node:test";
import {
  DOC_TYPE,
  FILE_DROPZONE_ACCEPT,
  SUPPORTED_UPLOAD_TYPES,
  XLS_TYPE,
  isAnalyzableMimeType,
  resolveSupportedFileType,
} from "./document-file-types";

test("every accepted upload type has an analysis path", () => {
  for (const type of Array.from(SUPPORTED_UPLOAD_TYPES)) {
    assert.equal(isAnalyzableMimeType(type), true, `${type} has no analysis path`);
  }
  for (const type of Object.keys(FILE_DROPZONE_ACCEPT)) {
    assert.equal(isAnalyzableMimeType(type), true, `${type} has no picker analysis path`);
  }
});

test("legacy Office extensions recover generic browser MIME types", () => {
  assert.equal(resolveSupportedFileType("application/octet-stream", "rules.doc"), DOC_TYPE);
  assert.equal(resolveSupportedFileType("", "accounts.xls"), XLS_TYPE);
});

test("PowerPoint is refused because no extraction path exists", () => {
  assert.equal(
    resolveSupportedFileType("application/vnd.ms-powerpoint", "slides.ppt"),
    null
  );
  assert.equal(
    resolveSupportedFileType(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "slides.pptx"
    ),
    null
  );
});
