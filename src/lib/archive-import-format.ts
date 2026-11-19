import { z } from "zod";

export const ARCHIVE_BATCH_BYTES = 15 * 1024 ** 3;
export const ARCHIVE_BATCH_FILES = 25_000;
export const ARCHIVE_CHUNK_BYTES = 8 * 1024 ** 2;
export const ARCHIVE_DRIVE_RESERVE_BYTES = 512 * 1024 ** 2;

const SCAN_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  tif: "image/tiff", tiff: "image/tiff", gif: "image/gif", avif: "image/avif",
  bmp: "image/bmp", heic: "image/heic", heif: "image/heif", jp2: "image/jp2",
};

export function scanFileType(fileName: string): string | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return extension && Object.prototype.hasOwnProperty.call(SCAN_TYPES, extension)
    ? SCAN_TYPES[extension] : null;
}

export function canReadArchiveScan(fileType: string): boolean {
  return ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/tiff", "image/gif", "image/avif"].includes(fileType);
}

export function safeArchiveImportPath(value: string): boolean {
  const parts = value.split("/");
  return value.length <= 2000 && parts.length <= 32 && parts.every(part =>
    part.length > 0 && part.length <= 255 && part !== "." && part !== ".." &&
    !part.includes("\\") && !part.includes(":") &&
    Array.from(part).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
}

export const archiveRowId = z.string().regex(/^[a-z0-9]{16,40}$/);
export const archiveSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const archiveBytes = z.number().int().min(1).max(ARCHIVE_BATCH_BYTES);
export const archiveBatchInput = z.object({
  folderKey: archiveSha256,
  folderName: z.string().refine(value => safeArchiveImportPath(value) && !value.includes("/")),
  groupImages: z.boolean(),
  fileCount: z.number().int().min(1).max(ARCHIVE_BATCH_FILES),
  sizeBytes: archiveBytes,
});
export const archiveFileInput = z.object({
  relativePath: z.string().refine(safeArchiveImportPath).refine(value => scanFileType(value) !== null),
  sizeBytes: archiveBytes,
  sha256: archiveSha256,
  position: z.number().int().min(0).max(ARCHIVE_BATCH_FILES - 1),
});

export function validArchiveDriveId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{10,200}$/.test(value);
}

export function archiveDriveId(filePath: string): string | null {
  return filePath.startsWith("drive:") && validArchiveDriveId(filePath.slice(6)) ? filePath.slice(6) : null;
}

export function archiveUploadRange(value: string | null, size: number) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || "");
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  const length = end - start + 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || total !== size ||
      start < 0 || end < start || end >= size || length > ARCHIVE_CHUNK_BYTES ||
      (end < size - 1 && length % (256 * 1024) !== 0)) return null;
  return { start, end, length };
}

export function archiveUploadOffset(range: string | null, size: number): number {
  const match = /^bytes=0-(\d+)$/.exec(range || "");
  if (!match) return 0;
  const offset = Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset < 1 || offset > size) throw new Error("Invalid Drive upload progress");
  return offset;
}

export class ArchiveImportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
