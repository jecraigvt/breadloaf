import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { encryptSnapshot, type SnapshotManifest } from "../../scripts/archive-common";
import { BACKUP_DRIVE_ACCOUNT, requestDriveResponse, uploadVerifiedSnapshotToDrive, type DriveTransport } from "../../scripts/archive-drive-common";

const folderId = "syntheticFolder12345", fileId = "syntheticSnapshot12345";
const phrase = "synthetic-backup-passphrase-for-tests-only";
let fixture: string, snapshot: string, encrypted: Buffer;
const checksum = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");
before(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "breadloaf-drive-test-"));
  const stage = path.join(fixture, "source"); await mkdir(path.join(stage, "originals"), { recursive: true });
  const files = { "database.dump": Buffer.from("synthetic PostgreSQL dump"), "originals/random.bin": randomBytes(4 * 1024 * 1024 + 1234) };
  const manifest: SnapshotManifest = { version: 1, createdAt: "2026-10-13T19:00:00.000Z", references: ["random.bin"], files: [] };
  for (const [name, bytes] of Object.entries(files)) { await writeFile(path.join(stage, name), bytes); manifest.files.push({ path: name, size: bytes.length, sha256: checksum("sha256", bytes) }); }
  snapshot = path.join(fixture, "snapshot.blhbackup"); await encryptSnapshot(stage, snapshot, manifest, phrase); encrypted = await readFile(snapshot);
});
after(async () => {
  if (path.dirname(path.resolve(fixture)) !== path.resolve(tmpdir()) || !path.basename(fixture).startsWith("breadloaf-drive-test-")) throw new Error("Unsafe test cleanup");
  await rm(fixture, { recursive: true, force: true });
});

interface FakeOptions { account?: string; folder?: Record<string, unknown>; metadata?: Record<string, unknown>; download?: Buffer; interruptFirstChunk?: boolean; uploadLocation?: string; quota?: string; previousCopy?: boolean; }
function fakeDrive(options: FakeOptions = {}) {
  const calls: Array<{ url: string; method: string; headers?: Record<string, string>; body?: Uint8Array | string }> = [];
  const received = Buffer.alloc(encrypted.length);
  let receivedThrough = 0, interrupted = false, statusQueries = 0;
  const respond = (value: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(value), { status, headers });
  const transport: DriveTransport = { async request(url, method, headers, body) {
    calls.push({ url, method, headers, body });
    if (url.includes("/about?")) return respond({ user: { emailAddress: options.account || BACKUP_DRIVE_ACCOUNT }, storageQuota: { limit: options.quota || "9999999999", usage: "0" } });
    if (url.includes(`/files/${folderId}?`)) return respond({ id: folderId, mimeType: "application/vnd.google-apps.folder", trashed: false, ownedByMe: true, capabilities: { canAddChildren: true }, ...options.folder });
    if (url.includes("/files?q=")) return respond({ files: options.previousCopy ? [{ id: fileId, mimeType: "application/octet-stream", trashed: false, ownedByMe: true, parents: [folderId], size: String(encrypted.length), md5Checksum: checksum("md5", encrypted), sha256Checksum: checksum("sha256", encrypted) }] : [] });
    if (method === "POST") {
      assert.equal(JSON.parse(String(body)).parents[0], folderId);
      assert.equal(JSON.parse(String(body)).mimeType, "application/octet-stream");
      return new Response(null, { status: 200, headers: { location: options.uploadLocation || "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic" } });
    }
    if (method === "PUT") {
      if (headers?.["Content-Range"]?.startsWith("bytes */")) { statusQueries++; return new Response(null, { status: 308, headers: receivedThrough ? { Range: `bytes=0-${receivedThrough - 1}` } : {} }); }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers?.["Content-Range"] || ""); assert.ok(range);
      const start = Number(range[1]), end = Number(range[2]);
      assert.equal(Number(range[3]), encrypted.length); assert.equal(start, receivedThrough);
      assert.ok(body instanceof Uint8Array); assert.equal(body.byteLength, end - start + 1);
      received.set(body, start); receivedThrough = end + 1;
      if (options.interruptFirstChunk && !interrupted) { interrupted = true; throw new Error("synthetic lost upload response"); }
      return receivedThrough === encrypted.length ? respond({ id: fileId }) : new Response(null, { status: 308, headers: { Range: `bytes=0-${receivedThrough - 1}` } });
    }
    if (url.includes("alt=media")) return new Response(new Uint8Array(options.download || encrypted));
    if (url.includes(`/files/${fileId}?`)) return respond({ id: fileId, mimeType: "application/octet-stream", trashed: false, ownedByMe: true, parents: [folderId], size: String(encrypted.length), md5Checksum: checksum("md5", encrypted), sha256Checksum: checksum("sha256", encrypted), ...options.metadata });
    throw new Error("Unexpected synthetic Drive request");
  } };
  return { transport, calls, received, statusQueries: () => statusQueries };
}
function upload(fake: ReturnType<typeof fakeDrive>, options: { input?: string; passphrase?: string; existingFileId?: string } = {}) {
  return uploadVerifiedSnapshotToDrive({ input: options.input || snapshot, passphrase: options.passphrase || phrase, folderId, transport: fake.transport, wait: async () => {}, existingFileId: options.existingFileId });
}

