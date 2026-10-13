import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";

const MAGIC = Buffer.from("BLHBACK1");
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export interface SnapshotFile { path: string; size: number; sha256: string; }
export interface SnapshotManifest { version: 1; createdAt: string; files: SnapshotFile[]; references: string[]; }
export function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
export function backupPassphrase(): string {
  const phrase = process.env.ARCHIVE_BACKUP_PASSPHRASE;
  if (!phrase || phrase.length < 20) throw new Error("Set ARCHIVE_BACKUP_PASSPHRASE to at least 20 characters. Keep it outside source control.");
  return phrase;
}
export function safeArchivePath(name: string): boolean {
  return Boolean(name) && !/[\x00-\x1f\\:]/.test(name) && !name.startsWith("/") && name.split("/").every(part => part !== ".." && part !== "." && part !== "" && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function runProgram(executable: string, args: string[], environment: NodeJS.ProcessEnv = process.env, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let couldNotRun = false;
    let forcedKill: NodeJS.Timeout | undefined;
    const stop = () => {
      couldNotRun = true;
      child.kill("SIGTERM");
      if (!forcedKill) {
        forcedKill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 2000);
        forcedKill.unref();
      }
    };
    const timeout = options.timeoutMs ? setTimeout(stop, options.timeoutMs) : undefined;
    timeout?.unref();
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    child.stdout.on("data", chunk => { if (output.length < 100000) output += String(chunk); });
    // Avoid echoing tool arguments, credentials, or private source details.
    child.stderr.resume();
    child.on("error", () => { couldNotRun = true; });
    // Wait for close before callers remove plaintext staging; aborting a native
    // process can emit error before its output file handle is actually closed.
    child.on("close", code => {
      if (timeout) clearTimeout(timeout); if (forcedKill) clearTimeout(forcedKill);
      options.signal?.removeEventListener("abort", stop);
      !couldNotRun && code === 0 ? resolve(output) : reject(new Error(`${path.basename(executable)} could not complete. Check the native tool configuration or backup deadline.`));
    });
  });
}
export function postgresEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("A PostgreSQL connection is required.");
  const runtime = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "PGSSLROOTCERT"].includes(key.toUpperCase())));
  return { ...runtime, NODE_ENV: process.env.NODE_ENV || "production", PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") || "prefer", PGCONNECT_TIMEOUT: "15" };
}
export async function privateStagingDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "breadloaf-archive-"));
  if (process.platform === "win32") {
    const identity = await runProgram("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
    const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error("Could not determine private staging directory permissions.");
    await runProgram("icacls.exe", [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"]);
  } else await chmod(directory, 0o700);
  return directory;
}
export async function removeStagingDirectory(directory: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("breadloaf-archive-")) throw new Error("Refusing cleanup outside archive staging.");
  await rm(resolved, { recursive: true, force: true });
}
export async function originalsInventory(root: string, prefix = ""): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safeArchivePath(name) || entry.isSymbolicLink()) throw new Error("Originals must contain ordinary files and safe relative paths, without symlinks.");
    if (entry.isDirectory()) files.push(...await originalsInventory(root, name));
    else if (entry.isFile()) {
      const fullPath = path.join(root, name);
      const size = (await stat(fullPath)).size;
      files.push({ path: `originals/${name}`, size, sha256: await fileDigest(fullPath) });
    } else throw new Error("Unsupported filesystem entry in originals.");
    if (files.length > 10000) throw new Error("Archive exceeds the 10,000-file tooling limit.");
  }
  return files;
}
export async function encryptSnapshot(stage: string, output: string, manifest: SnapshotManifest, phrase: string, signal?: AbortSignal): Promise<void> {
  if (manifest.files.reduce((sum, file) => sum + file.size, 0) > MAX_ARCHIVE_BYTES) throw new Error("Snapshot exceeds the 512 MB tooling limit; use a streaming backup service for larger archives.");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  for (const file of manifest.files) zip.file(file.path, createReadStream(path.join(stage, file.path)));
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(phrase, salt, 32);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(header);
  await writeFile(output, header, { flag: "wx", mode: 0o600 });
  try {
    await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE" }), cipher, createWriteStream(output, { flags: "a", mode: 0o600 }), { signal });
    await appendFile(output, cipher.getAuthTag());
  } catch (error) { await rm(output, { force: true }); throw error; }
  finally { key.fill(0); }
}
export async function verifySnapshot(input: string, phrase: string): Promise<{ zip: JSZip; manifest: SnapshotManifest }> {
  if ((await stat(input)).size > MAX_ARCHIVE_BYTES + 1024 * 1024) throw new Error("Encrypted snapshot exceeds the 512 MB tooling limit.");
  const bytes = await readFile(input);
  if (bytes.length < 52 || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error("Unsupported archive backup format.");
  const key = scryptSync(phrase, bytes.subarray(8, 24), 32);
  let payload: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(24, 36));
    decipher.setAAD(bytes.subarray(0, 36)); decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    payload = Buffer.concat([decipher.update(bytes.subarray(36, bytes.length - 16)), decipher.final()]);
  } catch { throw new Error("Backup authentication failed: wrong passphrase or damaged backup."); }
  finally { key.fill(0); }
  // AEAD authenticates the entire bundle. Validate declared sizes before
  // decompressing entries; CRC verification here would eagerly inflate all.
  const zip = await JSZip.loadAsync(payload);
  for (const entry of Object.values(zip.files)) {
    const name = entry.dir ? entry.name.replace(/\/$/, "") : entry.name;
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    if (!safeArchivePath(name) || original && !safeArchivePath(original) || (Number(entry.unixPermissions) & 0o170000) === 0o120000) throw new Error("Unsafe backup entry.");
  }
  const metadata = zip.file("manifest.json");
  if (!metadata) throw new Error("Backup manifest is missing.");
  const zipSize = (entry: JSZip.JSZipObject) => (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if ((zipSize(metadata) ?? Infinity) > 4 * 1024 * 1024) throw new Error("Backup manifest exceeds its limit.");
  const manifest = JSON.parse(await metadata.async("string")) as SnapshotManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.references) || manifest.files.length > 10001) throw new Error("Invalid backup manifest.");
  let total = 0;
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (!safeArchivePath(file.path) || file.path !== "database.dump" && !file.path.startsWith("originals/") || names.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid backup file record.");
    total += file.size; if (total > MAX_ARCHIVE_BYTES) throw new Error("Backup exceeds the extraction limit.");
    names.add(file.path);
    const entry = zip.file(file.path); if (!entry) throw new Error("Backup is incomplete.");
    if (zipSize(entry) !== file.size) throw new Error("Backup entry size does not match the manifest.");
    const content = await entry.async("nodebuffer");
    if (content.length !== file.size || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error("Backup file integrity failed.");
  }
  if (!names.has("database.dump") || manifest.references.some(reference => !names.has(`originals/${reference}`))) throw new Error("Backup is missing a database or referenced original.");
  if (Object.values(zip.files).some(entry => !entry.dir && entry.name !== "manifest.json" && !names.has(entry.name))) throw new Error("Backup contains unmanifested files.");
  return { zip, manifest };
}
export async function independentOutput(output: string, originals: string): Promise<string> {
  const destination = path.resolve(output);
  await mkdir(path.dirname(destination), { recursive: true });
  const parent = await realpath(path.dirname(destination));
  for (const protectedRoot of [await realpath(process.cwd()), await realpath(originals)]) {
    const relative = path.relative(protectedRoot, parent);
    if (!relative || !relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Choose a backup destination outside the application and originals directories.");
  }
  return path.join(parent, path.basename(destination));
}
