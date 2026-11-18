import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { privateStagingDirectory, removeStagingDirectory, safeArchivePath, type SnapshotManifest } from "./archive-common";

// Preserve the original authenticated envelope, including its exact salt, IV and tag layout.
const MAGIC = Buffer.from("BLHBACK1");
const HEADER_BYTES = 36;
const TAG_BYTES = 16;
// NIST SP 800-38D: maximum plaintext length per GCM invocation, in bytes.
const MAX_GCM_BYTES = 2 ** 36 - 32;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

function manifestIndex(manifest: SnapshotManifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 10001 ||
      !Array.isArray(manifest.references) || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Invalid backup manifest.");
  const files = new Map<string, SnapshotManifest["files"][number]>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !safeArchivePath(file.path) ||
        (file.path !== "database.dump" && !file.path.startsWith("originals/"))) throw new Error("Unsafe backup entry.");
    if (files.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid backup file record.");
    files.set(file.path, file);
  }
  for (const name of files.keys()) {
    for (let slash = name.lastIndexOf("/"); slash >= 0; slash = name.lastIndexOf("/", slash - 1)) {
      if (files.has(name.slice(0, slash))) throw new Error("Conflicting backup paths.");
    }
  }
  if (!files.has("database.dump") || manifest.references.some(ref => typeof ref !== "string" || !files.has(`originals/${ref}`))) {
    throw new Error("Backup is missing a database or referenced original.");
  }
  return files;
}

