import assert from "node:assert/strict";
import test from "node:test";
import { verifyDriveOriginal } from "../../scripts/verify-drive-original";
import { sha256 } from "./archive-integrity";

const bytes = Buffer.from("synthetic original");
const original = { driveId: "synthetic_scan", driveFolder: "synthetic_folder", sizeBytes: BigInt(bytes.length),
  fileType: "application/pdf", sha256: sha256(bytes) };
const doc = { filePath: "drive:" + original.driveId, checksum: original.sha256, fileType: original.fileType,
  fileSize: bytes.length, archiveImportFile: original };

test("Drive verification checks the catalog and hashes the complete original", async () => {
  await verifyDriveOriginal(doc, async source => {
    assert.deepEqual(source, original);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
      controller.close();
    } }));
  });
  for (const changed of [{ checksum: null }, { filePath: "drive:another_drive_id" }, { archiveImportFile: null },
    { fileSize: bytes.length + 1 }, { fileType: "image/png" }]) {
    await assert.rejects(verifyDriveOriginal({ ...doc, ...changed }, async () => assert.fail("Catalog mismatch must stop the read")), /record disagree/);
  }
  for (const response of [new Response(null, { status: 404 }), new Response(bytes, { status: 206 }),
    new Response(bytes.subarray(1)), new Response(Buffer.alloc(bytes.length)), new Response(Buffer.alloc(bytes.length + 1))]) {
    await assert.rejects(verifyDriveOriginal(doc, async () => response), /original/i);
  }
});
