import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, realpath, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BACKUP_DRIVE_ACCOUNT, DRIVE_FILE_SCOPE, type DriveTransport } from "./archive-drive-common";
import { runProgram, safeArchivePath } from "./archive-common";

export const BACKUP_FOLDER_NAME = "Breadloaf Hill Backups";
const ROOT = "https://www.googleapis.com/drive/v3";
const FOLDER_FIELDS = "id,name,mimeType,trashed,ownedByMe,capabilities(canAddChildren)";
interface Folder { id?: string; name?: string; mimeType?: string; trashed?: boolean; ownedByMe?: boolean; capabilities?: { canAddChildren?: boolean }; }
export interface DriveAuthorizationReceipt {
  version: 1;
  account: typeof BACKUP_DRIVE_ACCOUNT;
  scope: typeof DRIVE_FILE_SCOPE;
  authorizedAt: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
  folderName: typeof BACKUP_FOLDER_NAME;
}

/** One-use callback binds only to IPv4 loopback and accepts only its unpredictable state. */
export async function createDriveLoopbackCallback(timeoutMs = 10 * 60 * 1000) {
  const state = randomBytes(32).toString("base64url");
  let resolveCode!: (code: string) => void, rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Callers may still be displaying the consent URL when a cancellation arrives.
  void code.catch(() => {});
  let finished = false, expectedHost = "", timer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    const deny = () => { response.statusCode = 400; response.end("This local authorization response was not accepted. Return to the original consent link."); };
    if (finished || request.method !== "GET" || request.headers.host !== expectedHost || request.socket.remoteAddress !== "127.0.0.1" || !request.url || request.url.length > 8192) return deny();
    const url = new URL(request.url, `http://${expectedHost}`);
    const incomingState = url.searchParams.get("state") || "";
    if (url.pathname !== "/oauth2/callback" || url.searchParams.getAll("state").length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(incomingState) || !timingSafeEqual(Buffer.from(incomingState), Buffer.from(state))) return deny();
    if (url.searchParams.has("error")) {
      finished = true; clearTimeout(timer); response.end("Authorization was cancelled. No backup credentials were saved.");
      rejectCode(new Error("Google authorization was cancelled. No backup credentials were saved.")); void closeServer(); return;
    }
    const incomingCode = url.searchParams.get("code");
    if (url.searchParams.getAll("code").length !== 1 || !incomingCode || incomingCode.length > 4096 || /[\x00-\x20\x7f]/.test(incomingCode)) return deny();
    finished = true; clearTimeout(timer);
    response.end("Authorization response received. Return to the local script to confirm the property account and saved credentials.");
    resolveCode(incomingCode); void closeServer();
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 5;
  const closeServer = () => new Promise<void>(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve()); server.closeIdleConnections();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") { await closeServer(); throw new Error("The local authorization listener could not start."); }
  expectedHost = `127.0.0.1:${address.port}`;
  timer = setTimeout(() => { finished = true; rejectCode(new Error("The local authorization expired. Restart the script to request a new consent link.")); void closeServer(); }, Math.min(Math.max(timeoutMs, 1), 15 * 60 * 1000));
  return { state, redirectUri: `http://${expectedHost}/oauth2/callback`, code,
    async close() { clearTimeout(timer); if (!finished) { finished = true; rejectCode(new Error("The local authorization was closed before completion.")); } await closeServer(); } };
}

