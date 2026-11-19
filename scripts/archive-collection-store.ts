import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { validArchiveDriveId } from "../src/lib/archive-import-format";
import { safeArchivePath } from "./archive-common";

const magic = Buffer.from("BLHOBJ01");
const headerBytes = magic.length + 12;
const tagBytes = 16;
const maxCatalogBytes = 128 * 1024 ** 2;
const catalogNamePattern = /^catalog-[0-9T-]+Z-[0-9a-f-]{36}\.blh$/;
const digestPattern = /^[a-f0-9]{64}$/;

const entrySchema = z.object({
  path: z.string().refine(name => name === "database.dump" ||
    (name.startsWith("originals/") && safeArchivePath(name.slice(10))) ||
    (name.startsWith("drive/") && validArchiveDriveId(name.slice(6)))),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(digestPattern),
  sourcePath: z.string().max(2500).optional(),
  documentId: z.string().max(128).optional(),
});
const catalogSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  files: z.array(entrySchema),
}).refine(value => new Set(value.files.map(file => file.path)).size === value.files.length &&
  value.files.some(file => file.path === "database.dump"), "Recovery catalog has duplicate or missing files");

export type ArchiveCollectionEntry = z.infer<typeof entrySchema>;
export type ArchiveCollectionCatalog = z.infer<typeof catalogSchema>;

function digestStream(expected: Pick<ArchiveCollectionEntry, "size" | "sha256">) {
  const hash = createHash("sha256");
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.size) { callback(new Error("Recovery object is larger than expected")); return; }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      callback(bytes === expected.size && hash.digest("hex") === expected.sha256
        ? undefined : new Error("Recovery object did not match its checksum"));
    },
  });
}

export class ArchiveCollectionStore {
  private constructor(readonly root: string, private readonly key: Buffer) {}

  static async open(root: string, passphrase: string, create = false) {
    if (!path.isAbsolute(root) || passphrase.length < 20) throw new Error("Recovery requires an absolute repository path and a strong passphrase.");
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Recovery repository must be an ordinary directory.");
    const saltPath = path.join(root, "salt");
    if (create) {
      const salt = randomBytes(16);
      const initial = scryptSync(passphrase, salt, 32);
      try {
        const check = createHmac("sha256", initial).update("Breadloaf collection repository").digest();
        await writeFile(saltPath, Buffer.concat([salt, check]), { mode: 0o600, flag: "wx" }).catch(error => {
          if (error.code !== "EEXIST") throw error;
        });
      } finally { initial.fill(0); }
      await mkdir(path.join(root, "objects"), { recursive: true, mode: 0o700 });
    }
    const saltInfo = await lstat(saltPath);
    if (!saltInfo.isFile() || saltInfo.size !== 48) throw new Error("Recovery repository has an invalid key header.");
    const objects = await lstat(path.join(root, "objects"));
    if (!objects.isDirectory() || objects.isSymbolicLink()) throw new Error("Recovery object storage must be an ordinary directory.");
    const header = await readFile(saltPath);
    const key = scryptSync(passphrase, header.subarray(0, 16), 32);
    if (!timingSafeEqual(header.subarray(16), createHmac("sha256", key).update("Breadloaf collection repository").digest())) {
      key.fill(0);
      throw new Error("The recovery repository passphrase did not match.");
    }
    return new ArchiveCollectionStore(root, key);
  }

  close() { this.key.fill(0); }

  async withWriter<T>(action: () => Promise<T>) {
    const file = path.join(this.root, ".writer");
    const lock = await open(file, "wx", 0o600);
    try { return await action(); }
    finally { await lock.close(); await rm(file, { force: true }); }
  }

  private objectPath(sha256: string) {
    if (!digestPattern.test(sha256)) throw new Error("Invalid recovery checksum");
    return path.join(this.root, "objects", createHmac("sha256", this.key).update(sha256).digest("hex") + ".blh");
  }

