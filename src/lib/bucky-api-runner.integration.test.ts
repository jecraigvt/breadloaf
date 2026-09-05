import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import type OpenAI from "openai";

const testUrl = process.env.BUCKY_HANDLER_TEST_DATABASE_URL;
test("hosted fallback progresses by section under real DB leases and budget", { skip: !testUrl }, async () => {
  const beforeEnv = { url: process.env.DATABASE_URL, budget: process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS, attempt: process.env.BUCKY_API_MAX_ATTEMPT_CENTS };
  process.env.DATABASE_URL = testUrl;
  process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = "300";
  process.env.BUCKY_API_MAX_ATTEMPT_CENTS = "25";
  const { prisma: db } = await import("./prisma");
  const { enqueueBuckyJob, promoteBuckyJob, cancelBuckyJob } = await import("./bucky-jobs");
  const { runHostedBuckyPart } = await import("./bucky-api-runner");
  const prefix = `api-test-${randomUUID()}`;
  const file = path.join(process.cwd(), "public", "uploads", `${prefix}.txt`);
  const jobIds: string[] = [];
  let documentId: string | undefined;
  let calls = 0;
  const generate = async (input: OpenAI.Responses.ResponseCreateParamsNonStreaming) => {
    calls++;
    assert.equal(input.store, false); assert.equal(input.max_output_tokens, 4096);
    return { status: "completed" as const, usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      output_text: JSON.stringify({ kind: "document_analysis", title: "Pump service notes", summary: "Service instructions describe the pump.", extractedText: "Model text must not replace original text", tags: ["pump"], suggestedCategory: "", confidence: 0.5 }) };
  };
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const original = "The original pump instructions. ".repeat(500) + "FINAL WORDS";
    await writeFile(file, original);
    const doc = await db.document.create({ data: { title: "Pump notes", fileName: path.basename(file), filePath: `/uploads/${path.basename(file)}`, fileType: "text/plain", fileSize: original.length, analysisState: "pending" } });
    documentId = doc.id;
    await db.buckyWorker.create({ data: { id: prefix, label: prefix, tokenHash: prefix, provider: "api", capabilities: ["document_analysis"] } });
    const job = await enqueueBuckyJob({ kind: "document_analysis", sourceDocumentId: doc.id, sourceVersion: doc.updatedAt.toISOString(), request: { sourceDocumentIds: [doc.id], newUpload: true } });
    jobIds.push(job.id);
    assert.equal((await runHostedBuckyPart(prefix, generate)).state, "idle"); assert.equal(calls, 0);
    await promoteBuckyJob(job.id);
    assert.equal((await runHostedBuckyPart(prefix, generate)).state, "continued");
    const partial = await db.buckyJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(partial.status, "queued"); assert.ok(partial.checkpoint);
    assert.equal((await runHostedBuckyPart(prefix, generate)).state, "completed");
    const finished = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    assert.ok(finished.aiExtractedText?.endsWith("FINAL WORDS"));
    assert.equal(finished.aiExtractedText?.replace(/Section \d+\n/g, "").replace(/\n\n/g, ""), original);
    const attempts = await db.buckyJobAttempt.findMany({ where: { jobId: job.id }, orderBy: { generation: "asc" } });
    assert.deepEqual(attempts.map((a) => a.status), ["yielded", "succeeded"]);
    assert.deepEqual(attempts.map((a) => a.costCents), [1, 1]);
    const noBudget = await enqueueBuckyJob({ kind: "document_analysis", request: { sourceDocumentIds: [doc.id] }, sourceDocumentId: doc.id, sourceVersion: finished.updatedAt.toISOString(), priority: 100 });
    jobIds.push(noBudget.id);
    process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = "0";
    assert.equal((await runHostedBuckyPart(prefix, generate)).state, "idle"); assert.equal(calls, 2);
    await cancelBuckyJob(noBudget.id);
  } finally {
    await db.buckyLedgerEntry.deleteMany({ where: { sourceId: { in: jobIds }, sourceType: "background_job" } });
    await db.buckyJob.deleteMany({ where: { id: { in: jobIds } } });
    await db.buckyWorker.deleteMany({ where: { id: prefix } });
    if (documentId) await db.document.deleteMany({ where: { id: documentId } });
    await unlink(file).catch(() => undefined);
    await db.$disconnect();
    process.env.DATABASE_URL = beforeEnv.url;
    if (beforeEnv.budget === undefined) delete process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS; else process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = beforeEnv.budget;
    if (beforeEnv.attempt === undefined) delete process.env.BUCKY_API_MAX_ATTEMPT_CENTS; else process.env.BUCKY_API_MAX_ATTEMPT_CENTS = beforeEnv.attempt;
  }
});