async function metadata<T>(response: Response): Promise<T> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Drive authorization setup failed (HTTP ${response.status}). No backup credentials were saved.`); }
  if (!response.body) throw new Error("Drive returned no authorization metadata.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 128 * 1024) throw new Error("Drive authorization metadata exceeded its size limit."); chunks.push(next.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; } catch { throw new Error("Drive returned invalid authorization metadata."); }
}
function validFolder(folder: Folder): folder is Folder & { id: string } {
  return Boolean(folder.id && /^[A-Za-z0-9_-]{10,200}$/.test(folder.id) && folder.name === BACKUP_FOLDER_NAME &&
    folder.mimeType === "application/vnd.google-apps.folder" && folder.trashed === false && folder.ownedByMe === true && folder.capabilities?.canAddChildren === true);
}

/** Identity is checked before even listing folders, and before any Drive mutation. */
export async function prepareAuthorizedDriveFolder(transport: DriveTransport, scopes: string[]): Promise<string> {
  if (scopes.length !== 1 || scopes[0] !== DRIVE_FILE_SCOPE) throw new Error("Authorize this client with the drive.file scope only. No backup credentials were saved.");
  const account = await metadata<{ user?: { emailAddress?: string } }>(await transport.request(`${ROOT}/about?fields=user(emailAddress)`, "GET"));
  if (account.user?.emailAddress?.toLowerCase() !== BACKUP_DRIVE_ACCOUNT) throw new Error("Google authorized a different account. Sign in as the property backup account; no folder or credentials were created.");
  const query = `name = '${BACKUP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'me' in owners`;
  const listed = await metadata<{ files?: Folder[]; nextPageToken?: string }>(await transport.request(`${ROOT}/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=100&fields=nextPageToken,files(${FOLDER_FIELDS})`, "GET"));
  if (!Array.isArray(listed.files) || listed.nextPageToken || listed.files.length > 1) throw new Error("The backup folder search is ambiguous. Keep one app-accessible dedicated backup folder before retrying.");
  let folder: Folder;
  if (listed.files.length) folder = listed.files[0];
  else folder = await metadata<Folder>(await transport.request(`${ROOT}/files?fields=${FOLDER_FIELDS}`, "POST", { "Content-Type": "application/json; charset=UTF-8" }, JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", appProperties: { breadloafBackupFolder: "1" } })));
  if (!validFolder(folder)) throw new Error("The backup folder must be an untrashed, writable folder owned by the property account.");
  // Re-read after search/create rather than assuming a folder remained unchanged.
  const verified = await metadata<Folder>(await transport.request(`${ROOT}/files/${folder.id}?fields=${FOLDER_FIELDS}`, "GET"));
  if (!validFolder(verified) || verified.id !== folder.id) throw new Error("The dedicated backup folder could not be verified. No backup credentials were saved.");
  return folder.id;
}

/** New dedicated directory only, so restriction never alters an existing unrelated folder. */
export async function preparePrivateOAuthOutput(output: string) {
  if (!path.isAbsolute(output) || !safeArchivePath(path.basename(output)) || !output.endsWith(".json")) throw new Error("Choose an absolute .json output path in a new dedicated private directory.");
  const directory = path.dirname(output), parent = await realpath(path.dirname(directory));
  if (!safeArchivePath(path.basename(directory))) throw new Error("Choose a safe dedicated private directory name.");
  const resolvedDirectory = path.join(parent, path.basename(directory)), workspace = await realpath(process.cwd());
  const relative = path.relative(workspace, resolvedDirectory);
  if (!relative || !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("OAuth credentials must be stored outside the application workspace.");
  await mkdir(resolvedDirectory, { mode: 0o700 });
  try {
    if (process.platform === "win32") {
      const identity = await runProgram("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
      const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
      if (!sid) throw new Error("Could not determine private credential directory permissions.");
      await runProgram("icacls.exe", [resolvedDirectory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"]);
    } else await chmod(resolvedDirectory, 0o700);
  } catch (error) { await rmdir(resolvedDirectory); throw error; }
  let saved = false;
  return { path: path.join(resolvedDirectory, path.basename(output)),
    async save(receipt: DriveAuthorizationReceipt) {
      await writeFile(path.join(resolvedDirectory, path.basename(output)), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 }); saved = true;
    },
    async removeIfEmpty() { if (!saved) await rmdir(resolvedDirectory).catch(() => {}); } };
}
