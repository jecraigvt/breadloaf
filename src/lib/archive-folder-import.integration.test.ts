import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { ActorContext } from "./actor";
import { privateStagingDirectory, removeStagingDirectory } from "../../scripts/archive-common";

const testUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
const folder = "synthetic_archive_folder";
const owner = { emailAddress: "breadloafhillsite@gmail.com" };
const firstLength = 256 * 1024;
const bytes = Buffer.alloc(firstLength + 237, 97);
const checksum = createHash("sha256").update(bytes).digest("hex");

test("a resumed import saves one verified original, checkpoints pages, and opens a private source citation", { skip: !testUrl }, async () => {
  const url = new URL(testUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const config = {
    DATABASE_URL: testUrl,
    FAMILY_PINS: "Synthetic:9231",
    FAMILY_EMAIL_SIGN_IN_ENABLED: "false",
    ARCHIVE_DRIVE_CLIENT_ID: "mock", ARCHIVE_DRIVE_CLIENT_SECRET: "mock",
    ARCHIVE_DRIVE_REFRESH_TOKEN: "mock", ARCHIVE_IMPORT_DRIVE_FOLDER_ID: folder,
  };
  const prior = Object.fromEntries(Object.keys(config).concat("ARCHIVE_RECOVERED_ORIGINALS_DIR").map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  const { prisma } = await import("./prisma");
  const { ArchiveOriginalDrive } = await import("./archive-original-drive");
  const { archiveBatchFile, createArchiveImport, prepareArchiveImportFile, relayArchiveChunk } = await import("./archive-imports");
  const { archiveScanJob, checkpointArchivePage } = await import("./archive-scan-pages");
  const { claimBuckyJob, heartbeatBuckyWorker, completeBuckyJob } = await import("./bucky-jobs");
  const { applyJobResult } = await import("./bucky-job-handlers");
  const { findArchivePages } = await import("./archive-scan-search");
  const { GET } = await import("../app/api/documents/[id]/file/route");
  const { getAuthCookieName, createAuthToken } = await import("./auth");
  const stage = await privateStagingDirectory();
  const actor: ActorContext = {
    memberId: randomUUID(), displayName: "Test", fullName: "Test Member", branch: null,
    boardRole: null, isBoardMember: false, isCurator: false, verified: true,
  };
  const driveId = randomUUID();
  const workerId = randomUUID();
  let sessionStarts = 0;
  let offset = 0;
  let committed = false;
  let finalizations = 0;
  const drive = new ArchiveOriginalDrive(async (input, init) => {
    const endpoint = new URL(String(input));
    if (endpoint.hostname === "oauth2.googleapis.com") {
      return Response.json({ access_token: "mock", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.file" });
    }
    assert.equal(endpoint.hostname, "www.googleapis.com");
    if (endpoint.pathname.endsWith("/about")) return Response.json({ user: owner, storageQuota: { limit: "20000000000", usage: "100000000" } });
    if (endpoint.pathname.endsWith("/" + folder)) return Response.json({ id: folder, trashed: false, mimeType: "application/vnd.google-apps.folder", owners: [owner], capabilities: { canAddChildren: true } });
    if (endpoint.pathname.endsWith("/generateIds")) return Response.json({ ids: [driveId] });
    if (endpoint.pathname === "/upload/drive/v3/files") {
      if (!endpoint.searchParams.has("upload_id")) {
        sessionStarts++;
        assert.equal(JSON.parse(String(init?.body)).id, driveId);
        return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic" } });
      }
      const range = new Headers(init?.headers).get("Content-Range")!;
      if (!range.startsWith("bytes */")) {
        const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
        let size = 0;
        for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; }
        const start = Number(range.match(/^bytes (\d+)-/)?.[1]);
        assert.equal(start, offset);
        offset += size;
        committed = offset === bytes.length;
      }
      return committed ? new Response(null, { status: 200 }) :
        new Response(null, { status: 308, headers: offset ? { Range: "bytes=0-" + (offset - 1) } : {} });
    }
    if (endpoint.pathname.endsWith("/" + driveId)) {
      if (!committed) return new Response(null, { status: 404 });
      finalizations++;
      return Response.json({ id: driveId, trashed: false, mimeType: "application/pdf", size: String(bytes.length),
        sha256Checksum: checksum, owners: [owner], parents: [folder], appProperties: { breadloafScanSha256: checksum } });
    }
    throw new Error("Unexpected synthetic Drive request");
  });
  let batchId: string | undefined;
  let docId: string | undefined;
  let jobId: string | undefined;
  try {
    const request = { folderName: "Old letters", groupImages: false, sizeBytes: bytes.length, fileCount: 1, folderKey: checksum };
    const batch = await createArchiveImport(request, actor.memberId, drive);
    batchId = batch.id;
    assert.equal((await createArchiveImport(request, actor.memberId, drive)).id, batch.id);
    const fileInput = { relativePath: "Correspondence/Letter.pdf", position: 0, sizeBytes: bytes.length, sha256: checksum };
    const prepared = await prepareArchiveImportFile(batch.id, fileInput, actor, drive);
    assert.equal(prepared.state, "uploading");
    await assert.rejects(archiveBatchFile(batch.id, prepared.fileId, "different-member"), { status: 404 });
    const chunk = async (from: number, to: number) => relayArchiveChunk(
      await archiveBatchFile(batch.id, prepared.fileId, actor.memberId), actor,
      new Request("https://breadloafhill.com", { method: "PUT",
        headers: { "Content-Range": "bytes " + from + "-" + (to - 1) + "/" + bytes.length },
        body: new Uint8Array(bytes.subarray(from, to)),
      }), drive);
    await chunk(0, firstLength);
    const resumed = await prepareArchiveImportFile(batch.id, fileInput, actor, drive);
    assert.equal(resumed.state === "uploading" && resumed.offset, firstLength);
    assert.equal(sessionStarts, 1);
    await assert.rejects(prepareArchiveImportFile(batch.id, { ...fileInput, sha256: "0".repeat(64) }, actor, drive), { status: 409 });
    const saved = await chunk(firstLength, bytes.length);
    assert.equal(saved.state, "saved");
    if (saved.state !== "saved") throw new Error("The synthetic original was not saved");
    docId = saved.documentId;
    assert.equal((await prepareArchiveImportFile(batch.id, fileInput, actor, drive)).state, "saved");
    assert.equal(finalizations, 1);
    assert.equal(await prisma.document.count({ where: { filePath: "drive:" + driveId } }), 1);
    const job = await prisma.buckyJob.findFirstOrThrow({ where: { sourceDocumentId: docId } });
    jobId = job.id;
    assert.equal(archiveScanJob(job), true);
    await prisma.archiveImportFile.update({ where: { id: saved.fileId }, data: { pageCount: 2 } });
    await prisma.buckyWorker.create({ data: { id: workerId, label: "scan test", provider: "local",
      tokenHash: randomUUID(), capabilities: ["document_analysis"] } });
    assert.equal(await claimBuckyJob(workerId, ["document_analysis"], 90), null);
    const attempt = await claimBuckyJob(workerId, ["document_analysis"], 90, true);
    assert.equal(attempt?.job.id, job.id);
    const completion = { kind: "archive_scan_complete" };
    const page = async (number: number, text: string) => heartbeatBuckyWorker(workerId, { jobId: job.id, leaseToken: attempt!.leaseToken },
      (tx, locked) => checkpointArchivePage(tx, locked, { number, result: {
        kind: "document_analysis", title: "Family letter", summary: "A family letter", extractedText: text,
        tags: ["letters"], suggestedCategory: "", confidence: 0.95,
      } }));
    await page(1, "A scan from the family.");
    await assert.rejects(completeBuckyJob(workerId, job.id, attempt!.leaseToken, completion, undefined, applyJobResult), { status: 409 });
    await page(2, "October 1972. Dear Tom, here is the letter from the house.");
    await page(2, "This late duplicate must not replace the first acknowledged reading.");
    await completeBuckyJob(workerId, job.id, attempt!.leaseToken, completion, undefined, applyJobResult);
    const matches = await findArchivePages("Show me the letter from 1972");
    assert.ok(matches.some(match => match.id === docId && match.number === 2 && match.excerpt.includes("1972")));

    // The stream returns only the requested bytes and works with Drive disconnected.
    process.env.ARCHIVE_RECOVERED_ORIGINALS_DIR = stage;
    await writeFile(path.join(stage, driveId), bytes);
    const resource = "https://breadloafhill.com/api/documents/" + docId + "/file";
    const context = { params: Promise.resolve({ id: docId }) };
    assert.equal((await GET(new NextRequest(resource), context)).status, 401);
    const session = await createAuthToken("Synthetic");
    const headers = { Cookie: getAuthCookieName() + "=" + session, Range: "bytes=10-19" };
    const opened = await GET(new NextRequest(resource, { headers }), context);
    assert.equal(opened.status, 206);
    assert.deepEqual(Buffer.from(await opened.arrayBuffer()), bytes.subarray(10, 20));
    await prisma.document.update({ where: { id: docId }, data: { accessScope: "board" } });
    assert.equal((await GET(new NextRequest(resource, { headers }), context)).status, 403);
    assert.equal((await findArchivePages("show the letter from 1972")).some(match => match.id === docId), false);
  } finally {
    if (jobId) {
      await prisma.buckyJobAttempt.deleteMany({ where: { jobId } });
      await prisma.buckyJob.deleteMany({ where: { id: jobId } });
      await prisma.buckyLedgerEntry.deleteMany({ where: { sourceId: jobId } });
    }
    if (batchId) {
      await prisma.archiveImportFile.deleteMany({ where: { importId: batchId } });
      await prisma.archiveImport.deleteMany({ where: { id: batchId } });
    }
    if (docId) await prisma.document.deleteMany({ where: { id: docId } });
    await prisma.buckyWorker.deleteMany({ where: { id: workerId } });
    await prisma.$disconnect();
    await removeStagingDirectory(stage);
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("the import catalog and Bucky queue accept a full 15 GiB batch, including a file over 2 GiB", { skip: !testUrl }, async () => {
  const url = new URL(testUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, ARCHIVE_IMPORT_DRIVE_FOLDER_ID: process.env.ARCHIVE_IMPORT_DRIVE_FOLDER_ID };
  process.env.DATABASE_URL = testUrl;
  process.env.ARCHIVE_IMPORT_DRIVE_FOLDER_ID = folder;
  const { prisma } = await import("./prisma");
  const { ArchiveOriginalDrive } = await import("./archive-original-drive");
  const { createArchiveImport, prepareArchiveImportFile } = await import("./archive-imports");
  const drive = new ArchiveOriginalDrive(async () => { throw new Error("This control-plane test must stay offline"); });
  drive.checkDestination = async () => undefined;
  drive.allocateId = async () => randomUUID();
  drive.verified = async () => true;
  const actor: ActorContext = {
    memberId: randomUUID(), displayName: "Test", fullName: "Test Member", branch: null,
    boardRole: null, isBoardMember: false, isCurator: false, verified: true,
  };
  const sizes = [3 * 1024 ** 3, ...Array<number>(24).fill(512 * 1024 ** 2)];
  const total = 15 * 1024 ** 3;
  const batch = await createArchiveImport({
    folderKey: checksum, folderName: "Synthetic scan load", groupImages: false, fileCount: sizes.length, sizeBytes: total,
  }, actor.memberId, drive);
  const ids: string[] = [];
  try {
    for (const [position, sizeBytes] of sizes.entries()) {
      const value = await prepareArchiveImportFile(batch.id, {
        relativePath: "Record " + position + ".pdf", position, sizeBytes, sha256: checksum,
      }, actor, drive);
      assert.equal(value.state, "saved");
      if (value.state === "saved") ids.push(value.documentId);
    }
    assert.equal(await prisma.buckyJob.count({ where: { sourceDocumentId: { in: ids } } }), sizes.length);
    const sum = await prisma.document.aggregate({ where: { id: { in: ids } }, _sum: { fileSize: true }, _max: { fileSize: true } });
    assert.equal(sum._sum.fileSize, total);
    assert.equal(sum._max.fileSize, sizes[0]);
  } finally {
    await prisma.buckyJob.deleteMany({ where: { sourceDocumentId: { in: ids } } });
    await prisma.archiveImportFile.deleteMany({ where: { importId: batch.id } });
    await prisma.archiveImport.deleteMany({ where: { id: batch.id } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("a regular family account can open its folder imports", { skip: !testUrl }, async () => {
  const url = new URL(testUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, FAMILY_PINS: process.env.FAMILY_PINS };
  process.env.DATABASE_URL = testUrl;
  process.env.FAMILY_PINS = "Synthetic:9231";
  const { prisma } = await import("./prisma");
  const { createIdentityToken, hashIdentityToken } = await import("./identity-token");
  const { getAuthCookieName } = await import("./auth");
  const { GET } = await import("../app/api/archive/imports/route");
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const email = memberId + "@example.test";
  const data = { folderKey: checksum, folderName: "Synthetic letters", groupImages: false, fileCount: 1, sizeBytes: 1n };
  try {
    await prisma.familyMember.create({ data: { id: memberId, name: "Synthetic Member", email, accessApproved: true } });
    const token = createIdentityToken();
    await prisma.familySession.create({ data: {
      memberId, tokenHash: await hashIdentityToken(token), verifiedAt: new Date(), verifiedEmail: email,
      expiresAt: new Date(Date.now() + 3600000),
    } });
    const own = await prisma.archiveImport.create({ data: { ...data, memberId } });
    await prisma.archiveImport.create({ data: { ...data, memberId: otherMemberId } });
    const endpoint = "https://breadloafhill.com/api/archive/imports";
    const response = await GET(new NextRequest(endpoint, { headers: { Cookie: getAuthCookieName() + "=v3." + token } }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).imports.map((batch: { id: string }) => batch.id), [own.id]);
    assert.equal((await GET(new NextRequest(endpoint))).status, 401);
  } finally {
    await prisma.archiveImport.deleteMany({ where: { memberId: { in: [memberId, otherMemberId] } } });
    await prisma.familyMember.deleteMany({ where: { id: memberId } });
    await prisma.$disconnect();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