  private async seal(file: string, label: string, bytes: Readable, verify?: Transform) {
    const header = Buffer.concat([magic, randomBytes(12)]);
    const cipher = createCipheriv("aes-256-gcm", this.key, header.subarray(magic.length));
    cipher.setAAD(Buffer.concat([header, Buffer.from(label)]));
    await writeFile(file, header, { mode: 0o600, flag: "wx" });
    const output = createWriteStream(file, { flags: "a" });
    if (verify) await pipeline(bytes, verify, cipher, output);
    else await pipeline(bytes, cipher, output);
    await appendFile(file, cipher.getAuthTag());
  }

  private async openSealed(file: string, label: string, expectedSize: number) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedSize + headerBytes + tagBytes) throw new Error("Invalid encrypted recovery object");
    const header = Buffer.alloc(headerBytes);
    const tag = Buffer.alloc(tagBytes);
    const handle = await open(file, "r");
    try {
      await handle.read(header, 0, headerBytes, 0);
      await handle.read(tag, 0, tagBytes, info.size - tagBytes);
    } finally { await handle.close(); }
    if (!header.subarray(0, magic.length).equals(magic)) throw new Error("Invalid encrypted recovery header");
    const cipher = createDecipheriv("aes-256-gcm", this.key, header.subarray(magic.length));
    cipher.setAAD(Buffer.concat([header, Buffer.from(label)]));
    cipher.setAuthTag(tag);
    const input = expectedSize ? createReadStream(file, { start: headerBytes, end: info.size - tagBytes - 1 }) : Readable.from([]);
    return { input, cipher };
  }

  private async readObject(file: string, entry: ArchiveCollectionEntry, target?: string) {
    const { input, cipher } = await this.openSealed(file, entry.sha256, entry.size);
    const output = target ? createWriteStream(target, { flags: "wx", mode: 0o600 }) : new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    await pipeline(input, cipher, digestStream(entry), output);
  }

  async retain(entry: ArchiveCollectionEntry, source: () => Promise<Readable>): Promise<boolean> {
    const file = this.objectPath(entry.sha256);
    const existing = await lstat(file).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      await this.readObject(file, entry);
      return false;
    }
    const pending = file + "." + randomUUID() + ".partial";
    try {
      await this.seal(pending, entry.sha256, await source(), digestStream(entry));
      await this.readObject(pending, entry);
      await rename(pending, file);
      return true;
    } finally { await rm(pending, { force: true }); }
  }

  verify(entry: ArchiveCollectionEntry) {
    return this.readObject(this.objectPath(entry.sha256), entry);
  }

  async extract(entry: ArchiveCollectionEntry, target: string) {
    // Authentication completes before the restored file is published.
    const pending = target + "." + randomUUID() + ".partial";
    try {
      await this.readObject(this.objectPath(entry.sha256), entry, pending);
      await rename(pending, target);
    } finally { await rm(pending, { force: true }); }
  }

  async publish(catalog: ArchiveCollectionCatalog) {
    const validated = catalogSchema.parse(catalog);
    const name = "catalog-" + validated.createdAt.replace(/[:.]/g, "-") + "-" + randomUUID() + ".blh";
    const final = path.join(this.root, name);
    const bytes = Buffer.from(JSON.stringify(validated));
    if (bytes.length > maxCatalogBytes) throw new Error("The recovery catalog exceeds the metadata limit.");
    const pending = final + ".partial";
    try {
      await this.seal(pending, name, Readable.from([bytes]));
      await rename(pending, final);
      await this.catalog(name);
      return name;
    } finally { await rm(pending, { force: true }); }
  }

  async catalog(name: string): Promise<ArchiveCollectionCatalog> {
    if (!catalogNamePattern.test(name)) throw new Error("Choose a catalog file from the recovery repository.");
    const file = path.join(this.root, name);
    const size = (await lstat(file)).size - headerBytes - tagBytes;
    if (size < 2 || size > maxCatalogBytes) throw new Error("Invalid encrypted catalog size.");
    const { input, cipher } = await this.openSealed(file, name, size);
    const chunks: Buffer[] = [];
    await pipeline(input, cipher, new Writable({
      write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); },
    }));
    return catalogSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }
}
