import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { archiveDriveId } from "../src/lib/archive-import-format";
import type { ArchiveDriveObject } from "../src/lib/archive-original-drive";
import { readArchiveOriginal } from "../src/lib/archive-original-response";

/** Check both the import record and the full original, including during an offline restore drill. */
export async function verifyDriveOriginal(document: {
  filePath: string; fileSize: number; fileType: string; checksum: string | null;
  archiveImportFile: ArchiveDriveObject | null;
}, read = readArchiveOriginal) {
  const original = document.archiveImportFile;
  if (!original || archiveDriveId(document.filePath) !== original.driveId ||
      document.checksum !== original.sha256 || document.fileSize !== Number(original.sizeBytes) ||
      document.fileType !== original.fileType) {
    throw new Error("The document and its Drive import record disagree.");
  }
  const response = await read(original);
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error("The complete original is unavailable.");
  }
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as NodeWebStream<Uint8Array>)) {
    size += chunk.length;
    if (size > document.fileSize) throw new Error("The original exceeds its recorded size.");
    hash.update(chunk);
  }
  if (size !== document.fileSize || hash.digest("hex") !== original.sha256) {
    throw new Error("The original does not match its recorded size and checksum.");
  }
}
