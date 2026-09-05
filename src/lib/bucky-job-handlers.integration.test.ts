import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Document, Prisma } from "@prisma/client";
import type { BackgroundSourceBundle } from "./bucky-background-contract";

// Opt in with a disposable, schema-complete database. Fixtures have unique IDs;
// cleanup touches only rows and files created by this invocation.
const testUrl = process.env.BUCKY_HANDLER_TEST_DATABASE_URL;
test("background source and result handler integration", { skip: !testUrl }, async (t) => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testUrl;
  const { prisma: db } = await import("./prisma");
  const { prepareJobSource, applyJobResult } = await import("./bucky-job-handlers");
  const { completeBuckyJob, enqueueBuckyJob } = await import("./bucky-jobs");
  const prefix = `handler-test-${randomUUID()}`;
  const workerId = `${prefix}-worker`;
  const files: string[] = [], documentIds: string[] = [], jobIds: string[] = [];
  let categoryId: string | undefined;
  const hash = (body: string) => createHash("sha256").update(body).digest("hex");
  const source = async (text: string, overrides: Partial<Prisma.DocumentCreateInput> = {}) => {
    const name = `${prefix}-${files.length}.txt`;
    const filePath = path.join(process.cwd(), "public", "uploads", name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, text); files.push(filePath);
    const doc = await db.document.create({ data: {
      title: "Untitled source", fileName: name, filePath: `/uploads/${name}`, fileType: "text/plain",
      fileSize: Buffer.byteLength(text), checksum: hash(text), analysisState: "pending", ...overrides,
    } });
    documentIds.push(doc.id); return doc;
  };
  const jobFor = async (doc: Document, newUpload = true) => {
    const job = await enqueueBuckyJob({ kind: "document_analysis", request: { sourceDocumentIds: [doc.id], newUpload },
      sourceDocumentId: doc.id, sourceVersion: doc.updatedAt.toISOString(), initiatedByName: "Integration tester" });
    jobIds.push(job.id); return job;
  };
  const lease = async (jobId: string) => {
    const token = randomUUID();
    await db.$transaction(async (tx) => {
      await tx.buckyJob.update({ where: { id: jobId }, data: { status: "running", generation: 1 } });
      await tx.buckyJobAttempt.create({ data: { jobId, workerId, generation: 1, leaseToken: token, leaseExpiresAt: new Date(Date.now() + 300_000) } });
    });
    return token;
  };
  const result = (category: string) => ({ kind: "document_analysis", title: "September Pump Service Record",
    summary: "The pump was serviced in September. The record includes its maintenance notes.",
    extractedText: "Original maintenance notes, transcribed completely.", tags: ["pump", "maintenance"],
    suggestedCategory: category, confidence: 0.95 });
  const bundle = async (job: Awaited<ReturnType<typeof jobFor>>, part?: string) => JSON.parse((await prepareJobSource(job, part)).body) as BackgroundSourceBundle;
  try {
    await db.buckyWorker.create({ data: { id: workerId, label: prefix, tokenHash: hash(prefix), provider: "local", capabilities: ["document_analysis"] } });
    const category = await db.category.create({ data: { name: `${prefix} Documents`, slug: `${prefix}-documents` } });
    categoryId = category.id;
    await t.test("the manifest and individual text parts retain every source character", async () => {
      const text = "Opening words.\n" + "Every page must survive.\n".repeat(1500) + "THE FINAL SOURCE WORDS";
      const doc = await source(text); const job = await jobFor(doc);
      const manifest = await bundle(job);
      assert.ok(manifest.parts.length > 2);
      assert.ok(manifest.parts.every((part) => part.text === undefined));
      let all = "";
      for (const part of manifest.parts) {
        const selected = await bundle(job, part.id);
        assert.equal(selected.parts.length, 1); assert.equal(selected.parts[0].sourceId, doc.id);
        all += selected.parts[0].text;
      }
      assert.equal(all, text);
      await assert.rejects(bundle(job, `${doc.id}:text:9999`), /Source part not found/);
    });
    await t.test("traversal, corrupt original bytes, and access changes fail closed", async () => {
      const outside = path.join(process.cwd(), "public", `${prefix}-outside.txt`);
      await writeFile(outside, "outside secret fixture"); files.push(outside);
      const traversing = await source("benign", { filePath: `/uploads/../${path.basename(outside)}`, checksum: null });
      await assert.rejects(bundle(await jobFor(traversing)), /Invalid source file/);
      const corrupt = await source("actual source", { checksum: "0".repeat(64) });
      await assert.rejects(bundle(await jobFor(corrupt)), /checksum does not match/);
      const scoped = await source("family document"); const job = await jobFor(scoped);
      await db.document.update({ where: { id: scoped.id }, data: { accessScope: "board" } });
      await assert.rejects(bundle(job), /removed or its access changed/);
    });
    await t.test("completion atomically files the document, closes its question, and records attribution once", async () => {
      const doc = await source("The pump needs service."); const job = await jobFor(doc);
      const question = await db.buckyQuestion.create({ data: { question: "Where does this belong?", sourceType: "document", sourceId: doc.id, questionType: "archive" } });
      const token = await lease(job.id);
      const first = await completeBuckyJob(workerId, job.id, token, result(category.name), undefined, applyJobResult);
      assert.equal(first.job.status, "succeeded");
      const updated = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
      assert.equal(updated.categoryId, category.id); assert.equal(updated.analysisState, "ok");
      assert.equal(updated.aiSummary, result(category.name).summary); assert.equal(updated.aiExtractedText, result(category.name).extractedText);
      assert.equal(updated.title, result(category.name).title); assert.equal(updated.tags, "pump, maintenance");
      assert.equal((await db.buckyQuestion.findUniqueOrThrow({ where: { id: question.id } })).status, "answered");
      const ledger = await db.buckyLedgerEntry.findMany({ where: { sourceId: job.id } });
      assert.equal(ledger.length, 1); assert.equal(ledger[0].initiatedBy, "Integration tester");
      assert.equal(ledger[0].entityId, doc.id); assert.equal((first.job.result as Record<string, unknown>).indexPending, true);
      const duplicate = await completeBuckyJob(workerId, job.id, token, { ...result(category.name), summary: "Should never replace the first answer" }, undefined, applyJobResult);
      assert.equal(duplicate.duplicate, true); assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: job.id } }), 1);
      assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).aiSummary, result(category.name).summary);
    });
    await t.test("human edits and deleted documents produce review results without overwriting records", async () => {
      for (const change of ["edited", "deleted", "scope"] as const) {
        const doc = await source("original", { aiSummary: "The family's existing summary" });
        const job = await jobFor(doc); const token = await lease(job.id);
        await db.document.update({ where: { id: doc.id }, data: change === "edited"
          ? { title: "A human's corrected title", updatedAt: new Date(doc.updatedAt.getTime() + 1000) }
          : change === "deleted" ? { deletedAt: new Date() } : { accessScope: "board" } });
        const done = await completeBuckyJob(workerId, job.id, token, result(category.name), undefined, applyJobResult);
        assert.equal(done.job.status, "needs_review");
        const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
        assert.equal(after.aiSummary, "The family's existing summary"); assert.equal(after.categoryId, null);
        if (change === "edited") assert.equal(after.title, "A human's corrected title");
        assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: job.id } }), 0);
      }
    });
    await t.test("malformed structured results leave the lease, document, category, and ledger untouched", async () => {
      const doc = await source("source"); const job = await jobFor(doc); const token = await lease(job.id);
      await assert.rejects(completeBuckyJob(workerId, job.id, token, { ...result(category.name), confidence: 4 }, undefined, applyJobResult));
      const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
      assert.equal(after.analysisState, "pending"); assert.equal(after.categoryId, null); assert.equal(after.aiSummary, null);
      assert.equal((await db.buckyJob.findUniqueOrThrow({ where: { id: job.id } })).status, "running");
      assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: job.id } }), 0);
      const wrongKind = { kind: "archive_review", summary: "Wrong result shape for document job", findings: [] };
      await assert.rejects(completeBuckyJob(workerId, job.id, token, wrongKind, undefined, applyJobResult), /kind does not match/);
    });
    await t.test("an error after document/category/question/ledger writes rolls back the entire completion", async () => {
      const doc = await source("source"); const job = await jobFor(doc); const token = await lease(job.id);
      const question = await db.buckyQuestion.create({ data: { question: "Where?", sourceType: "document", sourceId: doc.id, questionType: "archive" } });
      await assert.rejects(completeBuckyJob(workerId, job.id, token, result(category.name), undefined, async (tx, current, input) => {
        await applyJobResult(tx, current, input); throw new Error("Simulated final transaction failure");
      }));
      const after = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
      assert.equal(after.categoryId, null); assert.equal(after.analysisState, "pending"); assert.equal(after.aiSummary, null);
      assert.equal((await db.buckyQuestion.findUniqueOrThrow({ where: { id: question.id } })).status, "open");
      assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: job.id } }), 0);
    });
  } finally {
    await db.buckyLedgerEntry.deleteMany({ where: { sourceId: { in: jobIds } } });
    await db.buckyQuestion.deleteMany({ where: { sourceId: { in: documentIds } } });
    await db.buckyJob.deleteMany({ where: { id: { in: jobIds } } });
    await db.document.deleteMany({ where: { id: { in: documentIds } } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.buckyWorker.deleteMany({ where: { id: workerId } });
    for (const file of files) await unlink(file);
    await db.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});
