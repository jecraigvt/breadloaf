import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { google } from "googleapis";
import { MAX_ARCHIVE_BYTES, privateStagingDirectory, removeStagingDirectory, verifySnapshot } from "./archive-common";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const BACKUP_DRIVE_ACCOUNT = "breadloafhillsite@gmail.com";
const DRIVE_ROOT = "https://www.googleapis.com/drive/v3";
const UPLOAD_ROOT = "https://www.googleapis.com/upload/drive/v3/files";
const CHUNK_BYTES = 4 * 1024 * 1024; // Drive requires multiples of 256 KiB before the final chunk.
const FILE_FIELDS = "id,name,mimeType,trashed,parents,size,md5Checksum,sha256Checksum,ownedByMe";

export interface DriveTransport {
  request(url: string, method: "GET" | "POST" | "PUT", headers?: Record<string, string>, body?: Uint8Array | string): Promise<Response>;
}
export interface DriveBackupReceipt {
  version: 1;
  provider: "google-drive";
  driveFileId: string;
  folderId: string;
  encryptedSha256: string;
  size: number;
  verifiedAt: string;
  snapshotCreatedAt: string;
  originalCount: number;
  restoreVerified: false;
}
export interface DriveBackupOptions {
  input: string;
  passphrase: string;
  folderId: string;
  existingFileId?: string;
  transport?: DriveTransport;
  wait?: (milliseconds: number) => Promise<void>;
  deadlineMs?: number;
}
interface DriveFile {
  id?: string; mimeType?: string; trashed?: boolean; parents?: string[];
  size?: string; md5Checksum?: string; sha256Checksum?: string; ownedByMe?: boolean;
  capabilities?: { canAddChildren?: boolean };
}

function safeDriveId(value: string): boolean { return /^[A-Za-z0-9_-]{10,200}$/.test(value); }
function failed(message: string): never { throw new Error(message); }
function sessionUrl(value: string | null): string {
  if (!value) return failed("Drive did not return an upload session.");
  const url = new URL(value);
  if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/upload/drive/v3/files" || url.username || url.password || url.hash || url.searchParams.get("uploadType") !== "resumable") {
    return failed("Drive returned an unexpected upload session destination.");
  }
  return url.href;
}
function acknowledged(response: Response, size: number, sentThrough = size - 1): number {
  const value = response.headers.get("range");
  if (!value) return 0;
  const match = /^bytes=0-(\d+)$/.exec(value);
  const end = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(end) || end < 0 || end >= size || end > sentThrough) return failed("Drive returned an invalid upload acknowledgement.");
  return end + 1;
}
async function json<T>(response: Response): Promise<T> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > 128 * 1024) return failed("Drive metadata exceeded its response limit.");
  if (!response.body) return failed("Drive returned empty metadata.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 128 * 1024) return failed("Drive metadata exceeded its response limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; } catch { return failed("Drive returned invalid metadata."); }
}
async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) { await response.body?.cancel(); return failed(`Drive backup request failed (HTTP ${response.status}). No verified backup was recorded.`); }
  return response;
}

/** Drive uses 308 plus Location for resumable acknowledgements. Return it to the
 * upload state machine; neither follow it nor reject it as a browser redirect. */
export async function requestDriveResponse(url: string, method: "GET" | "POST" | "PUT", accessToken: string, headers: Record<string, string> = {}, body?: Uint8Array | string): Promise<Response> {
  return fetch(url, { method, headers: { ...headers, Authorization: `Bearer ${accessToken}` }, body: body as BodyInit | undefined,
    redirect: "manual", signal: AbortSignal.timeout(120000) });
}

/** Explicit user OAuth only; the Calendar service account is never a Drive owner. */
export async function createUserDriveTransport(): Promise<DriveTransport> {
  const clientId = process.env.ARCHIVE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.ARCHIVE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.ARCHIVE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return failed("Configure the backup account's user OAuth client and refresh token before uploading.");
  const oauth = new google.auth.OAuth2({ clientId, clientSecret, transporterOptions: { timeout: 30000 } });
  oauth.setCredentials({ refresh_token: refreshToken });
  try {
    const access = await oauth.getAccessToken();
    if (!access.token) return failed("Drive user authorization did not produce an access token.");
    const info = await oauth.getTokenInfo(access.token);
    if (!info.scopes.includes(DRIVE_FILE_SCOPE) || info.scopes.some(scope => scope.startsWith("https://www.googleapis.com/auth/drive") && scope !== DRIVE_FILE_SCOPE)) {
      return failed("Authorize the backup client with only the drive.file Drive scope.");
    }
  } catch { return failed("Drive user authorization failed. Reauthorize the backup account with the drive.file scope."); }
  return {
    async request(url, method, headers = {}, body) {
      try {
        const access = await oauth.getAccessToken();
        if (!access.token) return failed("Drive user authorization expired.");
        return await requestDriveResponse(url, method, access.token, headers, body);
      } catch { return failed("Drive backup connection failed. No verified backup was recorded."); }
    },
  };
}

