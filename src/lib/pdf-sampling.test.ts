import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  PdfSampleTooLargeError,
  samplePdfPages,
  spreadPageIndices,
} from "./pdf-sampling";

test("selects an even spread including the first and last PDF pages", () => {
  const indices = spreadPageIndices(170, 10);
  assert.deepEqual(indices, [0, 19, 38, 56, 75, 94, 113, 131, 150, 169]);
});

test("builds a ten-page PDF sample from across the source", async () => {
  const source = await PDFDocument.create();
  for (let index = 0; index < 12; index++) {
    source.addPage([200 + index, 300]);
  }
  const sourceBuffer = Buffer.from(await source.save());
  const result = await samplePdfPages(sourceBuffer, 1024 * 1024);
  const sampled = await PDFDocument.load(result.buffer);

  assert.equal(result.sourcePageCount, 12);
  assert.equal(sampled.getPageCount(), 10);
  assert.deepEqual(result.sampledPageNumbers, [1, 2, 3, 5, 6, 7, 8, 10, 11, 12]);
  assert.deepEqual(
    sampled.getPages().map((page) => page.getWidth()),
    result.sampledPageNumbers.map((pageNumber) => 199 + pageNumber)
  );
});

test("reports when even one sampled page cannot fit the AI limit", async () => {
  const source = await PDFDocument.create();
  source.addPage();
  const sourceBuffer = Buffer.from(await source.save());
  await assert.rejects(
    () => samplePdfPages(sourceBuffer, 1),
    PdfSampleTooLargeError
  );
});
