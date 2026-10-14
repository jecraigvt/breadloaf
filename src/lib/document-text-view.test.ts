import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { createAuthToken } from "./auth";
import { DOC_TYPE, DOCX_TYPE } from "./document-file-types";
import { DOCUMENT_TEXT_MAX_BYTES, DOCUMENT_TEXT_MAX_CHARS, retainedDocumentTextView } from "./document-text-view";
import { GET } from "../app/api/documents/[id]/file/route";

const original = (name: string, type = "text/plain") => ({ title: "Synthetic original", fileName: name, filePath: `/uploads/${name}`, fileType: type });
const request = (token?: string, query = "view=text", extra: Record<string, string> = {}) => new NextRequest(`https://breadloafhill.com/api/documents/synthetic/file?${query}`, {
  headers: { ...(token ? { Cookie: `breadloaf_session=${token}` } : {}), ...extra },
});
async function removeFixture(root: string) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^breadloaf-(?:text-bound|text-path|word-view)-/);
  await fs.rm(resolved, { recursive: true, force: true });
}

async function routeFixture(run: (state: { token: string; document: Record<string, unknown> | null; aliases: Record<string, unknown>[]; byteReads: () => number; recordReads: () => number }) => Promise<void>) {
  const previous = { env: { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED },
    findUnique: prisma.document.findUnique, findMany: prisma.document.findMany, memory: prisma.jarvisMemory.findMany, open: fs.open };
  process.env.FAMILY_PINS = "Synthetic:9231";
  process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
  let opened = 0, records = 0;
  const state = { token: (await createAuthToken("Synthetic"))!, document: null as Record<string, unknown> | null, aliases: [] as Record<string, unknown>[], byteReads: () => opened, recordReads: () => records };
  prisma.document.findUnique = (async () => { records++; return state.document; }) as unknown as typeof prisma.document.findUnique;
  prisma.document.findMany = (async () => state.aliases) as unknown as typeof prisma.document.findMany;
  prisma.jarvisMemory.findMany = (async () => []) as unknown as typeof prisma.jarvisMemory.findMany;
  fs.open = (async (...args: Parameters<typeof fs.open>) => { opened++; return previous.open(...args); }) as typeof fs.open;
  try { await run(state); }
  finally {
    prisma.document.findUnique = previous.findUnique; prisma.document.findMany = previous.findMany; prisma.jarvisMemory.findMany = previous.memory; fs.open = previous.open;
    for (const [key, value] of Object.entries(previous.env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("unauthorized, deleted and restricted originals are denied before retained bytes are read", async () => {
  await routeFixture(async state => {
    const input = { id: "synthetic", ...original("not-read.doc", DOC_TYPE), accessScope: "family", deletedAt: null };
    state.document = input;
    assert.equal((await GET(request(), { params: Promise.resolve({ id: "synthetic" }) })).status, 401);
    assert.equal(state.recordReads(), 0);
    state.document = { ...input, deletedAt: new Date() };
    assert.equal((await GET(request(state.token), { params: Promise.resolve({ id: "synthetic" }) })).status, 404);
    for (const accessScope of ["board", "vault"]) {
      state.document = { ...input, accessScope };
      const response = await GET(request(state.token), { params: Promise.resolve({ id: "synthetic" }) });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    }
    assert.equal(state.byteReads(), 0);
    prisma.document.findUnique = (async () => { throw new Error("Synthetic database unavailable"); }) as unknown as typeof prisma.document.findUnique;
    const unavailable = await GET(request(state.token), { params: Promise.resolve({ id: "synthetic" }) });
    assert.equal(unavailable.status, 500, "An unavailable database is retryable, not a missing original");
    assert.match((await unavailable.json()).error, /try again/i);
    assert.equal(state.byteReads(), 0);
  });
});

test("a family document cannot expose the same retained path as a restricted or deleted source", async () => {
  await routeFixture(async state => {
    state.document = { id: "synthetic", ...original("not-read.doc", DOC_TYPE), accessScope: "family", deletedAt: null };
    for (const alias of [{ accessScope: "vault", deletedAt: null }, { accessScope: "family", deletedAt: new Date() }]) {
      state.aliases = [{ id: "synthetic-private-alias", filePath: "/uploads/not-read.doc", ...alias }];
      assert.equal((await GET(request(state.token), { params: Promise.resolve({ id: "synthetic" }) })).status, 403);
    }
    assert.equal(state.byteReads(), 0);
  });
});

test("the protected route returns actual original text as inert JSON and preserves ordinary range/download responses", async () => {
  const name = `synthetic-text-view-${randomUUID()}.txt`;
  const file = path.join(process.cwd(), "public", "uploads", name);
  const text = "<script>alert('synthetic')</script>\nA synthetic historical letter.";
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  try {
    await routeFixture(async state => {
      state.document = { id: "synthetic", ...original(name), accessScope: "family", deletedAt: null, aiExtractedText: "Synthetic AI replacement must never be displayed" };
      state.aliases = [state.document];
      const response = await GET(request(state.token), { params: Promise.resolve({ id: "synthetic" }) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Type")!, /^application\/json/);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.deepEqual(await response.json(), { title: "Synthetic original", fileName: name, text, truncated: false });
      assert.ok(state.byteReads() > 0);
      const ranged = await GET(request(state.token, "download=1", { Range: "bytes=0-6" }), { params: Promise.resolve({ id: "synthetic" }) });
      assert.equal(ranged.status, 206);
      assert.equal(await ranged.text(), "<script");
      assert.match(ranged.headers.get("Content-Disposition")!, /^attachment;/);
      assert.match(ranged.headers.get("Content-Range")!, /^bytes 0-6\//);
    });
  } finally { await fs.unlink(file); }
});

test("file and text bounds distinguish complete output, truncation and oversized originals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "breadloaf-text-bound-"));
  const input = original("synthetic.txt");
  const file = path.join(root, "synthetic.txt");
  try {
    await fs.writeFile(file, "a".repeat(DOCUMENT_TEXT_MAX_CHARS));
    const exact = await retainedDocumentTextView(input, root);
    const complete = await exact.json();
    assert.equal(complete.text.length, DOCUMENT_TEXT_MAX_CHARS); assert.equal(complete.truncated, false);
    await fs.writeFile(file, "a".repeat(DOCUMENT_TEXT_MAX_CHARS + 1));
    const longer = await (await retainedDocumentTextView(input, root)).json();
    assert.equal(longer.text.length, DOCUMENT_TEXT_MAX_CHARS); assert.equal(longer.truncated, true);
    await fs.writeFile(file, Buffer.alloc(DOCUMENT_TEXT_MAX_BYTES + 1, 65));
    assert.equal((await retainedDocumentTextView(input, root)).status, 413);
  } finally { await removeFixture(root); }
});

test("unsafe paths, unsupported formats and absent originals never fall back to stored text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "breadloaf-text-path-"));
  try {
    for (const filePath of ["/uploads/../synthetic.txt", "/uploads/%2e%2e%2fsynthetic.txt", "/elsewhere/synthetic.txt"]) {
      assert.equal((await retainedDocumentTextView({ ...original("synthetic.txt"), filePath }, root)).status, 404);
    }
    assert.equal((await retainedDocumentTextView(original("synthetic.pdf", "application/pdf"), root)).status, 415);
    assert.equal((await retainedDocumentTextView(original("missing.doc", DOC_TYPE), root)).status, 404);
    await fs.writeFile(path.join(root, "empty.txt"), "");
    assert.equal((await retainedDocumentTextView(original("empty.txt"), root)).status, 422);
  } finally { await removeFixture(root); }
});

test("real synthetic DOC and DOCX originals use their retained bytes; compressed expansion is bounded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "breadloaf-word-view-"));
  try {
    const docText = "Synthetic legacy Word letter.";
    const word = Buffer.alloc(512 + docText.length * 2);
    word.writeUInt16LE(0xa5ec, 0); word.writeUInt32LE(512, 0x18); word.writeUInt32LE(docText.length, 0x4c);
    word.write(docText, 512, "utf16le");
    const table = Buffer.alloc(21); table[0] = 2; table.writeUInt32LE(16, 1); table.writeUInt32LE(docText.length, 9); table.writeUInt32LE(512, 15);
    const compound = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(compound, "WordDocument", word); XLSX.CFB.utils.cfb_add(compound, "0Table", table);
    await fs.writeFile(path.join(root, "synthetic.doc"), XLSX.CFB.write(compound, { type: "buffer" }));
    const legacy = await retainedDocumentTextView(original("synthetic.doc", DOC_TYPE), root);
    assert.equal(legacy.status, 200); assert.equal((await legacy.json()).text, docText);
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic modern Word letter.</w:t></w:r></w:p></w:body></w:document>');
    await fs.writeFile(path.join(root, "synthetic.docx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    const modern = await retainedDocumentTextView(original("synthetic.docx", DOCX_TYPE), root);
    assert.equal(modern.status, 200); assert.equal((await modern.json()).text, "Synthetic modern Word letter.");
    zip.file("word/document.xml", "a".repeat(20 * 1024 * 1024 + 1));
    await fs.writeFile(path.join(root, "synthetic.docx"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    assert.equal((await retainedDocumentTextView(original("synthetic.docx", DOCX_TYPE), root)).status, 413);
  } finally { await removeFixture(root); }
});
