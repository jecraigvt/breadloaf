import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

const testUrl = process.env.BUCKY_HANDLER_TEST_DATABASE_URL;
test("background analysis undo preserves family edits and restores atomic snapshots", { skip: !testUrl }, async (t) => {
  const priorUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testUrl;
  const { prisma: db } = await import("./prisma");
  const { applyJobResult } = await import("./bucky-job-handlers");
  const { enqueueBuckyJob, completeBuckyJob } = await import("./bucky-jobs");
  const { undoBuckyLedgerEntry } = await import("./bucky-undo");
  const prefix = `undo-test-${randomUUID()}`;
  const docs: string[] = [], jobs: string[] = [], ledgers: string[] = [];
  let categoryId: string | undefined;
  try {
    const category = await db.category.create({ data: { name: `${prefix} Filing`, slug: `${prefix}-filing` } });
    categoryId = category.id;
    await db.buckyWorker.create({ data: { id: prefix, label: prefix, tokenHash: prefix, provider: "local", capabilities: ["document_analysis"] } });
    const fixture = async () => {
      const original = await db.document.create({ data: {
        title: "Original family title", fileName: "test.txt", filePath: `/uploads/${prefix}.txt`, fileType: "text/plain", fileSize: 10,
        tags: "old tags", aiSummary: "Old summary", aiExtractedText: "Old text", analysisState: "pending", analysisError: "Prior error",
      } }); docs.push(original.id);
      const question = await db.buckyQuestion.create({ data: {
        question: "Where should this be filed?", status: "open", questionType: "archive", sourceType: "document", sourceId: original.id,
      } });
      const job = await enqueueBuckyJob({ kind: "document_analysis", sourceDocumentId: original.id,
        sourceVersion: original.updatedAt.toISOString(), request: { newUpload: true, sourceDocumentIds: [original.id] } }); jobs.push(job.id);
      const token = randomUUID();
      await db.buckyJob.update({ where: { id: job.id }, data: { status: "running", generation: 1 } });
      await db.buckyJobAttempt.create({ data: { jobId: job.id, workerId: prefix, generation: 1, leaseToken: token, leaseExpiresAt: new Date(Date.now() + 300000) } });
      await completeBuckyJob(prefix, job.id, token, {
        kind: "document_analysis", title: "September Pump Maintenance", summary: "The family's pump was serviced in September.",
        extractedText: "Complete replacement source text", tags: ["new tags"], suggestedCategory: category.name, confidence: 0.99,
      }, undefined, applyJobResult);
      const ledger = await db.buckyLedgerEntry.findFirstOrThrow({ where: { sourceId: job.id, actionType: "background_document_analysis" } });
      ledgers.push(ledger.id);
      assert.equal(ledger.reversible, true);
      const completed = await db.buckyJob.findUniqueOrThrow({ where: { id: job.id } });
      await db.buckyJob.update({ where: { id: job.id }, data: { result: { ...(completed.result as Prisma.JsonObject), indexPending: false } } });
      return { original, question, job, ledger };
    };
    await t.test("undo restores every changed field, reopens questions, and schedules fresh indexing", async () => {
      const { original, question, job, ledger } = await fixture();
      await undoBuckyLedgerEntry(ledger.id, "Jeremy");
      const restored = await db.document.findUniqueOrThrow({ where: { id: original.id } });
      for (const field of ["title", "categoryId", "tags", "aiSummary", "aiExtractedText", "analysisState", "analysisError"] as const) {
        assert.equal(restored[field], original[field], field);
      }
      assert.ok(restored.updatedAt > original.updatedAt);
      const reopened = await db.buckyQuestion.findUniqueOrThrow({ where: { id: question.id } });
      assert.equal(reopened.status, "open"); assert.equal(reopened.answer, null); assert.equal(reopened.answeredAt, null); assert.equal(reopened.answeredBy, null);
      const reverted = await db.buckyLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } });
      assert.equal(reverted.revertedBy, "Jeremy"); assert.ok(reverted.revertedAt);
      assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: ledger.id, actionType: "undo_background_document_analysis" } }), 1);
      const result = (await db.buckyJob.findUniqueOrThrow({ where: { id: job.id } })).result as Prisma.JsonObject;
      assert.equal(result.indexPending, true); assert.equal(result.analysisUndone, true);
      await assert.rejects(undoBuckyLedgerEntry(ledger.id, "Someone else"), /already been undone/);
    });
    await t.test("newer human edits prevent undo without changing any record", async () => {
      const { original, ledger } = await fixture();
      const human = await db.document.update({ where: { id: original.id }, data: { tags: "A human corrected these tags" } });
      await assert.rejects(undoBuckyLedgerEntry(ledger.id, "Jeremy"), /changed again/);
      const after = await db.document.findUniqueOrThrow({ where: { id: original.id } });
      assert.deepEqual(after, human); assert.equal((await db.buckyLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).revertedAt, null);
    });
    await t.test("a newer family answer blocks the complete undo transaction", async () => {
      const { original, question, ledger } = await fixture();
      const analyzed = await db.document.findUniqueOrThrow({ where: { id: original.id } });
      await db.buckyQuestion.update({ where: { id: question.id }, data: { answer: "The family supplied a newer answer" } });
      await assert.rejects(undoBuckyLedgerEntry(ledger.id, "Jeremy"), /filing question changed/);
      assert.deepEqual(await db.document.findUniqueOrThrow({ where: { id: original.id } }), analyzed);
      assert.equal((await db.buckyQuestion.findUniqueOrThrow({ where: { id: question.id } })).answer, "The family supplied a newer answer");
    });
    await t.test("simultaneous undo requests restore once and produce one undo ledger entry", async () => {
      const { original, ledger } = await fixture();
      const attempts = await Promise.allSettled([undoBuckyLedgerEntry(ledger.id, "First"), undoBuckyLedgerEntry(ledger.id, "Second")]);
      assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
      assert.equal(await db.buckyLedgerEntry.count({ where: { sourceId: ledger.id, actionType: "undo_background_document_analysis" } }), 1);
      assert.equal((await db.document.findUniqueOrThrow({ where: { id: original.id } })).aiSummary, original.aiSummary);
    });
    await t.test("incomplete snapshots fail closed instead of clearing document fields", async () => {
      const { original, ledger } = await fixture();
      const current = await db.document.findUniqueOrThrow({ where: { id: original.id } });
      await db.buckyLedgerEntry.update({ where: { id: ledger.id }, data: { beforeState: { documentId: original.id, title: original.title } } });
      await assert.rejects(undoBuckyLedgerEntry(ledger.id, "Jeremy"), /snapshot is incomplete/);
      assert.deepEqual(await db.document.findUniqueOrThrow({ where: { id: original.id } }), current);
    });
  } finally {
    await db.buckyLedgerEntry.deleteMany({ where: { OR: [{ id: { in: ledgers } }, { sourceId: { in: ledgers } }] } });
    await db.buckyQuestion.deleteMany({ where: { sourceId: { in: docs } } });
    await db.buckyJob.deleteMany({ where: { id: { in: jobs } } });
    await db.document.deleteMany({ where: { id: { in: docs } } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.buckyWorker.deleteMany({ where: { id: prefix } });
    await db.$disconnect();
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
  }
});
