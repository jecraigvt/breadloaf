import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storeFileBuffer } from "./file-storage";

test("stored bytes survive and exact retries reuse the checksum path", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "breadloaf-audio-"));
  try {
    const buffer = Buffer.from("irreplaceable family voice");
    const first = await storeFileBuffer({
      buffer,
      fileName: "memory.m4a",
      contentType: "audio/mp4",
      uploadRoot,
    });
    const retry = await storeFileBuffer({
      buffer,
      fileName: "memory.m4a",
      contentType: "audio/mp4",
      uploadRoot,
    });

    assert.equal(first.alreadyExisted, false);
    assert.equal(retry.alreadyExisted, true);
    assert.equal(retry.filePath, first.filePath);
    assert.deepEqual(
      await readFile(path.join(uploadRoot, path.basename(first.filePath))),
      buffer
    );
    assert.equal((await readdir(uploadRoot)).length, 1);
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
});

test("a checksum-matched database path short-circuits a second write", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "breadloaf-audio-"));
  try {
    const retained = await storeFileBuffer({
      buffer: Buffer.from("already archived voice"),
      fileName: "memory.m4a",
      contentType: "audio/mp4",
      existingFilePath: "/uploads/existing-recording.m4a",
      uploadRoot,
    });

    assert.equal(retained.alreadyExisted, true);
    assert.equal(retained.filePath, "/uploads/existing-recording.m4a");
    assert.deepEqual(await readdir(uploadRoot), []);
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
});

test("extensionless Safari audio keeps a playable media extension", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "breadloaf-audio-"));
  try {
    const retained = await storeFileBuffer({
      buffer: Buffer.from("safari voice"),
      fileName: "recording",
      contentType: "audio/mp4",
      uploadRoot,
    });
    assert.match(retained.filePath, /\.m4a$/);
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
});
