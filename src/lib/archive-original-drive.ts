import {
  ARCHIVE_DRIVE_RESERVE_BYTES, ArchiveImportError, archiveUploadOffset, validArchiveDriveId,
} from "@/lib/archive-import-format";

const DRIVE_ORIGIN = "https://www.googleapis.com";
const OWNER = "breadloafhillsite@gmail.com";
const IMPORT_FOLDER_NAME = "Breadloaf Hill Scan Archive";
const FILE_FIELDS = "id,size,mimeType,parents,owners(emailAddress),sha256Checksum,appProperties,trashed";
const transportTimeout = 45_000;

interface DriveFile {
  id?: string;
  size?: string;
  mimeType?: string;
  trashed?: boolean;
  parents?: string[];
  owners?: { emailAddress?: string }[];
  sha256Checksum?: string;
  appProperties?: Record<string, string>;
}

export interface ArchiveDriveObject {
  driveId: string;
  driveFolder: string;
  sizeBytes: number | bigint;
  sha256: string;
  fileType: string;
}

export type TransferProgress = { state: "uploading"; offset: number } | { state: "complete" | "expired" };

export function archiveImportFolder(): string {
  const folder = process.env.ARCHIVE_IMPORT_DRIVE_FOLDER_ID || "";
  if (!validArchiveDriveId(folder) || folder === process.env.ARCHIVE_DRIVE_FOLDER_ID || process.env.ARCHIVE_RECOVERED_ORIGINALS_DIR) {
    throw new ArchiveImportError("Folder import is not set up yet.", 503);
  }
  return folder;
}

export function archiveUploadUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.origin === DRIVE_ORIGIN && url.pathname === "/upload/drive/v3/files" &&
        !url.username && !url.password && !url.hash &&
        url.searchParams.get("uploadType") === "resumable" && url.searchParams.has("upload_id")) return url;
  } catch { /* Refuse an invalid or unexpected session destination. */ }
  throw new ArchiveImportError("Drive did not return a usable upload session.", 502);
}

function driveError(response: Response, message: string): never {
  if (response.status === 429 || response.status >= 500) {
    throw new ArchiveImportError("Drive is temporarily unavailable. Resume the import in a few minutes.", 503);
  }
  throw new ArchiveImportError(message, 502);
}

/** The property user owns these objects. URLs and OAuth credentials stay out of
 * the archive catalog. The signed-in uploader receives a per-file resumable URL. */
export class ArchiveOriginalDrive {
  private token?: { value: string; expiresAt: number };
  private refresh?: Promise<string>;

  constructor(private readonly transport: typeof fetch = fetch) {}

