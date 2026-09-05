import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { BuckyJob, Document, Prisma } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/archive-integrity";
import { extractTextFromFile } from "@/lib/extract-text";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { resolveDocumentTitle } from "@/lib/document-title";
import { closeOpenArchiveQuestions } from "@/lib/archive-questions";
import { BuckyJobError } from "@/lib/bucky-jobs";
import { BackgroundResultSchema, backgroundResultJsonSchema, splitBackgroundText,
  type BackgroundSourceBundle, type BackgroundSourcePart } from "@/lib/bucky-background-contract";

export function jobRequest(job: Pick<BuckyJob, "request">): Record<string, unknown> {
  return job.request && typeof job.request === "object" && !Array.isArray(job.request) ? job.request as Record<string, unknown> : {};
}
export function jobDocumentIds(job: Pick<BuckyJob, "request" | "sourceDocumentId">): string[] {
  const ids = jobRequest(job).sourceDocumentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : job.sourceDocumentId ? [job.sourceDocumentId] : [];
}

async function originalBytes(doc: Document): Promise<Buffer> {
  if (!doc.filePath.startsWith("/uploads/")) throw new BuckyJobError("This source has no retained original file. Re-upload it for background analysis.", 422);
  const root = await realpath(path.join(process.cwd(), "public", "uploads"));
  const file = await realpath(path.join(root, doc.filePath.slice("/uploads/".length)));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new BuckyJobError("Invalid source file", 403);
  const bytes = await readFile(file);
  if (bytes.length > 100 * 1024 * 1024) throw new BuckyJobError("Source exceeds the 100 MB processing limit", 422);
  if (doc.checksum && sha256(bytes) !== doc.checksum) throw new BuckyJobError("Original file checksum does not match the archive", 409);
  return bytes;
}

async function documentParts(doc: Document, wanted?: string): Promise<BackgroundSourcePart[]> {
  const base = { sourceId: doc.id, fileName: doc.fileName, checksum: doc.checksum ?? undefined };
  if (doc.fileType.startsWith("audio/") || doc.fileType.startsWith("video/") || !doc.filePath.startsWith("/uploads/")) {
    const text = doc.aiExtractedText;
    if (!text) throw new BuckyJobError("This source needs standard upload or transcription before background analysis", 422);
    return splitBackgroundText(text).map((part, i) => ({ ...base, id: `${doc.id}:text:${i}`, mimeType: "text/plain", ...(wanted === `${doc.id}:text:${i}` ? { text: part } : {}) }));
  }
  const bytes = await originalBytes(doc);
  if (doc.fileType === "application/pdf") {
    const pdf = await PDFDocument.load(bytes);
    if (!pdf.getPageCount() || pdf.getPageCount() > 500) throw new BuckyJobError("Background PDFs must contain between 1 and 500 pages", 422);
    const parts: BackgroundSourcePart[] = [];
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const part: BackgroundSourcePart = { ...base, id: `${doc.id}:page:${i}`, fileName: `page-${i + 1}.pdf`, mimeType: "application/pdf" };
      if (wanted === part.id) {
        const single = await PDFDocument.create();
        const [page] = await single.copyPages(pdf, [i]); single.addPage(page);
        part.fileBase64 = Buffer.from(await single.save()).toString("base64");
      }
      parts.push(part);
    }
    return parts;
  }
  if (doc.fileType.startsWith("image/")) {
    const id = `${doc.id}:page:0`;
    return [{ ...base, id, mimeType: doc.fileType, ...(wanted === id ? { imageBase64: bytes.toString("base64") } : {}) }];
  }
  const text = await extractTextFromFile(bytes, doc.fileType, { maxChars: Infinity, maxRowsPerSheet: Infinity });
  return splitBackgroundText(text ?? "").map((part, i) => ({ ...base, id: `${doc.id}:text:${i}`, mimeType: "text/plain", ...(wanted === `${doc.id}:text:${i}` ? { text: part } : {}) }));
}

export async function prepareJobSource(job: BuckyJob, sourceId?: string) {
  const request = jobRequest(job);
  const kind = BackgroundResultSchema.options.find((s) => s.shape.kind.value === job.kind)?.shape.kind.value;
  if (!kind) throw new BuckyJobError("Unsupported job kind", 400);
  const bundle: BackgroundSourceBundle = { jobId: job.id, kind,
    instructions: typeof request.instructions === "string" ? request.instructions : "Read the complete source. Summarize its purpose and important facts, preserve original text, and suggest an existing category. State uncertainty explicitly.",
    categories: [], parts: [], resultSchema: backgroundResultJsonSchema(kind) };
  if (kind === "site_improvement") {
    bundle.parts = [{ id: `${job.id}:text:0`, sourceId: job.id, mimeType: "text/plain", text: bundle.instructions }];
  } else {
    const ids = jobDocumentIds(job);
    const docs = await prisma.document.findMany({ where: { id: { in: ids }, accessScope: "family", deletedAt: null } });
    if (!ids.length || docs.length !== ids.length) throw new BuckyJobError("A source was removed or its access changed", 409);
    if (kind === "document_analysis") {
      if (docs.length !== 1) throw new BuckyJobError("Document jobs require exactly one source", 400);
      if (job.sourceVersion && docs[0].updatedAt.toISOString() !== job.sourceVersion) throw new BuckyJobError("The document changed. Start a fresh analysis from the archive.", 409);
      bundle.categories = await prisma.category.findMany({ select: { name: true, description: true }, orderBy: { name: "asc" } });
      bundle.parts = await documentParts(docs[0], sourceId);
    } else {
      // Archive reviews are recommendations grounded in current archive records.
      // Each source is separate so long archives are never silently clipped.
      for (const id of ids) {
        const doc = docs.find((d) => d.id === id)!;
        const text = JSON.stringify({ sourceId: doc.id, title: doc.title, categoryId: doc.categoryId, analysisState: doc.analysisState, summary: doc.aiSummary, description: doc.description });
        bundle.parts.push(...splitBackgroundText(text).map((part, i) => ({ sourceId: doc.id, id: `${doc.id}:text:${i}`, mimeType: "text/plain", ...(sourceId === `${doc.id}:text:${i}` ? { text: part } : {}) })));
      }
    }
  }
  if (sourceId) {
    bundle.parts = bundle.parts.filter((part) => part.id === sourceId);
    if (!bundle.parts.length) throw new BuckyJobError("Source part not found", 404);
  }
  return { body: JSON.stringify(bundle), contentType: "application/json" };
}