/** Returns a byte-verified independent copy receipt, never document backupStatus. */
export async function uploadVerifiedSnapshotToDrive(options: DriveBackupOptions): Promise<DriveBackupReceipt> {
  if (options.passphrase.length < 20) return failed("Use the same backup passphrase of at least 20 characters that created the encrypted snapshot.");
  if (!safeDriveId(options.folderId) || options.existingFileId && !safeDriveId(options.existingFileId)) return failed("Configure a valid, fixed Drive backup folder or file ID.");
  const source = await lstat(options.input);
  if (!source.isFile() || source.isSymbolicLink() || source.size < 52 || source.size > MAX_ARCHIVE_BYTES + 1024 * 1024) return failed("Choose an ordinary encrypted snapshot within the 512 MB backup limit.");
  const stage = await privateStagingDirectory();
  try {
    const input = path.join(stage, "snapshot.blhbackup");
    let copied = 0;
    await pipeline(createReadStream(options.input), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      copied += chunk.length;
      callback(copied > source.size ? new Error("The snapshot grew while preparing the verified upload.") : null, chunk);
    } }), createWriteStream(input, { flags: "wx", mode: 0o600 }));
    if (copied !== source.size) return failed("The snapshot changed while preparing the verified upload.");
    // Work only from the protected copy that was authenticated and completely checked.
    const { manifest } = await verifySnapshot(input, options.passphrase);
    const snapshotCreatedAt = new Date(manifest.createdAt);
    if (!Number.isFinite(snapshotCreatedAt.getTime())) return failed("The verified snapshot has an invalid creation timestamp.");
    const size = (await lstat(input)).size;
    const sha = createHash("sha256"), md5 = createHash("md5");
    for await (const chunk of createReadStream(input)) { sha.update(chunk); md5.update(chunk); }
    const encryptedSha256 = sha.digest("hex"), encryptedMd5 = md5.digest("hex");
    const transport = options.transport || await createUserDriveTransport();
    const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const deadline = Date.now() + Math.min(options.deadlineMs || 15 * 60 * 1000, 30 * 60 * 1000);
    const request: DriveTransport["request"] = async (...args) => {
      if (Date.now() >= deadline) return failed("Drive backup exceeded its time limit. No verified backup was recorded.");
      return transport.request(...args);
    };
    const account = await json<{ user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } }>(await requireOk(await request(`${DRIVE_ROOT}/about?fields=user(emailAddress),storageQuota(limit,usage)`, "GET")));
    if (account.user?.emailAddress?.toLowerCase() !== BACKUP_DRIVE_ACCOUNT) return failed("Authorize Drive as the Breadloaf Hill backup account before uploading.");
    if (!options.existingFileId && account.storageQuota?.limit) {
      if (!/^\d+$/.test(account.storageQuota.limit) || !/^\d+$/.test(account.storageQuota.usage || "")) return failed("Drive returned invalid storage quota information.");
      if (BigInt(account.storageQuota.limit) - BigInt(account.storageQuota.usage!) < BigInt(size)) return failed("The backup account does not have enough free Drive storage. No files were removed.");
    }
    const folder = await json<DriveFile>(await requireOk(await request(`${DRIVE_ROOT}/files/${options.folderId}?fields=id,mimeType,trashed,ownedByMe,capabilities(canAddChildren)`, "GET")));
    if (folder.id !== options.folderId || folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed !== false || folder.ownedByMe !== true || folder.capabilities?.canAddChildren !== true) {
      return failed("The configured backup destination must be an untrashed, writable folder owned by the backup account.");
    }
    let fileId = options.existingFileId;
    if (!fileId) {
      // A process may have lost the final response or died before saving its
      // receipt. Reuse only a completed byte-identical copy, never a placeholder.
      const query = `'${options.folderId}' in parents and trashed = false and mimeType = 'application/octet-stream' and appProperties has { key='encryptedSha256' and value='${encryptedSha256}' }`;
      const previous = await json<{ files?: DriveFile[]; nextPageToken?: string }>(await requireOk(await request(`${DRIVE_ROOT}/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=100&fields=nextPageToken,files(${FILE_FIELDS})`, "GET")));
      if (!Array.isArray(previous.files) || previous.nextPageToken) return failed("The existing backup search could not be completed safely.");
      const matching = previous.files.filter(file => file.id && safeDriveId(file.id) && file.trashed === false && file.ownedByMe === true && file.parents?.includes(options.folderId) &&
        file.mimeType === "application/octet-stream" && file.size === String(size) && file.md5Checksum === encryptedMd5 && (!file.sha256Checksum || file.sha256Checksum === encryptedSha256));
      fileId = matching[0]?.id;
    }
    if (!fileId) {
      const name = `breadloaf-${snapshotCreatedAt.toISOString().replace(/[:.]/g, "-")}-${encryptedSha256.slice(0, 12)}.blhbackup`;
      const started = await requireOk(await request(`${UPLOAD_ROOT}?uploadType=resumable&fields=id`, "POST", {
        "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(size),
      }, JSON.stringify({ name, mimeType: "application/octet-stream", parents: [options.folderId], appProperties: { breadloafBackupVersion: "1", encryptedSha256 } })));
      const session = sessionUrl(started.headers.get("location"));
      await started.body?.cancel();
      const file = await open(input, "r");
      try {
        let offset = 0, interruptions = 0;
        while (!fileId) {
          const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - offset));
          const read = await file.read(chunk, 0, chunk.length, offset);
          if (read.bytesRead !== chunk.length) return failed("The verified encrypted snapshot changed while uploading.");
          let response: Response;
          let sentThrough = offset + chunk.length - 1;
          try {
            response = await request(session, "PUT", { "Content-Length": String(chunk.length), "Content-Range": `bytes ${offset}-${sentThrough}/${size}` }, chunk);
            if (response.status >= 500 || response.status === 429) { await response.body?.cancel(); throw new Error("Retry upload status"); }
          } catch {
            if (++interruptions > 4) return failed("Drive upload could not resume after repeated interruptions. No verified backup was recorded.");
            await wait(Math.min(250 * 2 ** interruptions, 4000));
            response = await request(session, "PUT", { "Content-Length": "0", "Content-Range": `bytes */${size}` });
            sentThrough = size - 1;
          }
          if (response.status === 308) {
            const received = acknowledged(response, size, sentThrough);
            await response.body?.cancel();
            if (received <= offset && ++interruptions > 4) return failed("Drive upload made no progress. No verified backup was recorded.");
            if (received > offset) interruptions = 0;
            offset = received;
            if (offset >= size) return failed("Drive acknowledged all bytes without completing the backup.");
          } else {
            const completed = await json<DriveFile>(await requireOk(response));
            if (!completed.id || !safeDriveId(completed.id)) return failed("Drive did not return the completed backup file ID.");
            fileId = completed.id;
          }
        }
      } finally { await file.close(); }
    }
    const remote = await json<DriveFile>(await requireOk(await request(`${DRIVE_ROOT}/files/${fileId}?fields=${FILE_FIELDS}`, "GET")));
    if (remote.id !== fileId || remote.mimeType !== "application/octet-stream" || remote.trashed !== false || remote.ownedByMe !== true ||
      !remote.parents?.includes(options.folderId) || remote.size !== String(size) || remote.md5Checksum !== encryptedMd5 ||
      remote.sha256Checksum && remote.sha256Checksum !== encryptedSha256) return failed("Drive backup metadata or checksum verification failed. No verified backup was recorded.");
    const downloaded = await requireOk(await request(`${DRIVE_ROOT}/files/${fileId}?alt=media`, "GET"));
    const length = downloaded.headers.get("content-length");
    if (length && length !== String(size)) { await downloaded.body?.cancel(); return failed("Drive download size did not match the verified snapshot."); }
    if (!downloaded.body) return failed("Drive returned no backup bytes for verification.");
    const reader = downloaded.body.getReader(), downloadedSha = createHash("sha256");
    let downloadedSize = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        downloadedSize += next.value.byteLength;
        if (downloadedSize > size || Date.now() >= deadline) return failed("Drive verification download exceeded its size or time limit.");
        downloadedSha.update(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (downloadedSize !== size || downloadedSha.digest("hex") !== encryptedSha256) return failed("Drive download checksum verification failed. No verified backup was recorded.");
    return { version: 1, provider: "google-drive", driveFileId: fileId, folderId: options.folderId, encryptedSha256, size,
      verifiedAt: new Date().toISOString(), snapshotCreatedAt: manifest.createdAt, originalCount: manifest.files.filter(file => file.path.startsWith("originals/")).length, restoreVerified: false };
  } finally { await removeStagingDirectory(stage); }
}
