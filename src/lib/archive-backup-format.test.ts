import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encryptSnapshot, fileDigest, privateStagingDirectory, removeStagingDirectory, safeArchivePath, verifySnapshot, type SnapshotManifest } from "../../scripts/archive-common";

test("encrypted archive retains exact originals and rejects wrong keys or modified snapshots", async () => {
  const stage = await privateStagingDirectory();
  try {
    await mkdir(path.join(stage, "originals"));
    await writeFile(path.join(stage, "database.dump"), "synthetic database dump");
    const content = Buffer.from([0, 255, 12, 88, 1]);
    await writeFile(path.join(stage, "originals", "voice.webm"), content);
    const manifest: SnapshotManifest = { version: 1, createdAt: "2026-10-13T00:00:00Z", references: ["voice.webm"], files: [
      { path: "database.dump", size: 23, sha256: await fileDigest(path.join(stage, "database.dump")) },
      { path: "originals/voice.webm", size: content.length, sha256: await fileDigest(path.join(stage, "originals", "voice.webm")) },
    ] };
    const output = path.join(stage, "snapshot.blhbackup");
    const phrase = "a-long-random-test-passphrase-only";
    await encryptSnapshot(stage, output, manifest, phrase);
    const verified = await verifySnapshot(output, phrase);
    assert.deepEqual(await verified.zip.file("originals/voice.webm")!.async("nodebuffer"), content);
    await assert.rejects(verifySnapshot(output, "another-long-test-passphrase-only"), /authentication failed/);
    const bytes = await readFile(output); bytes[45] ^= 1;
    await writeFile(path.join(stage, "tampered.blhbackup"), bytes);
    await assert.rejects(verifySnapshot(path.join(stage, "tampered.blhbackup"), phrase), /authentication failed/);
    await writeFile(path.join(stage, "secret.txt"), "outside originals");
    const traversal: SnapshotManifest = { ...manifest, files: [...manifest.files, { path: "originals/../secret.txt", size: 17, sha256: await fileDigest(path.join(stage, "secret.txt")) }] };
    await encryptSnapshot(stage, path.join(stage, "traversal.blhbackup"), traversal, phrase);
    await assert.rejects(verifySnapshot(path.join(stage, "traversal.blhbackup"), phrase), /Unsafe backup entry/);
    for (const unsafe of ["../escape", "originals/../../escape", "C:/secret", "/absolute", "originals\\escape", "originals/file:stream", "originals/NUL.txt", "originals/trailing.", "originals/new\nline"]) assert.equal(safeArchivePath(unsafe), false);
  } finally { await removeStagingDirectory(stage); }
});
