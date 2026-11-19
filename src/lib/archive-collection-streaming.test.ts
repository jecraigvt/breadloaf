import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { ArchiveCollectionStore } from "../../scripts/archive-collection-store";
import { readArchiveCollection } from "../../scripts/archive-collection";
import { fileDigest, privateStagingDirectory, removeStagingDirectory } from "../../scripts/archive-common";
import { hashScan } from "./archive-import-client";
import { ArchiveOriginalDrive } from "./archive-original-drive";

const phrase = "a disposable test phrase for this repository";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("independent recovery copies are authenticated, reused across catalogs, and verified before extraction", async () => {
  const root = await privateStagingDirectory();
  const repository = path.join(root, "encrypted");
  const restored = path.join(root, "restored");
  const store = await ArchiveCollectionStore.open(repository, phrase, true);
  try {
    const dump = Buffer.from("synthetic database");
    const original = Buffer.from("This is the original family letter fixture.");
    const database = { path: "database.dump", size: dump.length, sha256: digest(dump) };
    const file = { path: "drive/synthetic_drive_original", size: original.length, sha256: digest(original), sourcePath: "Letters/1972.pdf" };
    assert.equal(await store.retain(database, async () => Readable.from([dump])), true);
    assert.equal(await store.retain(file, async () => Readable.from([original])), true);
    assert.equal(await store.retain(file, async () => { throw new Error("unchanged file must not be fetched again"); }), false);
    const catalog = await store.publish({ version: 1, createdAt: new Date().toISOString(), files: [database, file] });
    await assert.rejects(ArchiveCollectionStore.open(repository, phrase + " wrong", true), /passphrase/);
    const verified = await readArchiveCollection({ repository, catalog, passphrase: phrase, extractTo: restored });
    assert.equal(verified.files[1].sourcePath, "Letters/1972.pdf");
    assert.equal(await fileDigest(path.join(restored, file.path)), file.sha256);
    await assert.rejects(readArchiveCollection({ repository, catalog, passphrase: phrase, extractTo: restored }), /already exists|EEXIST/);
    for (const name of await readdir(path.join(repository, "objects"))) {
      const object = await open(path.join(repository, "objects", name), "r+");
      await object.write(Buffer.from([42, 43, 44]), 0, 3, 20);
      await object.close();
    }
    await assert.rejects(readArchiveCollection({ repository, catalog, passphrase: phrase }));
  } finally {
    store.close();
    await removeStagingDirectory(root);
  }
});

// A valid two-page PDF with a large separate data stream. Write its xref offsets
// directly so creating the fixture never allocates a 600 MiB buffer.
async function writeLargePdf(file: string) {
  const handle = await open(file, "wx");
  let offset = 0;
  const xref = [];
  const write = async (text: string) => { offset += (await handle.write(text, offset, "ascii")).bytesWritten; };
  const object = async (body: string) => {
    xref.push(offset);
    await write(xref.length + " 0 obj\n" + body + "\nendobj\n");
  };
  try {
    await write("%PDF-1.4\n");
    await object("<< /Type /Catalog /Pages 2 0 R >>");
    await object("<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>");
    await object("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>");
    await object("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>");
    const text = "BT /F1 16 Tf 50 700 Td (A synthetic family letter written in October 1972 at Breadloaf Hill.) Tj ET";
    await object("<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream");
    await object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    xref.push(offset);
    const padding = 600 * 1024 ** 2;
    await write("7 0 obj\n<< /Length " + padding + " >>\nstream\n");
    offset += padding;
    await write("\nendstream\nendobj\n");
    const start = offset;
    await write("xref\n0 8\n0000000000 65535 f \n" + xref.map(position => String(position).padStart(10, "0") + " 00000 n \n").join("") +
      "trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF\n");
  } finally { await handle.close(); }
}

test("a 600 MiB PDF is read and recovered without bringing the original into memory", { skip: process.env.ARCHIVE_LARGE_FILE_TEST !== "1" }, async () => {
  const { ArchiveScanReader } = await import("./archive-scan-source");
  const root = await privateStagingDirectory();
  const file = path.join(root, "large-scan.pdf");
  const repository = path.join(root, "encrypted");
  const restored = path.join(root, "restored");
  const store = await ArchiveCollectionStore.open(repository, phrase, true);
  const signal = AbortSignal.timeout(180_000);
  const fake = new ArchiveOriginalDrive();
  let reads = 0;
  fake.verified = async () => true;
  fake.media = async () => {
    reads++;
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
  };
  const reader = new ArchiveScanReader(fake);
  const originalRss = process.memoryUsage().rss;
  let largestRss = originalRss;
  const timer = setInterval(() => { largestRss = Math.max(largestRss, process.memoryUsage().rss); }, 50);
  try {
    await writeLargePdf(file);
    const sha256 = await hashScan(await openAsBlob(file), signal);
    const size = (await stat(file)).size;
    assert.equal(sha256, await fileDigest(file));
    assert.ok(size > 600 * 1024 ** 2);
    const original = { driveId: "synthetic_large_pdf", driveFolder: "synthetic_archive_folder", sha256, sizeBytes: size, fileType: "application/pdf" };
    assert.equal(await reader.pageCount(original), 2);
    const first = await reader.render(original, 1);
    assert.ok("text" in first && first.text.includes("1972"));
    const second = await reader.render(original, 2);
    assert.ok("imageBase64" in second && second.imageBase64.length < 5 * 1024 ** 2);
    assert.equal(reads, 1, "reading another page should reuse the staged original");
    const databaseBytes = Buffer.from("synthetic database");
    const database = { path: "database.dump", size: databaseBytes.length, sha256: digest(databaseBytes) };
    const entry = { path: "drive/synthetic_large_pdf", size, sha256 };
    await store.retain(database, async () => Readable.from([databaseBytes]));
    await store.retain(entry, async () => createReadStream(file));
    const catalog = await store.publish({ version: 1, createdAt: new Date().toISOString(), files: [database, entry] });
    await readArchiveCollection({ repository, catalog, passphrase: phrase, extractTo: restored });
    assert.equal(await fileDigest(path.join(restored, entry.path)), sha256);
    const growth = Math.round((largestRss - originalRss) / 1024 ** 2);
    console.log("600 MiB scan verified and restored. Peak Node RSS grew " + growth + " MiB.");
    assert.ok(growth < 220, "streaming should avoid allocating a buffer anywhere near the file size");
  } finally {
    clearInterval(timer);
    await reader.close();
    store.close();
    await removeStagingDirectory(root);
  }
});
