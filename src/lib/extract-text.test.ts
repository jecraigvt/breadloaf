import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  DOC_TYPE,
  DOCX_TYPE,
  XLS_TYPE,
} from "./document-file-types";
import { extractTextFromFile, isExtractableType } from "./extract-text";

test("legacy Word and Excel MIME types are extractable", () => {
  assert.equal(isExtractableType(DOC_TYPE), true);
  assert.equal(isExtractableType(XLS_TYPE), true);
});

test("extracts rows from a generated legacy XLS workbook", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Vendor", "Amount"],
    ["Ripton Hardware", 125.5],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Expenses");
  const buffer = XLSX.write(workbook, { bookType: "xls", type: "buffer" });

  const extracted = await extractTextFromFile(buffer, XLS_TYPE);
  assert.match(extracted || "", /Sheet: Expenses/);
  assert.match(extracted || "", /Ripton Hardware\t125\.5/);
});

test("a structurally valid but empty DOCX has no extractable content", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r/></w:p></w:body></w:document>'
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  assert.equal(await extractTextFromFile(buffer, DOCX_TYPE), null);
});
