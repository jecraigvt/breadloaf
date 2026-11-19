import type { BuckyJob, Document, Prisma } from "@prisma/client";
import { archiveDriveId } from "@/lib/archive-import-format";
import { archiveScanReader } from "@/lib/archive-scan-source";
import { BackgroundDocumentResultSchema, type BackgroundDocumentResult, type BackgroundSourcePart } from "@/lib/bucky-background-contract";
import { BuckyJobError } from "@/lib/bucky-jobs";
import { prisma } from "@/lib/prisma";

export function archiveScanJob(job: Pick<BuckyJob, "kind" | "request">): boolean {
  const request = job.request as { archiveScan?: boolean } | null;
  return job.kind === "document_analysis" && request?.archiveScan === true;
}

export function pageYears(text: string): number[] {
  return [...new Set((text.match(/\b(?:1[5-9]\d{2}|20\d{2})\b/g) ?? []).map(Number))].slice(0, 64);
}

export async function archiveScanParts(job: BuckyJob, document: Document, sourceId?: string) {
  const source = await prisma.archiveImportFile.findUnique({ where: { documentId: document.id } });
  if (!source || source.driveId !== archiveDriveId(document.filePath)) throw new BuckyJobError("The scan source is unavailable.", 404);
  const count = source.pageCount ?? await archiveScanReader.pageCount(source);
  if (source.pageCount === null) {
    await prisma.archiveImportFile.updateMany({ where: { id: source.id, pageCount: null }, data: { pageCount: count } });
  }
  const descriptor = (number: number): BackgroundSourcePart => ({
    id: document.id + ":page:" + (number - 1),
    sourceId: document.id,
    fileName: document.fileName + " · page " + number,
    mimeType: document.fileType === "application/pdf" ? "image/png" : "image/jpeg",
    checksum: source.sha256,
    pageNumber: number,
  });
  if (sourceId) {
    const suffix = sourceId.match(/:page:(\d+)$/);
    const number = suffix ? Number(suffix[1]) + 1 : 0;
    if (number < 1 || number > count || descriptor(number).id !== sourceId) throw new BuckyJobError("Scan page was not found.", 404);
    return { parts: [{ ...descriptor(number), ...await archiveScanReader.render(source, number) }] };
  }
  const completed = await prisma.archivePage.findMany({ where: { jobId: job.id }, select: { number: true } });
  const done = new Set(completed.map(page => page.number));
  return { parts: Array.from({ length: count }, (_, i) => ({ ...descriptor(i + 1), read: done.has(i + 1) })) };
}

const archivePageResult = BackgroundDocumentResultSchema.extend({
  summary: BackgroundDocumentResultSchema.shape.summary.max(4000),
  extractedText: BackgroundDocumentResultSchema.shape.extractedText.max(50_000),
});

export async function checkpointArchivePage(tx: Prisma.TransactionClient, job: BuckyJob, input: { number: number; result: unknown }) {
  if (!archiveScanJob(job) || !job.sourceDocumentId) throw new BuckyJobError("This job does not read archive pages.", 403);
  const document = await tx.document.findFirst({
    where: { id: job.sourceDocumentId, deletedAt: null, accessScope: "family" },
    select: { id: true, updatedAt: true, archiveImportFile: { select: { pageCount: true } } },
  });
  if (!document || document.updatedAt.toISOString() !== job.sourceVersion) throw new BuckyJobError("The scan changed during analysis.", 409);
  if (!document.archiveImportFile?.pageCount || input.number < 1 || input.number > document.archiveImportFile.pageCount) {
    throw new BuckyJobError("Scan page was not found.", 404);
  }
  const { extractedText, summary, ...details } = archivePageResult.parse(input.result);
  await tx.archivePage.upsert({
    where: { jobId_number: { jobId: job.id, number: input.number } }, update: {},
    create: {
      jobId: job.id, documentId: document.id, number: input.number, text: extractedText, summary,
      years: pageYears(extractedText), needsReview: details.confidence < 0.75 || !extractedText.trim(), details,
    },
  });
}

export async function summarizeArchivePages(tx: Prisma.TransactionClient, job: BuckyJob, doc: Document): Promise<BackgroundDocumentResult> {
  const source = await tx.archiveImportFile.findUnique({ where: { documentId: doc.id }, select: { pageCount: true } });
  const count = await tx.archivePage.count({ where: { jobId: job.id, documentId: doc.id } });
  if (!source?.pageCount || source.pageCount !== count) throw new BuckyJobError("Some pages have yet to be read.", 409);
  // Full page text remains in the page index. Keep the legacy document summary
  // and embedding input small, even for a single PDF with thousands of pages.
  const sample = await tx.archivePage.findMany({
    where: { jobId: job.id, documentId: doc.id },
    orderBy: { number: "asc" },
    take: 6,
  });
  const first = sample[0];
  const needsReview = await tx.archivePage.count({ where: { jobId: job.id, documentId: doc.id, needsReview: true } });
  const details = first.details as Omit<BackgroundDocumentResult, "summary" | "extractedText">;
  return BackgroundDocumentResultSchema.parse({
    ...details,
    title: details.title || doc.title,
    summary: sample.slice(0, 3).map(page => (count > 1 ? "Page " + page.number + ": " : "") + page.summary).join("\n\n"),
    extractedText: sample.map(page => "Page " + page.number + "\n" + page.text).join("\n\n").slice(0, 36_000),
    confidence: needsReview ? Math.min(details.confidence, 0.74) : details.confidence,
  });
}