/** Runs inside the queue's fenced completion transaction. No external calls here. */
export async function applyJobResult(tx: Prisma.TransactionClient, job: BuckyJob, input: Prisma.InputJsonValue): Promise<{ status: "succeeded" | "needs_review"; result: Prisma.InputJsonValue }> {
  const result = BackgroundResultSchema.parse(input);
  if (result.kind !== job.kind) throw new BuckyJobError("Result kind does not match the job", 400);
  if (result.kind === "site_improvement") return { status: "needs_review", result };
  if (result.kind === "archive_review") {
    const ids = jobDocumentIds(job);
    if (result.findings.some((finding) => finding.sourceId && !ids.includes(finding.sourceId))) throw new BuckyJobError("Review cites an unattached source", 400);
    return { status: "needs_review", result };
  }
  const id = job.sourceDocumentId;
  if (!id) throw new BuckyJobError("Missing source document", 400);
  await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`;
  const doc = await tx.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt || doc.accessScope !== "family" || doc.updatedAt.toISOString() !== job.sourceVersion) {
    return { status: "needs_review", result: { ...result, reviewReason: "The source changed during processing. Review this result before applying it." } };
  }
  const category = doc.categoryId ? null : await resolveDocumentCategory({ suggestedCategory: result.suggestedCategory, confidence: result.confidence }, tx);
  const newUpload = jobRequest(job).newUpload === true && doc.analysisState === "pending";
  const updated = await tx.document.update({ where: { id }, data: {
    aiSummary: result.summary, aiExtractedText: result.extractedText, analysisState: "ok", analysisError: null,
    ...(newUpload ? { title: resolveDocumentTitle({ suggestedTitle: result.title, fileName: doc.fileName, summary: result.summary, extractedText: result.extractedText }), tags: result.tags.join(", ") } : {}),
    ...(category?.categoryId ? { categoryId: category.categoryId } : {}),
  } });
  const questions = category?.categoryName ? await closeOpenArchiveQuestions(tx, { documentId: id, categoryName: category.categoryName, answeredBy: "Bucky background analysis" }) : { before: [], after: [] };
  const snapshot = (document: Document, questionSnapshots: unknown) => JSON.parse(JSON.stringify({
    documentId: document.id, title: document.title, categoryId: document.categoryId, tags: document.tags,
    aiSummary: document.aiSummary, aiExtractedText: document.aiExtractedText, analysisState: document.analysisState,
    analysisError: document.analysisError, updatedAt: document.updatedAt, questions: questionSnapshots,
  })) as Prisma.InputJsonValue;
  await tx.buckyLedgerEntry.create({ data: {
    actionType: "background_document_analysis", summary: `Analyzed ${updated.title}`,
    initiatedBy: job.initiatedByName, entityType: "document", entityId: id,
    sourceType: "background_job", sourceId: job.id,
    beforeState: snapshot(doc, questions.before),
    afterState: snapshot(updated, questions.after),
    reversible: true,
  } });
  // This durable marker is an outbox. An interrupted embedding update is retried
  // by the fallback scheduler; indexDocument is idempotent.
  return { status: category?.needsReview ? "needs_review" : "succeeded", result: { ...result, documentId: id, indexPending: true } };
}

export async function flushBuckyJobEffects(limit = 2) {
  const { indexDocument } = await import("@/lib/embeddings");
  const jobs = await prisma.buckyJob.findMany({ where: {
    status: { in: ["succeeded", "needs_review"] }, result: { path: ["indexPending"], equals: true },
  }, take: limit, orderBy: { updatedAt: "asc" } });
  for (const job of jobs) {
    const result = job.result as Record<string, Prisma.JsonValue>;
    if (typeof result.documentId !== "string") continue;
    const doc = await prisma.document.findFirst({ where: { id: result.documentId, deletedAt: null, accessScope: "family" } });
    if (!doc) { await prisma.buckyJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { result: { ...result, indexPending: false } } }); continue; }
    try {
      await indexDocument(doc.id, { throwOnError: true });
      await prisma.buckyJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { result: { ...result, indexPending: false } } });
    } catch { /* The next scheduler tick retries; original and analysis remain saved. */ }
  }
}
