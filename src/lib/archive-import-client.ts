import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  ARCHIVE_CHUNK_BYTES, archiveUploadOffset, canReadArchiveScan, safeArchiveImportPath, scanFileType,
} from "@/lib/archive-import-format";

export interface ScanSelection {
  file: File;
  relativePath: string;
  fileType: string;
}

export function inventoryScans(files: File[]) {
  const folderName = files[0]?.webkitRelativePath.split("/")[0] || "Scans";
  const scans: ScanSelection[] = [];
  const skipped = [];
  const positions = new Set<string>();
  let sizeBytes = 0;
  let needsReader = 0;
  for (const file of files) {
    const relativePath = file.webkitRelativePath.split("/").slice(1).join("/") || file.name;
    const fileType = scanFileType(relativePath);
    if (!fileType || !file.size || !safeArchiveImportPath(relativePath) || positions.has(relativePath)) {
      skipped.push(relativePath);
      continue;
    }
    positions.add(relativePath);
    scans.push({ file, relativePath, fileType });
    sizeBytes += file.size;
    if (!canReadArchiveScan(fileType)) needsReader++;
  }
  scans.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en", { numeric: true }) ||
    a.relativePath.localeCompare(b.relativePath, "en"));
  return { folderName, scans, skipped, sizeBytes, needsReader };
}

export type ScanInventory = ReturnType<typeof inventoryScans>;

export function scanFolderKey(inventory: ScanInventory, groupImages: boolean) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
    inventory.folderName, groupImages,
    inventory.scans.map(({ file, relativePath }) => [relativePath, file.size, file.lastModified]),
  ]))));
}

export async function hashScan(file: Blob, signal: AbortSignal) {
  const hash = sha256.create();
  for (let start = 0; start < file.size; start += ARCHIVE_CHUNK_BYTES) {
    signal.throwIfAborted();
    hash.update(new Uint8Array(await file.slice(start, start + ARCHIVE_CHUNK_BYTES).arrayBuffer()));
  }
  return bytesToHex(hash.digest());
}

export interface ArchiveBatchInfo {
  id: string;
  folderName: string;
  fileCount: number;
  sizeBytes: number;
  savedCount: number;
  readCount?: number;
  unsupportedCount?: number;
}

type FileProgress =
  | { state: "uploading"; fileId: string; uploadUrl: string; offset: number }
  | { state: "saved"; fileId: string; documentId: string };

export async function archiveImportRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/archive/imports" + path, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new Error(data?.error || "The import was interrupted. Choose Resume to continue.");
  return data as T;
}

export function archiveImportJson(body: unknown, signal: AbortSignal): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal };
}

export async function sendArchiveScan(batchId: string, entry: ScanSelection, position: number, signal: AbortSignal,
  report: (offset: number) => void) {
  const { file, relativePath } = entry;
  let progress = await archiveImportRequest<FileProgress>("/" + batchId, archiveImportJson({
    relativePath, position, sizeBytes: file.size, sha256: await hashScan(file, signal),
  }, signal));
  const statusPath = "/" + batchId + "/" + progress.fileId;
  const refresh = () => archiveImportRequest<FileProgress>(statusPath, { method: "POST", signal });
  let direct = true;
  let stalled = 0;
  while (progress.state === "uploading") {
    signal.throwIfAborted();
    const start = progress.offset;
    report(start);
    if (start === file.size) {
      progress = await refresh();
    } else {
      const end = Math.min(start + ARCHIVE_CHUNK_BYTES, file.size);
      const body = file.slice(start, end);
      const headers = { "Content-Range": "bytes " + start + "-" + (end - 1) + "/" + file.size };
      if (direct) {
        const response = await fetch(progress.uploadUrl, {
          method: "PUT", body, headers, signal, redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer",
        }).catch(() => null);
        signal.throwIfAborted();
        const acknowledged = response?.status === 308 ? archiveUploadOffset(response.headers.get("range"), file.size) : 0;
        await response?.body?.cancel().catch(() => undefined);
        progress = acknowledged > start ? { ...progress, offset: acknowledged } : await refresh();
        // A browser can hide Drive's Range header or reject its cross-origin request.
        // Ask Drive what arrived before relaying a bounded chunk through Breadloaf.
        if (!response || (progress.state === "uploading" && progress.offset <= start)) direct = false;
      } else {
        progress = await archiveImportRequest<FileProgress>(statusPath, { method: "PUT", body, headers, signal });
      }
    }
    if (progress.state === "uploading" && progress.offset <= start) {
      if (++stalled > 2) throw new Error("The upload stopped making progress. Choose Resume to check it again.");
    } else stalled = 0;
  }
  report(file.size);
}
