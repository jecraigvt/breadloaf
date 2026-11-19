import { Prisma, type ArchiveImportFile, type Document } from "@prisma/client";
import type { z } from "zod";
import type { ActorContext } from "@/lib/actor";
import {
  ArchiveImportError, archiveUploadRange, canReadArchiveScan, scanFileType,
  type archiveBatchInput, type archiveFileInput,
} from "@/lib/archive-import-format";
import { archiveImportFolder, archiveOriginalDrive, type ArchiveOriginalDrive } from "@/lib/archive-original-drive";
import { enqueueBuckyJob } from "@/lib/bucky-jobs";
import { prisma } from "@/lib/prisma";

type BatchInput = z.infer<typeof archiveBatchInput>;
type FileInput = z.infer<typeof archiveFileInput>;

function batchInfo(batch: { id: string; folderName: string; fileCount: number; sizeBytes: bigint; _count: { files: number } }) {
  return { id: batch.id, folderName: batch.folderName, fileCount: batch.fileCount,
    sizeBytes: Number(batch.sizeBytes), savedCount: batch._count.files };
}

const savedCount = { select: { files: { where: { documentId: { not: null } } } } } as const;

export async function listArchiveImports(memberId: string) {
  const recent = await prisma.archiveImport.findMany({
    where: { memberId }, orderBy: { createdAt: "desc" }, take: 12, include: { _count: savedCount },
  });
  if (!recent.length) return [];
  const counts = await prisma.$queryRaw<Array<{ importId: string; readCount: number; unsupportedCount: number }>>(Prisma.sql`
    SELECT f."importId", (COUNT(*) FILTER (WHERE d."archivePageJobId" IS NOT NULL))::int AS "readCount",
      (COUNT(*) FILTER (WHERE d."analysisState" = 'unsupported_type'))::int AS "unsupportedCount"
    FROM "ArchiveImportFile" f JOIN "Document" d ON d.id = f."documentId"
    WHERE f."importId" IN (${Prisma.join(recent.map(batch => batch.id))})
    GROUP BY f."importId"`);
  const byBatch = new Map(counts.map(({ importId, ...count }) => [importId, count]));
  return recent.map(batch => ({ ...batchInfo(batch), ...(byBatch.get(batch.id) ?? { readCount: 0, unsupportedCount: 0 }) }));
}

export async function createArchiveImport(input: BatchInput, memberId: string, drive = archiveOriginalDrive) {
  const folder = archiveImportFolder();
  const key = { memberId, folderKey: input.folderKey };
  const existing = await prisma.archiveImport.findUnique({
    where: { memberId_folderKey: key }, include: { _count: savedCount },
  });
  if (existing) {
    if (existing.sizeBytes !== BigInt(input.sizeBytes) || existing.fileCount !== input.fileCount || existing.groupImages !== input.groupImages) {
      throw new ArchiveImportError("The selected folder does not match the prior import.", 409);
    }
    return batchInfo(existing);
  }

  await drive.checkDestination(folder, input.sizeBytes);
  const batch = await prisma.archiveImport.upsert({
    where: { memberId_folderKey: key }, update: {},
    create: { ...input, sizeBytes: BigInt(input.sizeBytes), memberId },
    include: { _count: savedCount },
  });
  return batchInfo(batch);
}

export async function archiveBatchFile(importId: string, fileId: string, memberId: string) {
  const file = await prisma.archiveImportFile.findFirst({
    where: { id: fileId, importId, batch: { memberId } },
  });
  if (!file) throw new ArchiveImportError("This import file was not found.", 404);
  return file;
}

export async function prepareArchiveImportFile(importId: string, input: FileInput, actor: ActorContext, drive = archiveOriginalDrive) {
  const driveFolder = archiveImportFolder();
  const batch = await prisma.archiveImport.findFirst({ where: { id: importId, memberId: actor.memberId } });
  if (!batch) throw new ArchiveImportError("This import was not found.", 404);
  const key = { importId, relativePath: input.relativePath };
  let file = await prisma.archiveImportFile.findUnique({ where: { importId_relativePath: key } });
  if (!file) {
    const driveId = await drive.allocateId();
    file = await prisma.$transaction(async tx => {
      await tx.$queryRaw<unknown[]>`SELECT "id" FROM "ArchiveImport" WHERE "id" = ${importId} FOR UPDATE`;
      const raced = await tx.archiveImportFile.findUnique({ where: { importId_relativePath: key } });
      if (raced) return raced;
      const locked = await tx.archiveImport.findUniqueOrThrow({ where: { id: importId } });
      if (input.position >= batch.fileCount || locked.reservedFiles >= batch.fileCount ||
          locked.reservedBytes + BigInt(input.sizeBytes) > batch.sizeBytes ||
          await tx.archiveImportFile.findUnique({ where: { importId_position: { importId, position: input.position } } })) {
        throw new ArchiveImportError("This file does not match the folder selected for this import.", 409);
      }
      await tx.archiveImport.update({ where: { id: importId }, data: {
        reservedFiles: { increment: 1 }, reservedBytes: { increment: BigInt(input.sizeBytes) },
      } });
      const fileType = scanFileType(input.relativePath)!;
      return tx.archiveImportFile.create({ data: {
        ...input, importId, driveId, driveFolder, sizeBytes: BigInt(input.sizeBytes),
        fileType, groupPath: locked.groupImages && fileType.startsWith("image/") ? input.relativePath.split("/").slice(0, -1).join("/") : null,
      } });
    });
  }
  if (file.sha256 !== input.sha256 || file.sizeBytes !== BigInt(input.sizeBytes) || file.position !== input.position) {
    throw new ArchiveImportError("A file changed after the import started. Select the original folder or start a new import.", 409);
  }
  return archiveImportProgress(file, actor, drive);
}

