import type { ActorContext } from "@/lib/actor";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/archive-integrity";
import { storeFileBuffer, STORED_FILE_SIZE_LIMIT } from "@/lib/file-storage";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { enqueueBuckyJob, BuckyJobError } from "@/lib/bucky-jobs";

export async function queueExistingDocument(id: string, actor: ActorContext | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`;
    const doc = await tx.document.findFirst({ where: { id, deletedAt: null, accessScope: "family" } });
    if (!doc) throw new BuckyJobError("Document is unavailable for background analysis", 404);
    return enqueueBuckyJob({ kind: "document_analysis", sourceDocumentId: doc.id,
      sourceVersion: doc.updatedAt.toISOString(),
      request: { title: doc.title, sourceDocumentIds: [doc.id], newUpload: doc.analysisState === "pending" },
      initiatedById: actor?.memberId, initiatedByName: actor?.displayName,
      dedupeKey: `analysis:${doc.id}:${doc.updatedAt.toISOString()}` }, tx);
  });
}

export function validateBackgroundFile(file: { name: string; type: string; size: number }) {
  const type = resolveSupportedFileType(file.type, file.name);
  if (!type || type.startsWith("audio/") || type.startsWith("video/")) {
    throw new BuckyJobError("Background analysis supports documents and images. Use the standard upload for recordings.", 400);
  }
  if (type === "image/heic") throw new BuckyJobError("Convert HEIC photos to JPEG or use the standard upload", 400);
  if (!file.size || file.size > STORED_FILE_SIZE_LIMIT) throw new BuckyJobError("Each file must be between 1 byte and 100 MB", 400);
  return type;
}

/** Retain original bytes and queue atomically with the archive row; no model call. */
export async function queueBackgroundUpload(file: File, actor: ActorContext | null) {
  const fileType = validateBackgroundFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = sha256(buffer);
  const stored = await storeFileBuffer({ buffer, fileName: file.name, contentType: fileType });
  return prisma.$transaction(async (tx) => {
    // Checksums lack a unique constraint in the legacy archive. Lock this checksum
    // so simultaneous background retries cannot create duplicate rows.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${checksum}, 0))`;
    let doc = await tx.document.findFirst({ where: { checksum, deletedAt: null, accessScope: "family" } });
    if (!doc) doc = await tx.document.create({ data: {
      title: file.name.slice(0, 300), fileName: stored.fileName, filePath: stored.filePath,
      fileType, fileSize: stored.fileSize, checksum, analysisState: "pending",
      analysisError: null, uploadedBy: actor?.displayName, accessScope: "family",
    } });
    const job = await enqueueBuckyJob({ kind: "document_analysis", sourceDocumentId: doc.id,
      sourceVersion: doc.updatedAt.toISOString(),
      request: { title: doc.title, sourceDocumentIds: [doc.id], newUpload: doc.analysisState === "pending" },
      initiatedById: actor?.memberId, initiatedByName: actor?.displayName,
      dedupeKey: `analysis:${doc.id}:${doc.updatedAt.toISOString()}` }, tx);
    return job;
  });
}