  private accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return Promise.resolve(this.token.value);
    if (!this.refresh) this.refresh = this.refreshAccessToken().finally(() => { this.refresh = undefined; });
    return this.refresh;
  }

  private async refreshAccessToken() {
    const { ARCHIVE_DRIVE_CLIENT_ID, ARCHIVE_DRIVE_CLIENT_SECRET, ARCHIVE_DRIVE_REFRESH_TOKEN } = process.env;
    if (!ARCHIVE_DRIVE_CLIENT_ID || !ARCHIVE_DRIVE_CLIENT_SECRET || !ARCHIVE_DRIVE_REFRESH_TOKEN) {
      throw new ArchiveImportError("The property Drive connection is not configured.", 503);
    }
    const response = await this.transport("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: ARCHIVE_DRIVE_CLIENT_ID,
        client_secret: ARCHIVE_DRIVE_CLIENT_SECRET,
        refresh_token: ARCHIVE_DRIVE_REFRESH_TOKEN,
      }),
    });
    if (!response.ok) driveError(response, "The property Drive connection needs attention.");
    const payload = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
    if (!payload.access_token || !payload.expires_in || payload.scope?.split(/\s+/).some(scope =>
      scope.startsWith("https://www.googleapis.com/auth/drive") && scope !== "https://www.googleapis.com/auth/drive.file")) {
      throw new ArchiveImportError("The property Drive connection needs per-file access.", 503);
    }
    this.token = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
    return this.token.value;
  }

  private async request(path: string, params: Record<string, string>, init: RequestInit = {}) {
    const url = new URL(path, DRIVE_ORIGIN);
    url.search = new URLSearchParams(params).toString();
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + await this.accessToken());
    const response = await this.transport(url, {
      ...init, headers, redirect: "error", cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(transportTimeout),
    });
    if (response.status === 401) this.token = undefined;
    return response;
  }

  async checkDestination(folder: string, requiredBytes: number) {
    const [account, parent] = await Promise.all([
      this.request("/drive/v3/about", { fields: "user(emailAddress),storageQuota(limit,usage)" }),
      this.request("/drive/v3/files/" + folder, { fields: "id,mimeType,owners(emailAddress),trashed,capabilities(canAddChildren)" }),
    ]);
    if (!account.ok) driveError(account, "The property Drive account could not be checked.");
    if (!parent.ok) driveError(parent, "The archive's Drive folder could not be opened.");
    const about = await account.json() as { user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } };
    const details = await parent.json() as DriveFile & { capabilities?: { canAddChildren?: boolean } };
    if (about.user?.emailAddress?.toLowerCase() !== OWNER || details.id !== folder ||
        details.mimeType !== "application/vnd.google-apps.folder" || details.trashed !== false ||
        !details.owners?.some(owner => owner.emailAddress?.toLowerCase() === OWNER) || !details.capabilities?.canAddChildren) {
      throw new ArchiveImportError("Check that the private archive folder belongs to the property Drive account.", 503);
    }
    const { limit, usage } = about.storageQuota ?? {};
    if (limit !== undefined) {
      const remaining = Number(limit) - Number(usage);
      if (!Number.isSafeInteger(remaining) || remaining < requiredBytes + ARCHIVE_DRIVE_RESERVE_BYTES) {
        throw new ArchiveImportError("Drive needs more room for this batch, weekly backups, and mail.", 409);
      }
    }
  }

  /** An operator uses the same Drive app as the upload service. Selecting a
   * random pre-existing folder by ID would not grant the app per-file access. */
  async setupFolder(viewerEmail?: string) {
    if (viewerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(viewerEmail)) throw new Error("Provide a valid Viewer email address.");
    const account = await this.request("/drive/v3/about", { fields: "user(emailAddress)" });
    if (!account.ok) driveError(account, "The property Drive account could not be checked.");
    if ((await account.json() as { user?: { emailAddress?: string } }).user?.emailAddress?.toLowerCase() !== OWNER) {
      throw new Error("The Drive connection must belong to the property account.");
    }
    const found = await this.request("/drive/v3/files", {
      q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and 'me' in owners and name = '" + IMPORT_FOLDER_NAME + "'",
      fields: "nextPageToken,files(id)", pageSize: "2",
    });
    if (!found.ok) driveError(found, "The archive folder could not be located.");
    const listed = await found.json() as { nextPageToken?: string; files?: { id: string }[] };
    if (listed.nextPageToken || (listed.files?.length || 0) > 1) throw new Error("More than one archive folder matches. Choose the original folder before continuing.");
    let folder = listed.files?.[0]?.id;
    if (!folder) {
      const created = await this.request("/drive/v3/files", { fields: "id" }, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: IMPORT_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
      });
      if (!created.ok) driveError(created, "The private scan archive folder could not be created.");
      folder = (await created.json() as { id?: string }).id;
    }
    if (!folder || !validArchiveDriveId(folder) || folder === process.env.ARCHIVE_DRIVE_FOLDER_ID) {
      throw new Error("The private scan archive must use its own folder.");
    }
    await this.checkDestination(folder, 0);
    const resource = "/drive/v3/files/" + folder + "/permissions";
    const permissions = async () => {
      const response = await this.request(resource, { fields: "nextPageToken,permissions(type,role,emailAddress)", pageSize: "100" });
      if (!response.ok) driveError(response, "The archive folder permissions could not be verified.");
      const result = await response.json() as { nextPageToken?: string; permissions?: Array<{ type: string; role: string; emailAddress?: string }> };
      if (result.nextPageToken || !result.permissions || result.permissions.some(permission => permission.type === "anyone" || permission.type === "domain")) {
        throw new Error("Use a private archive folder without public or domain-wide access.");
      }
      return result.permissions;
    };
    const existing = await permissions();
    if (!viewerEmail) return { folderId: folder };
    const recipient = viewerEmail.toLowerCase();
    const hasViewer = (list: Awaited<ReturnType<typeof permissions>>) =>
      list.find(permission => permission.type === "user" && permission.emailAddress?.toLowerCase() === recipient)?.role;
    if (!hasViewer(existing)) {
      const shared = await this.request(resource, { sendNotificationEmail: "false", fields: "id" }, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role: "reader", emailAddress: recipient }),
      });
      if (!shared.ok) driveError(shared, "The archive folder could not be shared with that account.");
    }
    const viewerRole = hasViewer(await permissions());
    if (!viewerRole) throw new Error("The Viewer grant could not be confirmed.");
    return { folderId: folder, viewerRole };
  }

  async allocateId() {
    const response = await this.request("/drive/v3/files/generateIds", { count: "1", space: "drive", type: "files" });
    if (!response.ok) driveError(response, "Drive could not reserve a file.");
    const { ids } = await response.json() as { ids?: string[] };
    const id = ids?.[0] ?? "";
    if (!validArchiveDriveId(id)) throw new ArchiveImportError("Drive returned an invalid file reference.", 502);
    return id;
  }

  async start(object: ArchiveDriveObject, fileName: string) {
    const response = await this.request("/upload/drive/v3/files", { uploadType: "resumable", fields: FILE_FIELDS }, {
      method: "POST", headers: {
        "Content-Type": "application/json",
        "X-Upload-Content-Type": object.fileType,
        "X-Upload-Content-Length": String(object.sizeBytes),
      },
      body: JSON.stringify({
        id: object.driveId, name: fileName, mimeType: object.fileType, parents: [object.driveFolder],
        appProperties: { breadloafScanSha256: object.sha256 },
      }),
    });
    if (response.status === 409) return null;
    if (!response.ok) driveError(response, "Drive could not start this upload.");
    return archiveUploadUrl(response.headers.get("location") || "").href;
  }

  async verified(object: ArchiveDriveObject): Promise<boolean> {
    const response = await this.request("/drive/v3/files/" + object.driveId, { fields: FILE_FIELDS });
    if (response.status === 404) return false;
    if (!response.ok) driveError(response, "Drive could not verify the original.");
    const file = await response.json() as DriveFile;
    if (file.id !== object.driveId || file.trashed !== false || !file.parents?.includes(object.driveFolder) ||
        !file.owners?.some(owner => owner.emailAddress?.toLowerCase() === OWNER) ||
        file.mimeType !== object.fileType || file.size !== String(object.sizeBytes) ||
        file.sha256Checksum?.toLowerCase() !== object.sha256 || file.appProperties?.breadloafScanSha256 !== object.sha256) {
      throw new ArchiveImportError("Drive's copy did not match the expected original. The file was not accepted.", 409);
    }
    return true;
  }

  private async transfer(url: string, size: number, init: RequestInit): Promise<TransferProgress> {
    const response = await this.transport(archiveUploadUrl(url), {
      ...init, method: "PUT", redirect: "manual", cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(transportTimeout),
    });
    await response.body?.cancel();
    if (response.status === 308) return { state: "uploading", offset: archiveUploadOffset(response.headers.get("range"), size) };
    if (response.ok) return { state: "complete" };
    if ([404, 410].includes(response.status)) return { state: "expired" };
    driveError(response, "Drive could not resume this upload. Reopen the folder and try again.");
  }

  progress(url: string, size: number) {
    return this.transfer(url, size, { headers: { "Content-Length": "0", "Content-Range": "bytes */" + size } });
  }

  chunk(url: string, size: number, range: string, length: number, body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const init = {
      headers: { "Content-Length": String(length), "Content-Range": range },
      body, duplex: "half",
      signal: AbortSignal.any([signal, AbortSignal.timeout(transportTimeout)]),
    };
    return this.transfer(url, size, init);
  }

  async media(id: string, signal?: AbortSignal, range?: string) {
    if (!validArchiveDriveId(id)) throw new ArchiveImportError("Original file is unavailable.", 404);
    const response = await this.request("/drive/v3/files/" + id, { alt: "media" }, {
      headers: range ? { Range: range } : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)]) : AbortSignal.timeout(20 * 60_000),
    });
    if (response.status === 404) throw new ArchiveImportError("Original file is unavailable.", 404);
    if (!response.ok) driveError(response, "Drive could not open the original.");
    return response;
  }
}

export const archiveOriginalDrive = new ArchiveOriginalDrive();
