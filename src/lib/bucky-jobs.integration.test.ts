import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Explicit opt-in only. Every run uses and removes a unique schema; never seed,
// migrate, truncate, or reset the database from DATABASE_URL in this test.
const testUrl = process.env.BUCKY_JOB_TEST_DATABASE_URL;
test("Postgres queue concurrency, fencing, recovery, and budget transactions", { skip: !testUrl }, async (t) => {
  const schema = `bucky_job_test_${randomUUID().replace(/-/g, "")}`;
  const root = new PrismaClient({ datasourceUrl: testUrl });
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const scopedUrl = new URL(testUrl!);
  scopedUrl.searchParams.set("schema", schema);
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = "300";
  process.env.BUCKY_API_MAX_ATTEMPT_CENTS = "25";
  const { prisma: db } = await import("./prisma");
  const jobs = await import("./bucky-jobs");
  const apply = async () => ({ status: "succeeded" as const });
  const reset = async () => {
    await db.buckyJob.deleteMany();
    await db.buckyApiBudget.deleteMany();
    await db.buckyWorker.deleteMany();
    process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = "300";
    for (const id of ["local-a", "local-b", "api-a", "api-b"]) {
      await db.buckyWorker.create({ data: { id, label: id, provider: id.startsWith("api") ? "api" : "local", tokenHash: id, capabilities: ["document_analysis"] } });
    }
  };
  const enqueue = (priority = 0) => jobs.enqueueBuckyJob({ kind: "document_analysis", request: { prompt: "test" }, priority });
  const claim = (worker = "local-a") => jobs.claimBuckyJob(worker, ["document_analysis"], worker.startsWith("local") ? 90 : null);
  try {
    const sql = await readFile("prisma/migrations/20260905120000_add_bucky_jobs/migration.sql", "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    await t.test("two workers claiming one job receive one lease", async () => {
      await reset(); await enqueue();
      const claims = await Promise.all([claim("local-a"), claim("local-b")]);
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(await db.buckyJobAttempt.count(), 1);
    });
    await t.test("simultaneous enqueue with one operation key produces one job", async () => {
      await reset();
      const make = () => jobs.enqueueBuckyJob({ kind: "document_analysis", request: {}, dedupeKey: "same-operation" });
      const [first, second] = await Promise.all([make(), make()]);
      assert.equal(first.id, second.id); assert.equal(await db.buckyJob.count(), 1);
    });
    await t.test("concurrent requests from one worker cannot run two jobs", async () => {
      await reset(); await enqueue(); await enqueue();
      const claims = await Promise.all([claim(), claim()]);
      assert.equal(claims.filter(Boolean).length, 1);
    });
    await t.test("quota, registered capabilities, and fallback deadlines are enforced", async () => {
      await reset(); const job = await enqueue();
      assert.equal(await jobs.claimBuckyJob("local-a", ["document_analysis"], null), null);
      assert.equal(await jobs.claimBuckyJob("local-a", ["document_analysis"], 25), null);
      assert.equal(await jobs.claimBuckyJob("local-a", ["site_improvement"], 90), null);
      assert.equal(await claim("api-a"), null);
      await jobs.promoteBuckyJob(job.id);
      assert.ok(await claim("api-a"));
    });
    await t.test("expired attempts lose source/write authority; takeover preserves checkpoints", async () => {
      await reset(); await enqueue();
      const first = (await claim())!;
      await jobs.heartbeatBuckyWorker("local-a", { jobId: first.job.id, leaseToken: first.leaseToken, checkpoint: { sections: ["done"] } });
      await db.buckyJobAttempt.update({ where: { id: first.attemptId }, data: { leaseExpiresAt: new Date(0) } });
      await assert.rejects(jobs.getLeasedBuckyJob("local-a", first.job.id, first.leaseToken));
      const second = (await claim("local-b"))!;
      assert.deepEqual(second.job.checkpoint, { sections: ["done"] });
      let applied = 0;
      await assert.rejects(jobs.completeBuckyJob("local-a", first.job.id, first.leaseToken, {}, undefined, async () => { applied++; return apply(); }));
      assert.equal(applied, 0);
      await jobs.completeBuckyJob("local-b", second.job.id, second.leaseToken, { answer: "done" }, undefined, apply);
      assert.equal((await db.buckyJobAttempt.findUniqueOrThrow({ where: { id: first.attemptId } })).status, "expired");
    });
    await t.test("duplicate completion applies once; failed application rolls back its mutations", async () => {
      await reset(); await enqueue(); const item = (await claim())!;
      await assert.rejects(jobs.completeBuckyJob("local-a", item.job.id, item.leaseToken, {}, undefined, async (tx) => {
        await tx.buckyWorker.update({ where: { id: "local-a" }, data: { label: "should roll back" } });
        throw new Error("application failed");
      }));
      assert.equal((await db.buckyWorker.findUniqueOrThrow({ where: { id: "local-a" } })).label, "local-a");
      let count = 0;
      const action = async () => { count++; return apply(); };
      await jobs.completeBuckyJob("local-a", item.job.id, item.leaseToken, { answer: 1 }, undefined, action);
      const duplicate = await jobs.completeBuckyJob("local-a", item.job.id, item.leaseToken, { answer: 2 }, undefined, action);
      assert.equal(count, 1); assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.job.result, { answer: 1 });
    });
    await t.test("different API workers cannot over-reserve the monthly budget", async () => {
      await reset(); process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS = "25";
      await enqueue(100); await enqueue(100);
      const claims = await Promise.all([claim("api-a"), claim("api-b")]);
      assert.equal(claims.filter(Boolean).length, 1);
      const winner = claims.findIndex(Boolean); const item = claims[winner]!;
      await jobs.completeBuckyJob(winner === 0 ? "api-a" : "api-b", item.job.id, item.leaseToken, {}, { costCents: 5 }, apply);
      const budget = await db.buckyApiBudget.findFirstOrThrow();
      assert.equal(budget.reservedCents, 0); assert.equal(budget.spentCents, 5);
    });
    await t.test("unmetered failure burns its reservation and cancellation fences a lease", async () => {
      await reset(); await enqueue(100); const paid = (await claim("api-a"))!;
      await jobs.failBuckyJob("api-a", paid.job.id, paid.leaseToken, "network error");
      const budget = await db.buckyApiBudget.findFirstOrThrow();
      assert.equal(budget.spentCents, 25); assert.equal(budget.reservedCents, 0);
      await enqueue(); const local = (await claim())!;
      await jobs.cancelBuckyJob(local.job.id);
      await assert.rejects(jobs.heartbeatBuckyWorker("local-a", { jobId: local.job.id, leaseToken: local.leaseToken }));
    });
    await t.test("successful section yields do not consume failure allowance and settle only once", async () => {
      await reset(); await enqueue(100);
      for (let part = 0; part < 7; part++) {
        const item = (await claim("api-a"))!;
        assert.ok(item);
        await jobs.yieldBuckyJob("api-a", item.job.id, item.leaseToken, { part }, { costCents: 1 });
        const again = await jobs.yieldBuckyJob("api-a", item.job.id, item.leaseToken, { part: "wrong" }, { costCents: 1 });
        assert.equal(again.duplicate, true); assert.deepEqual(again.job.checkpoint, { part });
      }
      const final = (await claim("api-a"))!;
      assert.ok(final); assert.equal(final.job.generation, 8);
      await jobs.completeBuckyJob("api-a", final.job.id, final.leaseToken, {}, { costCents: 1 }, apply);
      assert.equal((await db.buckyApiBudget.findFirstOrThrow()).spentCents, 8);
    });
    await t.test("five failures stop automatic retries even with completed sections", async () => {
      await reset(); const job = await enqueue();
      const initial = (await claim())!;
      await jobs.yieldBuckyJob("local-a", job.id, initial.leaseToken, { part: 0 });
      for (let failure = 1; failure <= 5; failure++) {
        const item = (await claim())!; assert.ok(item);
        const failed = await jobs.failBuckyJob("local-a", job.id, item.leaseToken, "test error");
        assert.equal(failed.status, failure === 5 ? "failed" : "queued");
        await db.buckyJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
      }
      assert.equal(await claim(), null);
    });
    await t.test("yielded sections rotate behind other ready jobs of equal priority", async () => {
      await reset(); const first = await enqueue(); const second = await enqueue();
      const item = (await claim())!; assert.equal(item.job.id, first.id);
      await jobs.yieldBuckyJob("local-a", first.id, item.leaseToken, { part: 0 });
      assert.equal((await claim())?.job.id, second.id);
    });
    await t.test("API deferral skips even urgent jobs while leaving them available locally", async () => {
      await reset(); const deferred = await enqueue(100); const next = await enqueue(100);
      const first = (await claim("api-a"))!; assert.equal(first.job.id, deferred.id);
      await jobs.yieldBuckyJob("api-a", deferred.id, first.leaseToken, {}, { costCents: 0 }, {
        apiNotBefore: new Date(Date.now() + 86_400_000), lastError: "Waiting for local processing",
      });
      assert.equal((await claim("api-a"))?.job.id, next.id);
      const local = (await claim())!; assert.equal(local.job.id, deferred.id);
      assert.equal(local.reservedCents, 0);
    });
    await t.test("a metered preflight failure releases its allocation without recording spend", async () => {
      await reset(); await enqueue(100); const item = (await claim("api-a"))!;
      await jobs.failBuckyJob("api-a", item.job.id, item.leaseToken, "Source validation failed before model call", false, { costCents: 0 });
      const budget = await db.buckyApiBudget.findFirstOrThrow();
      assert.equal(budget.spentCents, 0); assert.equal(budget.reservedCents, 0);
      assert.equal((await db.buckyJobAttempt.findUniqueOrThrow({ where: { id: item.attemptId } })).costCents, 0);
    });
    await t.test("retried development and archive jobs discard stale artifacts but preserve history", async () => {
      await reset();
      for (const kind of ["site_improvement", "archive_review"] as const) {
        const original = await jobs.enqueueBuckyJob({ kind, request: { instructions: "Inspect the current state" } });
        const checkpoint = kind === "site_improvement" ? { developmentResult: { baseCommit: "a".repeat(40), patch: "old patch" } } : { parts: { "old-source": { summary: "old findings" } } };
        await db.buckyJob.update({ where: { id: original.id }, data: { status: "needs_review", checkpoint, result: { publishStatus: "blocked", summary: "old result" } } });
        const retry = await jobs.retryBuckyJob(original.id);
        assert.notEqual(retry.id, original.id); assert.equal(retry.status, "queued");
        assert.equal(retry.checkpoint, null); assert.equal(retry.result, null); assert.equal(retry.generation, 0);
        const retained = await db.buckyJob.findUniqueOrThrow({ where: { id: original.id } });
        assert.deepEqual(retained.checkpoint, checkpoint); assert.deepEqual(retained.result, { publishStatus: "blocked", summary: "old result" });
      }
      const doc = await jobs.enqueueBuckyJob({ kind: "document_analysis", request: {}, sourceVersion: "unchanged-version" });
      await db.buckyJob.update({ where: { id: doc.id }, data: { status: "failed", checkpoint: { parts: { first: "retained" } } } });
      const retry = await jobs.retryBuckyJob(doc.id);
      assert.deepEqual(retry.checkpoint, { parts: { first: "retained" } });
      assert.equal(retry.sourceVersion, "unchanged-version");
    });
  } finally {
    await db.$disconnect();
    await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await root.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});
