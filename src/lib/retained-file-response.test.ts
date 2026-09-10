import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { byteRange, retainedFileResponse } from "./retained-file-response";

test("audio seeks support explicit, open and suffix ranges and reject unsatisfiable ranges", () => {
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange("bytes=20-39", 100), { start: 20, end: 39 });
  assert.deepEqual(byteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-12", 100), { start: 88, end: 99 });
  assert.deepEqual(byteRange("bytes=0-200", 100), { start: 0, end: 99 });
  for (const value of ["bytes=100-", "bytes=30-10", "bytes=-0", "bytes=", "bytes=1-3,5-8"]) {
    assert.throws(() => byteRange(value, 100));
  }
});

test("retained audio responds with the exact requested bytes and playable range headers", async () => {
  const name = `dictation-test-${randomUUID()}.m4a`;
  const folder = path.join(process.cwd(), "public", "uploads");
  const target = path.join(folder, name);
  const bytes = Buffer.from("0123456789abcdef");
  await mkdir(folder, { recursive: true });
  await writeFile(target, bytes);
  try {
    const file = { filePath: `/uploads/${name}`, fileName: name, fileType: "audio/mp4" };
    const response = await retainedFileResponse(new Request("http://localhost/audio", { headers: { Range: "bytes=4-9" } }), file);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-range"), "bytes 4-9/16");
    assert.equal(response.headers.get("content-length"), "6");
    assert.equal(await response.text(), "456789");
    const invalid = await retainedFileResponse(new Request("http://localhost/audio", { headers: { Range: "bytes=16-" } }), file);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */16");
  } finally { await unlink(target); }
});