function savedOriginal(fileId: string, documentId: string) {
  return { fileId, state: "saved" as const, documentId };
}

async function saveOriginal(file: ArchiveImportFile, actor: ActorContext) {
  const documentId = await prisma.$transaction(async tx => {
    await tx.$queryRaw<unknown[]>`SELECT "id" FROM "ArchiveImportFile" WHERE "id" = ${file.id} FOR UPDATE`;
    const current = await tx.archiveImportFile.findUniqueOrThrow({ where: { id: file.id }, include: { batch: true } });
    if (current.documentId) return current.documentId;
    const fileName = current.relativePath.split("/").pop()!;
    const readable = canReadArchiveScan(current.fileType);
    const document = await tx.document.create({ data: {
      title: fileName.replace(/\.[^.]+$/, "").slice(0, 300) || fileName,
      description: "Original folder: " + current.batch.folderName + "/" + current.relativePath,
      fileName, filePath: "drive:" + current.driveId, fileType: current.fileType, fileSize: Number(current.sizeBytes),
      checksum: current.sha256, accessScope: "family", uploadedBy: actor.fullName,
      analysisState: readable ? "pending" : "unsupported_type",
      analysisError: readable ? null : "Original saved. Bucky cannot read this scan format yet.",
    } });
    await tx.archiveImportFile.update({ where: { id: file.id }, data: { documentId: document.id, uploadUrl: null } });
    if (readable) await queueArchiveScan(tx, document, actor);
    return document.id;
  });
  return savedOriginal(file.id, documentId);
}

export function queueArchiveScan(tx: Prisma.TransactionClient, doc: Document, actor: ActorContext | null) {
  return enqueueBuckyJob({
    kind: "document_analysis", sourceDocumentId: doc.id, sourceVersion: doc.updatedAt.toISOString(),
    request: { title: doc.title, sourceDocumentIds: [doc.id], archiveScan: true, newUpload: doc.analysisState === "pending" },
    initiatedById: actor?.memberId, initiatedByName: actor?.displayName,
    dedupeKey: "analysis:" + doc.id + ":" + doc.updatedAt.toISOString(),
  }, tx);
}

/** Finalization is repeated safely if Drive or the browser loses the last response. */
export async function archiveImportProgress(file: ArchiveImportFile, actor: ActorContext, drive = archiveOriginalDrive) {
  if (file.documentId) return savedOriginal(file.id, file.documentId);
  if (await drive.verified(file)) return saveOriginal(file, actor);
  if (file.uploadUrl) {
    const progress = await drive.progress(file.uploadUrl, Number(file.sizeBytes));
    if (progress.state === "uploading") return { ...progress, fileId: file.id, uploadUrl: file.uploadUrl };
    if (progress.state === "complete") {
      if (await drive.verified(file)) return saveOriginal(file, actor);
      throw new ArchiveImportError("Drive is confirming the original. Resume in a moment.", 409);
    }
  }
  const uploadUrl = await drive.start(file, file.relativePath.split("/").pop()!);
  if (!uploadUrl) {
    if (await drive.verified(file)) return saveOriginal(file, actor);
    throw new ArchiveImportError("Drive is confirming this file. Resume in a moment.", 409);
  }
  const changed = await prisma.archiveImportFile.updateMany({
    where: { id: file.id, uploadUrl: file.uploadUrl, documentId: null }, data: { uploadUrl },
  });
  if (!changed.count) throw new ArchiveImportError("This import is open elsewhere. Resume from one tab.", 409);
  return { state: "uploading" as const, fileId: file.id, uploadUrl, offset: 0 };
}

export async function relayArchiveChunk(file: ArchiveImportFile, actor: ActorContext, request: Request, drive: ArchiveOriginalDrive = archiveOriginalDrive) {
  if (file.documentId) {
    await request.body?.cancel();
    return savedOriginal(file.id, file.documentId);
  }
  const header = request.headers.get("Content-Range");
  const length = request.headers.get("Content-Length");
  const range = archiveUploadRange(header, Number(file.sizeBytes));
  if (!file.uploadUrl || !request.body || !range || (length !== null && length !== String(range.length))) {
    throw new ArchiveImportError("Invalid upload chunk. Resume this file.", 400);
  }
  let received = 0;
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length;
      if (received > range.length) throw new Error("Upload chunk exceeds the declared length");
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== range.length) throw new Error("Upload chunk was interrupted");
    },
  }));
  const result = await drive.chunk(file.uploadUrl, Number(file.sizeBytes), header!, range.length, limited, request.signal);
  if (result.state === "uploading") return { ...result, fileId: file.id, uploadUrl: file.uploadUrl };
  return archiveImportProgress(file, actor, drive);
}