export async function encryptSnapshot(stage: string, output: string, manifest: SnapshotManifest, phrase: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  manifestIndex(manifest);
  const metadata = Buffer.from(JSON.stringify(manifest));
  if (metadata.length > MAX_MANIFEST_BYTES) throw new Error("Backup manifest exceeds its limit.");
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(phrase, salt, 32);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  key.fill(0);
  cipher.setAAD(header);
  await writeFile(output, header, { flag: "wx", mode: 0o600 });
  try {
    const zip = new yazl.ZipFile();
    const outputStream = zip.outputStream as Readable;
    zip.on("error", error => outputStream.destroy(error));
    zip.addBuffer(metadata, "manifest.json");
    // Open each source only when the previous entry has drained. ZIP64 is used
    // automatically when a size or central directory offset exceeds ZIP32.
    for (const file of manifest.files) {
      zip.addReadStreamLazy(file.path, { size: file.size }, callback => {
        const source = createReadStream(path.join(stage, file.path), { signal });
        source.on("error", error => outputStream.destroy(error));
        const stop = () => source.destroy();
        outputStream.once("close", stop);
        source.once("close", () => outputStream.off("close", stop));
        callback(null, source);
      });
    }
    zip.end();
    await pipeline(outputStream, cipher, createWriteStream(output, { flags: "a" }), { signal });
    await appendFile(output, cipher.getAuthTag());
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

async function authenticate(input: string, plaintextZip: string, phrase: string, signal?: AbortSignal) {
  const file = await open(input, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(HEADER_BYTES), tag = Buffer.alloc(TAG_BYTES);
    if (!Number.isSafeInteger(size) || size <= HEADER_BYTES + TAG_BYTES || size - HEADER_BYTES - TAG_BYTES > MAX_GCM_BYTES ||
        (await file.read(header, 0, header.length, 0)).bytesRead !== header.length || !header.subarray(0, 8).equals(MAGIC) ||
        (await file.read(tag, 0, tag.length, size - TAG_BYTES)).bytesRead !== tag.length) throw new Error("Unsupported archive backup format.");
    const key = scryptSync(phrase, header.subarray(8, 24), 32);
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(24));
    key.fill(0);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    // No ZIP parser sees plaintext until GCM finalization has authenticated the entire file.
    try {
      await pipeline(file.createReadStream({ start: HEADER_BYTES, end: size - TAG_BYTES - 1, autoClose: false }),
        decipher, createWriteStream(plaintextZip, { flags: "wx", mode: 0o600 }), { signal });
    } catch (error) {
      if (error instanceof Error && error.message.includes("unable to authenticate data")) throw new Error("Backup authentication failed: wrong passphrase or damaged backup.");
      throw error;
    }
  } finally { await file.close(); }
}

async function readManifest(plaintextZip: string, signal?: AbortSignal): Promise<SnapshotManifest> {
  const zip = await yauzl.openPromise(plaintextZip, { strictFileNames: true });
  try {
    for await (const entry of zip.eachEntry()) {
      signal?.throwIfAborted();
      if (entry.fileName !== "manifest.json") continue;
      if (entry.uncompressedSize > MAX_MANIFEST_BYTES) throw new Error("Backup manifest exceeds its limit.");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of await zip.openReadStreamPromise(entry)) {
        bytes += chunk.length;
        if (bytes > MAX_MANIFEST_BYTES) throw new Error("Backup manifest exceeds its limit.");
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    throw new Error("Backup manifest is missing.");
  } finally { zip.close(); }
}

interface VerifyOptions {
  signal?: AbortSignal;
  /** Files exist in private staging only for the duration of this callback,
   * after every member and reference has passed verification. */
  onVerifiedFiles?: (stage: string, manifest: SnapshotManifest) => Promise<void>;
}

export async function verifySnapshot(input: string, phrase: string, options: VerifyOptions = {}): Promise<{ manifest: SnapshotManifest }> {
  options.signal?.throwIfAborted();
  const stage = await privateStagingDirectory();
  try {
    const plaintextZip = path.join(stage, "authenticated.zip");
    await authenticate(input, plaintextZip, phrase, options.signal);
    const manifest = await readManifest(plaintextZip, options.signal);
    const files = manifestIndex(manifest);
    const remaining = new Set(files.keys());
    const zip = await yauzl.openPromise(plaintextZip, { strictFileNames: true });
    let foundManifest = false;
    try {
      for await (const entry of zip.eachEntry()) {
        options.signal?.throwIfAborted();
        const dir = entry.fileName.endsWith("/");
        const name = dir ? entry.fileName.slice(0, -1) : entry.fileName;
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (!safeArchivePath(name) || (type && type !== (dir ? 0o040000 : 0o100000)) || entry.isEncrypted()) throw new Error("Unsafe backup entry.");
        if (dir) {
          if (files.has(name) || name === "manifest.json" || entry.uncompressedSize !== 0) throw new Error("Unexpected backup directory.");
          continue;
        }
        if (name === "manifest.json") {
          if (foundManifest) throw new Error("Duplicate backup manifest.");
          foundManifest = true;
          continue;
        }
        const expected = files.get(name);
        if (!expected || !remaining.delete(name) || expected.size !== entry.uncompressedSize) throw new Error("Unmanifested, duplicate or incorrectly sized backup entry.");
        const hash = createHash("sha256");
        let count = 0;
        const verifyBytes = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          count += chunk.length;
          if (count > expected.size) return callback(new Error("Backup entry exceeds manifest size."));
          hash.update(chunk);
          callback(null, chunk);
        } });
        const destination = path.join(stage, name);
        if (options.onVerifiedFiles) await mkdir(path.dirname(destination), { recursive: true });
        const source = await zip.openReadStreamPromise(entry);
        const sink = options.onVerifiedFiles ? createWriteStream(destination, { flags: "wx", mode: 0o600 }) :
          new Writable({ write(_chunk, _encoding, callback) { callback(); } });
        await pipeline(source, verifyBytes, sink, { signal: options.signal });
        if (count !== expected.size || hash.digest("hex") !== expected.sha256) throw new Error("Backup file integrity failed.");
      }
    } finally { zip.close(); }
    if (!foundManifest || remaining.size) throw new Error("Backup is incomplete.");
    options.signal?.throwIfAborted();
    await options.onVerifiedFiles?.(stage, manifest);
    return { manifest };
  } finally { await removeStagingDirectory(stage); }
}
