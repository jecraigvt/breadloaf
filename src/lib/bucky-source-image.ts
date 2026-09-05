import { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import path from "node:path";
import type { BackgroundSourcePart } from "@/lib/bucky-background-contract";

/** Fixed pixel bounds make vision costs predictable; original bytes stay archived. */
export async function backgroundSourceImage(part: BackgroundSourcePart): Promise<string | null> {
  if (part.imageBase64) {
    if (!/^image\/(jpeg|png|webp)$/.test(part.mimeType)) throw new Error("Unsupported background image");
    const source = await loadImage(Buffer.from(part.imageBase64, "base64"));
    const scale = Math.min(1, 2200 / Math.max(source.width, source.height));
    const canvas = createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  }
  if (!part.fileBase64) return null;
  if (part.mimeType !== "application/pdf") throw new Error("Unsupported background file");
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(Buffer.from(part.fileBase64, "base64")),
    // Railway deploys node_modules with this Next server. Do not use
    // require.resolve here: webpack rewrites it to a numeric module ID.
    standardFontDataUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + path.sep,
    useSystemFonts: false, isEvalSupported: false }).promise;
  try {
    if (pdf.numPages !== 1) throw new Error("Expected one PDF page");
    const page = await pdf.getPage(1);
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(raw.width, raw.height)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
    return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  } finally { await pdf.destroy(); }
}
