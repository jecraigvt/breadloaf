import { open } from "node:fs/promises";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { containedRetainedPath, retainedPathName } from "./retained-file-security";
import { DOC_TYPE, DOCX_TYPE, normalizeMimeType, resolveSupportedFileType } from "./document-file-types";
import { extractTextFromFile } from "./extract-text";

export const DOCUMENT_TEXT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TEXT_MAX_CHARS = 200000;
const DOCX_EXPANDED_MAX_BYTES = 20 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 1000;
const TEXT_TYPES = new Set([DOC_TYPE, DOCX_TYPE, "text/plain"]);
export const documentTextHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

class OriginalTextError extends Error {
  constructor(readonly status: number) { super("Original text is unavailable"); }
}
export function documentTextError(status: number) {
  const error = status === 415 ? "Text view supports Word documents and plain text only."
    : status === 413 ? "This original is too large for the text view. Download it to read it."
      : status === 422 ? "Text could not be extracted from this original. Download it to read it."
        : status >= 500 ? "Original text is temporarily unavailable. Please try again."
      : "Original text is unavailable. Download the original if it is still available.";
  return NextResponse.json({ error }, { status, headers: documentTextHeaders });
}

async function readBoundedOriginal(filePath: string, root?: string): Promise<Buffer> {
  const resolved = await containedRetainedPath(filePath, root);
  const file = await open(resolved, "r");
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new OriginalTextError(404);
    if (before.size > DOCUMENT_TEXT_MAX_BYTES) throw new OriginalTextError(413);
    // Bound the read itself as well as stat: a concurrent growth cannot allocate
    // beyond this limit or silently present a partial binary Word document.
    const buffer = Buffer.alloc(DOCUMENT_TEXT_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const next = await file.read(buffer, length, buffer.length - length, length);
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    if (length > DOCUMENT_TEXT_MAX_BYTES) throw new OriginalTextError(413);
    const after = await file.stat();
    if (length !== after.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new OriginalTextError(404);
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

/** Word XML is compressed: enforce actual expansion before handing it to Mammoth. */
async function boundDocxExpansion(buffer: Buffer) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new OriginalTextError(422); }
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > DOCX_MAX_ENTRIES) throw new OriginalTextError(413);
  if (!zip.file("word/document.xml")) throw new OriginalTextError(422);
  let declaredTotal = 0;
  for (const entry of entries) {
    const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0) throw new OriginalTextError(422);
    declaredTotal += size!;
    if (declaredTotal > DOCX_EXPANDED_MAX_BYTES) throw new OriginalTextError(413);
  }
  let expandedTotal = 0;
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as JSZip.JSZipObject & { internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
      stream.on("data", (chunk: Uint8Array) => {
        expandedTotal += chunk.byteLength;
        if (expandedTotal > DOCX_EXPANDED_MAX_BYTES) { stream.pause(); reject(new OriginalTextError(413)); }
      }).on("error", () => reject(new OriginalTextError(422))).on("end", () => resolve()).resume();
    });
  }
}

/** Caller must authorize the current document and every shared source first.
 * The view always derives from retained bytes, never AI or archived extracted text. */
export async function retainedDocumentTextView(file: { title: string; fileName: string; filePath: string; fileType: string }, root?: string) {
  try {
    const name = retainedPathName(file.filePath);
    const type = resolveSupportedFileType("", name);
    const declared = normalizeMimeType(file.fileType);
    if (!type || !TEXT_TYPES.has(type) || declared && declared !== "application/octet-stream" && declared !== type) return documentTextError(415);
    const buffer = await readBoundedOriginal(file.filePath, root);
    if (type === DOCX_TYPE) await boundDocxExpansion(buffer);
    const extracted = await extractTextFromFile(buffer, type, { maxChars: DOCUMENT_TEXT_MAX_CHARS + 1 });
    if (extracted === null) return documentTextError(422);
    return NextResponse.json({ title: file.title, fileName: file.fileName, text: extracted.slice(0, DOCUMENT_TEXT_MAX_CHARS),
      truncated: extracted.length > DOCUMENT_TEXT_MAX_CHARS }, { headers: documentTextHeaders });
  } catch (error) {
    return documentTextError(error instanceof OriginalTextError ? error.status : 404);
  }
}
