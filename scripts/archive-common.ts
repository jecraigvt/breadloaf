import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
