import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { BackgroundDocumentResultSchema, backgroundResultJsonSchema, combineDocumentParts, splitBackgroundText } from "./bucky-background-contract";
import { backgroundSourceImage } from "./bucky-source-image";
import { backgroundApiUpperBoundCents, backgroundApiCostCents } from "./bucky-api-cost";
import { createCanvas, loadImage } from "@napi-rs/canvas";

test("long Unicode source text survives chunking and aggregation", () => {
  const text = "Réparation — 水 🚰.\n".repeat(1500);
  const chunks = splitBackgroundText(text);
  assert.equal(chunks.join(""), text);
  const results = chunks.map((chunk) => BackgroundDocumentResultSchema.parse({ kind: "document_analysis", title: "Pump Notes", summary: "Service notes.", extractedText: chunk, tags: ["pump"], suggestedCategory: "Maintenance", confidence: 0.8 }));
  const combined = combineDocumentParts(results);
  assert.equal(combined.extractedText, results.map((part, i) => `Section ${i + 1}\n${part.extractedText}`).join("\n\n"));
  assert.deepEqual(combined.tags, ["pump"]);
  assert.throws(() => splitBackgroundText("x".repeat(2000001)), /exceeds/);
  assert.throws(() => splitBackgroundText(" "), /no readable/);
});

test("strict output schema requires nullable source references", () => {
  const schema = backgroundResultJsonSchema("archive_review") as { properties: { findings: { items: { required: string[] } } } };
  assert.ok(schema.properties.findings.items.required.includes("sourceId"));
});

test("paid cost bounds count bytes and bounded image capacity", () => {
  assert.equal(backgroundApiCostCents(1000000, 1000000), 1400);
  assert.ok(backgroundApiUpperBoundCents("水".repeat(12000), 4096, 1) > backgroundApiUpperBoundCents("x".repeat(12000), 4096, 0));
  assert.ok(backgroundApiUpperBoundCents("x".repeat(16000), 4096, 1) <= 25);
});

test("PDF fallback rasterizes one original page without a provider call", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 400]).drawText("Pump service test page", { x: 20, y: 350, font, size: 12 });
  const image = await backgroundSourceImage({ id: "test:page:0", mimeType: "application/pdf", fileBase64: Buffer.from(await pdf.save()).toString("base64") });
  assert.ok(image && image.startsWith("data:image/png;base64,"));
  assert.ok(image.length > 1000);
  const decoded = await loadImage(Buffer.from(image.split(",")[1], "base64"));
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext("2d"); context.drawImage(decoded, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100 && pixels[i + 3] > 200) dark++;
  assert.ok(dark > 100, "Raster contains visible text, not a blank PDF page");
  pdf.addPage([300, 400]);
  await assert.rejects(backgroundSourceImage({ id: "bad", mimeType: "application/pdf", fileBase64: Buffer.from(await pdf.save()).toString("base64") }), /Expected one PDF page/);
});
