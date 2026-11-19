import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ArchiveImportError, validArchiveDriveId } from "@/lib/archive-import-format";
import { archiveOriginalDrive, type ArchiveDriveObject, type ArchiveOriginalDrive } from "@/lib/archive-original-drive";

export async function readArchiveOriginal(original: ArchiveDriveObject, options: {
  signal?: AbortSignal;
  range?: { start: number; end: number } | null;
  drive?: ArchiveOriginalDrive;
} = {}) {
  const { signal, range, drive = archiveOriginalDrive } = options;
  const recovered = process.env.ARCHIVE_RECOVERED_ORIGINALS_DIR;
  if (!recovered) {
    if (!await drive.verified(original)) throw new ArchiveImportError("Original file is unavailable.", 404);
    return drive.media(original.driveId, signal, range ? "bytes=" + range.start + "-" + range.end : undefined);
  }

  // A verified recovery export can be served after losing access to Google.
  // The operator supplies an absolute, read-only directory of recovered files.
  if (!path.isAbsolute(recovered) || !validArchiveDriveId(original.driveId)) throw new ArchiveImportError("Invalid recovered original location.", 500);
  const root = await realpath(recovered);
  const file = path.join(root, original.driveId);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== Number(original.sizeBytes)) {
    throw new ArchiveImportError("The recovered original is unavailable.", 404);
  }
  const stream = createReadStream(file, { ...range, signal });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers: range ? { "Content-Range": "bytes " + range.start + "-" + range.end + "/" + info.size } : undefined,
  });
}