test("resumable upload survives a lost response and claims success only after downloading matching encrypted bytes", async () => {
  const fake = fakeDrive({ interruptFirstChunk: true });
  const receipt = await upload(fake);
  assert.equal(fake.statusQueries(), 1); assert.deepEqual(fake.received, encrypted);
  assert.equal(fake.received.subarray(0, 8).toString(), "BLHBACK1");
  assert.equal(receipt.encryptedSha256, checksum("sha256", encrypted)); assert.equal(receipt.size, encrypted.length);
  assert.equal(receipt.restoreVerified, false); assert.equal(receipt.originalCount, 1);
  assert.ok(fake.calls.at(-1)?.url.includes("alt=media"));
  assert.equal(fake.calls.filter(call => call.method === "POST").length, 1);
});
test("wrong passphrase or damaged local snapshot sends no Drive requests", async () => {
  const fake = fakeDrive(); await assert.rejects(upload(fake, { passphrase: "wrong-passphrase-at-least-twenty" }), /authentication failed/);
  const broken = path.join(fixture, "broken.blhbackup"), corrupt = Buffer.from(encrypted); corrupt[40] ^= 1; await writeFile(broken, corrupt);
  await assert.rejects(upload(fake, { input: broken }), /authentication failed/); assert.equal(fake.calls.length, 0);
});
test("wrong account, invalid folder and insufficient quota stop before creating any cloud file", async () => {
  for (const options of [{ account: "other@example.test" }, { folder: { mimeType: "application/octet-stream" } }, { folder: { trashed: true } }, { folder: { ownedByMe: false } }, { folder: { capabilities: { canAddChildren: false } } }, { quota: "1" }]) {
    const fake = fakeDrive(options); await assert.rejects(upload(fake)); assert.equal(fake.calls.some(call => call.method === "POST"), false);
  }
});
test("an unexpected resumable destination never receives encrypted bytes or authorization", async () => {
  const fake = fakeDrive({ uploadLocation: "https://example.test/upload?uploadType=resumable" });
  await assert.rejects(upload(fake), /unexpected upload session/); assert.equal(fake.calls.some(call => call.method === "PUT"), false);
});
test("Drive size, checksum or parent mismatch prevents a verified backup receipt", async () => {
  for (const metadata of [{ size: "1" }, { md5Checksum: "0".repeat(32) }, { sha256Checksum: "0".repeat(64) }, { parents: ["otherFolder12345"] }, { trashed: true }]) {
    const fake = fakeDrive({ metadata }); await assert.rejects(upload(fake, { existingFileId: fileId }), /metadata or checksum verification failed/);
    assert.equal(fake.calls.some(call => call.url.includes("alt=media")), false);
  }
});
test("a corrupt, truncated or oversized verification download cannot claim success despite matching metadata", async () => {
  const corrupt = Buffer.from(encrypted); corrupt[40] ^= 1;
  for (const download of [corrupt, encrypted.subarray(0, encrypted.length - 1), Buffer.concat([encrypted, Buffer.from([0])])]) {
    const fake = fakeDrive({ download }); await assert.rejects(upload(fake, { existingFileId: fileId }), /checksum verification failed|size or time limit/);
  }
});
test("rechecking a previous receipt verifies its independent copy without replacing or pruning anything", async () => {
  const fake = fakeDrive(); const receipt = await upload(fake, { existingFileId: fileId });
  assert.equal(receipt.driveFileId, fileId); assert.equal(receipt.restoreVerified, false);
  assert.ok(fake.calls.every(call => call.method === "GET"));
});
test("a byte-identical completed copy is recovered after a lost receipt without a second upload", async () => {
  const fake = fakeDrive({ previousCopy: true }); const receipt = await upload(fake);
  assert.equal(receipt.driveFileId, fileId); assert.ok(fake.calls.every(call => call.method === "GET"));
  assert.ok(fake.calls.at(-1)?.url.includes("alt=media"));
});
test("native HTTP transport returns Drive's 308 with Location and never follows it", async () => {
  let redirected = 0;
  const server = createServer((request, response) => {
    if (request.url === "/should-not-follow") { redirected++; response.end("unexpected"); return; }
    response.writeHead(308, { Location: `http://${request.headers.host}/should-not-follow`, Range: "bytes=0-4194303" }); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const response = await requestDriveResponse(`http://127.0.0.1:${address.port}/upload`, "PUT", "synthetic-local-token", { "Content-Range": "bytes */10000000" });
    assert.equal(response.status, 308); assert.equal(response.headers.get("range"), "bytes=0-4194303"); assert.ok(response.headers.get("location"));
    await response.body?.cancel(); assert.equal(redirected, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
