import { PDFDocument } from "pdf-lib";

export const MAX_PDF_SAMPLE_PAGES = 10;

export interface PdfPageSample {
  buffer: Buffer;
  sourcePageCount: number;
  sampledPageNumbers: number[];
}

export class PdfSampleTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfSampleTooLargeError";
  }
}

export function spreadPageIndices(pageCount: number, maxPages: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount <= 0 || maxPages <= 0) return [];
  const sampleCount = Math.min(pageCount, Math.floor(maxPages));
  if (sampleCount === 1) return [0];
  return Array.from(
    { length: sampleCount },
    (_, index) => Math.round((index * (pageCount - 1)) / (sampleCount - 1))
  );
}

async function copyPdfPages(
  source: PDFDocument,
  pageIndices: number[]
): Promise<Buffer> {
  const sample = await PDFDocument.create();
  const copied = await sample.copyPages(source, pageIndices);
  for (const page of copied) sample.addPage(page);
  sample.setTitle("Breadloaf sampled PDF pages");
  sample.setProducer("Breadloaf Hill archive sampler");
  const bytes = await sample.save({ useObjectStreams: true });
  return Buffer.from(bytes);
}

export async function samplePdfPages(
  sourceBuffer: Buffer,
  maxBytes: number,
  maxPages = MAX_PDF_SAMPLE_PAGES
): Promise<PdfPageSample> {
  const source = await PDFDocument.load(sourceBuffer, { updateMetadata: false });
  const sourcePageCount = source.getPageCount();
  if (sourcePageCount === 0) throw new Error("PDF contains no pages");

  const desired = Math.min(sourcePageCount, Math.max(1, Math.floor(maxPages)));
  const attempts = Array.from(
    new Set([desired, 8, 6, 4, 3, 2, 1].filter((count) => count > 0 && count <= desired))
  ).sort((left, right) => right - left);

  for (const sampleCount of attempts) {
    const pageIndices = spreadPageIndices(sourcePageCount, sampleCount);
    const buffer = await copyPdfPages(source, pageIndices);
    if (buffer.length <= maxBytes) {
      return {
        buffer,
        sourcePageCount,
        sampledPageNumbers: pageIndices.map((index) => index + 1),
      };
    }
  }

  throw new PdfSampleTooLargeError(
    `Even a one-page PDF sample exceeds the ${(maxBytes / 1024 / 1024).toFixed(1)} MB AI limit.`
  );
}
