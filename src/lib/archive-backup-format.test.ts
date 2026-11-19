import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import JSZip from "jszip";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encryptSnapshot, verifySnapshot } from "../../scripts/archive-format";
import { fileDigest, privateStagingDirectory, removeStagingDirectory, safeArchivePath, type SnapshotManifest } from "../../scripts/archive-common";

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
    await verifySnapshot(output, phrase, { onVerifiedFiles: async extracted => {
      assert.deepEqual(await readFile(path.join(extracted, "originals/voice.webm")), content);
    } });
    await assert.rejects(verifySnapshot(output, "another-long-test-passphrase-only"), /authentication failed/);
    const bytes = await readFile(output); bytes[45] ^= 1;
    await writeFile(path.join(stage, "tampered.blhbackup"), bytes);
    await assert.rejects(verifySnapshot(path.join(stage, "tampered.blhbackup"), phrase), /authentication failed/);
    await writeFile(path.join(stage, "secret.txt"), "outside originals");
    const traversal: SnapshotManifest = { ...manifest, files: [...manifest.files, { path: "originals/../secret.txt", size: 17, sha256: await fileDigest(path.join(stage, "secret.txt")) }] };
    await assert.rejects(encryptSnapshot(stage, path.join(stage, "traversal.blhbackup"), traversal, phrase), /Unsafe backup entry/);
    for (const unsafe of ["../escape", "originals/../../escape", "C:/secret", "/absolute", "originals\\escape", "originals/file:stream", "originals/NUL.txt", "originals/trailing.", "originals/new\nline"]) assert.equal(safeArchivePath(unsafe), false);
  } finally { await removeStagingDirectory(stage); }
});

test("the reader accepts the original JSZip envelope and withholds restored files after an integrity failure", async () => {
  const stage = await privateStagingDirectory();
  const phrase = "isolated-legacy-archive-fixture";
  const original = Buffer.from("archived original");
  const dump = Buffer.from("archived dump");
  const record = (name: string, data: Buffer) => ({ path: name, size: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  const manifest: SnapshotManifest = { version: 1, createdAt: "2026-10-13T00:00:00Z", references: ["nested/file"],
    files: [record("database.dump", dump), record("originals/nested/file", original)] };
  try {
    // Independent fixture using the pre-streaming writer's ZIP and BLHBACK1 framing.
    for (const variant of ["valid", "digest", "missing", "extra", "bad-reference", "symlink"] as const) {
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify(variant === "bad-reference" ? { ...manifest, references: ["absent"] } : manifest));
      zip.file("database.dump", dump);
      if (variant !== "missing") zip.file("originals/nested/file", variant === "digest" ? Buffer.alloc(original.length) : original,
        { unixPermissions: variant === "symlink" ? 0o120777 : 0o100600 });
      if (variant === "extra") zip.file("originals/unlisted", "unexpected");
      const salt = randomBytes(16), iv = randomBytes(12);
      const header = Buffer.concat([Buffer.from("BLHBACK1"), salt, iv]);
      const cipher = createCipheriv("aes-256-gcm", scryptSync(phrase, salt, 32), iv);
      cipher.setAAD(header);
      const payload = await zip.generateAsync({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", platform: "UNIX" });
      const bundle = path.join(stage, variant + ".blhbackup");
      await writeFile(bundle, Buffer.concat([header, cipher.update(payload), cipher.final(), cipher.getAuthTag()]));
      let callbackCount = 0;
      const result = verifySnapshot(bundle, phrase, { onVerifiedFiles: async extracted => {
        callbackCount++;
        assert.deepEqual(await readFile(path.join(extracted, "originals/nested/file")), original);
      } });
      if (variant === "valid") {
        assert.deepEqual((await result).manifest, manifest);
        assert.equal(callbackCount, 1);
      } else {
        await assert.rejects(result);
        assert.equal(callbackCount, 0);
      }
    }
  } finally { await removeStagingDirectory(stage); }
});
