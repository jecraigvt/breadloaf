import { randomUUID } from "node:crypto";
import { BuckyJob, BuckyJobAttempt, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BUCKY_JOB_KINDS, BuckyJobKind, FALLBACK_DELAY_MS, LEASE_DURATION_MS,
  MAX_JOB_ATTEMPTS, URGENT_JOB_PRIORITY, budgetCanReserve, configuredCents,
  leaseIsCurrent, quotaAllowsLocalWork, settlementCents,
} from "@/lib/bucky-job-policy";

type Tx = Prisma.TransactionClient;
export class BuckyJobError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type BuckyJobUsage = { costCents: number; inputTokens?: number; outputTokens?: number; model?: string };
export type ApplyBuckyJobResult = (tx: Tx, job: BuckyJob, result: Prisma.InputJsonValue) => Promise<{
  status: "succeeded" | "needs_review"; result?: Prisma.InputJsonValue;
}>;

export async function enqueueBuckyJob(input: {
  kind: BuckyJobKind; request: Prisma.InputJsonValue; sourceDocumentId?: string;
  sourceVersion?: string; initiatedById?: string; initiatedByName?: string;
  priority?: number; dedupeKey?: string;
}, tx: Tx = prisma) {
  if (!BUCKY_JOB_KINDS.includes(input.kind)) throw new BuckyJobError("Unsupported job kind", 400);
  const data = { ...input, fallbackAfter: new Date(Date.now() + FALLBACK_DELAY_MS) };
  return input.dedupeKey
    ? tx.buckyJob.upsert({ where: { dedupeKey: input.dedupeKey }, create: data, update: { dedupeKey: input.dedupeKey } })
    : tx.buckyJob.create({ data });
}

export function getBuckyJob(jobId: string) {
  return prisma.buckyJob.findUnique({ where: { id: jobId } });
}

async function lockJob(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "BuckyJob" WHERE "id" = ${id} FOR UPDATE`;
  const job = await tx.buckyJob.findUnique({ where: { id } });
  if (!job) throw new BuckyJobError("Job not found", 404);
  return job;
}

async function lockWorker(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "BuckyWorker" WHERE "id" = ${id} FOR UPDATE`;
  const worker = await tx.buckyWorker.findUnique({ where: { id } });
  if (!worker) throw new BuckyJobError("Worker not found", 401);
  return worker;
}

async function settleAttempt(tx: Tx, attempt: BuckyJobAttempt, usage?: BuckyJobUsage) {
  const costCents = settlementCents(attempt.reservedCents, usage?.costCents);
  if (attempt.budgetMonth && attempt.reservedCents > 0) {
    await tx.buckyApiBudget.update({
      where: { month: attempt.budgetMonth },
      data: { reservedCents: { decrement: attempt.reservedCents }, spentCents: { increment: costCents } },
    });
  }
  return { costCents, ...(usage ? { usage: usage as Prisma.InputJsonValue } : {}) };
}

async function currentAttempt(tx: Tx, workerId: string, jobId: string, token: string, now: Date) {
  const job = await lockJob(tx, jobId);
  const attempt = await tx.buckyJobAttempt.findUnique({ where: { leaseToken: token } });
  if (!attempt || attempt.workerId !== workerId || attempt.jobId !== job.id) {
    throw new BuckyJobError("Invalid attempt lease");
  }
  if (!leaseIsCurrent(job, attempt, now)) throw new BuckyJobError("Attempt lease expired or replaced");
  return { job, attempt };
}

export async function claimBuckyJob(workerId: string, capabilities: string[], quotaRemaining: number | null) {
  return prisma.$transaction(async (tx) => {
    const worker = await lockWorker(tx, workerId);
    const now = new Date();
    await tx.buckyWorker.update({ where: { id: workerId }, data: { lastSeenAt: now, quotaRemaining } });
    if (worker.paused || (worker.provider === "local" && !quotaAllowsLocalWork(quotaRemaining))) return null;
    const registered = Array.isArray(worker.capabilities) ? worker.capabilities : [];
    const supported = BUCKY_JOB_KINDS.filter((kind) => registered.includes(kind) && capabilities.includes(kind));
    if (!supported.length) return null;
    if (await tx.buckyJobAttempt.findFirst({ where: { workerId, status: "running", leaseExpiresAt: { gt: now } } })) return null;

    // The row locks, not a read-then-write check, arbitrate concurrent workers.
    const hostedFilter = worker.provider === "api"
      ? Prisma.sql`AND (j."fallbackAfter" <= ${now} OR j."priority" >= ${URGENT_JOB_PRIORITY})
          AND (j."apiNotBefore" IS NULL OR j."apiNotBefore" <= ${now})`
      : Prisma.empty;
    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT j."id" FROM "BuckyJob" j
      WHERE j."status" IN ('queued', 'running') AND j."nextAttemptAt" <= ${now}
        AND j."kind" IN (${Prisma.join(supported)}) ${hostedFilter}
        AND NOT EXISTS (SELECT 1 FROM "BuckyJobAttempt" a WHERE a."jobId" = j."id"
          AND a."status" = 'running' AND a."leaseExpiresAt" > ${now})
      ORDER BY j."priority" DESC, j."nextAttemptAt" ASC, j."createdAt" ASC FOR UPDATE OF j SKIP LOCKED LIMIT 1
    `);
    if (!candidates.length) return null;
    const job = await tx.buckyJob.findUniqueOrThrow({ where: { id: candidates[0].id } });
    const expired = await tx.buckyJobAttempt.findMany({ where: { jobId: job.id, status: "running" } });
    for (const attempt of expired) {
      const settled = await settleAttempt(tx, attempt);
      await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: {
        status: "expired", error: "Worker lease expired", completedAt: now, ...settled,
      } });
    }
    const failedAttempts = await tx.buckyJobAttempt.count({ where: { jobId: job.id, status: { in: ["failed", "expired"] } } });
    if (failedAttempts >= MAX_JOB_ATTEMPTS) {
      await tx.buckyJob.update({ where: { id: job.id }, data: { status: "failed", lastError: "Attempt limit reached; retry manually after checking the source or worker." } });
      return null;
    }
    let reservedCents = 0;
    let budgetMonth: string | undefined;
    if (worker.provider === "api") {
      budgetMonth = now.toISOString().slice(0, 7);
      await tx.$executeRaw`INSERT INTO "BuckyApiBudget" ("month", "spentCents", "reservedCents", "updatedAt")
        VALUES (${budgetMonth}, 0, 0, ${now}) ON CONFLICT ("month") DO NOTHING`;
      await tx.$queryRaw`SELECT "month" FROM "BuckyApiBudget" WHERE "month" = ${budgetMonth} FOR UPDATE`;
      const budget = await tx.buckyApiBudget.findUniqueOrThrow({ where: { month: budgetMonth } });
      reservedCents = configuredCents(process.env.BUCKY_API_MAX_ATTEMPT_CENTS, 25);
      const limit = configuredCents(process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS, 300);
      if (!budgetCanReserve(budget, reservedCents, limit)) {
        await tx.buckyJob.update({ where: { id: job.id }, data: { status: "queued", lastError: "Waiting for background API budget or a local worker." } });
        return null;
      }
      await tx.buckyApiBudget.update({ where: { month: budgetMonth }, data: { reservedCents: { increment: reservedCents } } });
    }
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const generation = job.generation + 1;
    const attempt = await tx.buckyJobAttempt.create({ data: {
      jobId: job.id, workerId, generation, leaseToken, leaseExpiresAt, reservedCents, budgetMonth,
    } });
    const claimed = await tx.buckyJob.update({ where: { id: job.id }, data: { status: "running", generation, lastError: null } });
    return { job: claimed, leaseToken, leaseExpiresAt, attemptId: attempt.id, reservedCents };
  }, { timeout: 15_000 });
}

export async function heartbeatBuckyWorker(workerId: string, input: {
  jobId?: string; leaseToken?: string; quotaRemaining?: number | null; checkpoint?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const worker = await lockWorker(tx, workerId);
    await tx.buckyWorker.update({ where: { id: workerId }, data: { lastSeenAt: new Date(), quotaRemaining: input.quotaRemaining } });
    if (!input.jobId || !input.leaseToken) return { paused: worker.paused };
    const { job, attempt } = await currentAttempt(tx, workerId, input.jobId, input.leaseToken, new Date());
    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);
    await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: { leaseExpiresAt } });
    if (input.checkpoint !== undefined) await tx.buckyJob.update({ where: { id: job.id }, data: { checkpoint: input.checkpoint } });
    return { leaseExpiresAt, paused: worker.paused };
  });
}

export async function completeBuckyJob(
  workerId: string, jobId: string, token: string, result: Prisma.InputJsonValue,
  usage: BuckyJobUsage | undefined, applyResult: ApplyBuckyJobResult,
) {
  return prisma.$transaction(async (tx) => {
    await lockWorker(tx, workerId);
    const job = await lockJob(tx, jobId);
    const attempt = await tx.buckyJobAttempt.findUnique({ where: { leaseToken: token } });
    if (!attempt || attempt.jobId !== jobId || attempt.workerId !== workerId) throw new BuckyJobError("Invalid attempt lease");
    // A retried HTTP response returns the first committed result; never apply twice.
    if (attempt.status === "succeeded" && job.generation === attempt.generation && ["succeeded", "needs_review"].includes(job.status)) {
      return { job, duplicate: true };
    }
    if (!leaseIsCurrent(job, attempt, new Date())) throw new BuckyJobError("Attempt lease expired or replaced");
    const applied = await applyResult(tx, job, result);
    const settled = await settleAttempt(tx, attempt, usage);
    await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: { status: "succeeded", completedAt: new Date(), ...settled } });
    const completed = await tx.buckyJob.update({ where: { id: job.id }, data: {
      status: applied.status, result: applied.result ?? result, lastError: null,
    } });
    return { job: completed, duplicate: false };
  }, { timeout: 30_000 });
}

export async function failBuckyJob(workerId: string, jobId: string, token: string, error: string, retryable = true, usage?: BuckyJobUsage) {
  return prisma.$transaction(async (tx) => {
    await lockWorker(tx, workerId);
    const { job, attempt } = await currentAttempt(tx, workerId, jobId, token, new Date());
    const settled = await settleAttempt(tx, attempt, usage);
    await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: {
      status: "failed", error: error.slice(0, 2000), completedAt: new Date(), ...settled,
    } });
    const failedAttempts = await tx.buckyJobAttempt.count({ where: { jobId, status: { in: ["failed", "expired"] } } });
    return tx.buckyJob.update({ where: { id: job.id }, data: {
      status: retryable && failedAttempts < MAX_JOB_ATTEMPTS ? "queued" : "failed",
      lastError: error.slice(0, 2000), nextAttemptAt: new Date(Date.now() + Math.min(60_000 * 2 ** (failedAttempts - 1), 15 * 60_000)),
    } });
  });
}

/** Paid runners may finish one section per scheduled invocation, releasing the
 * lease and accounting for that section without treating progress as failure. */
export async function yieldBuckyJob(workerId: string, jobId: string, token: string, checkpoint: Prisma.InputJsonValue, usage?: BuckyJobUsage,
  options?: { apiNotBefore?: Date; lastError?: string }) {
  return prisma.$transaction(async (tx) => {
    await lockWorker(tx, workerId);
    const job = await lockJob(tx, jobId);
    const attempt = await tx.buckyJobAttempt.findUnique({ where: { leaseToken: token } });
    if (!attempt || attempt.workerId !== workerId || attempt.jobId !== jobId) throw new BuckyJobError("Invalid attempt lease");
    if (attempt.status === "yielded") return { job, duplicate: true };
    if (!leaseIsCurrent(job, attempt, new Date())) throw new BuckyJobError("Attempt lease expired or replaced");
    const settled = await settleAttempt(tx, attempt, usage);
    await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: { status: "yielded", completedAt: new Date(), ...settled } });
    const updated = await tx.buckyJob.update({ where: { id: jobId }, data: {
      status: "queued", checkpoint, nextAttemptAt: new Date(), lastError: options?.lastError?.slice(0, 2000) ?? null,
      ...(options?.apiNotBefore ? { apiNotBefore: options.apiNotBefore } : {}),
    } });
    return { job: updated, duplicate: false };
  });
}

export async function getLeasedBuckyJob(workerId: string, jobId: string, token: string) {
  return prisma.$transaction(async (tx) => {
    await lockWorker(tx, workerId);
    return (await currentAttempt(tx, workerId, jobId, token, new Date())).job;
  });
}

export async function promoteBuckyJob(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!["queued", "running"].includes(job.status)) throw new BuckyJobError("Only pending jobs can be expedited");
    // A healthy local lease continues. The next available API claim can take over an expired one.
    return tx.buckyJob.update({ where: { id: jobId }, data: { priority: URGENT_JOB_PRIORITY, fallbackAfter: new Date(), nextAttemptAt: new Date() } });
  });
}

export async function cancelBuckyJob(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!["queued", "running", "failed"].includes(job.status)) throw new BuckyJobError("Job cannot be cancelled in its current state");
    const attempts = await tx.buckyJobAttempt.findMany({ where: { jobId, status: "running" } });
    for (const attempt of attempts) {
      const settled = await settleAttempt(tx, attempt);
      await tx.buckyJobAttempt.update({ where: { id: attempt.id }, data: { status: "cancelled", completedAt: new Date(), ...settled } });
    }
    return tx.buckyJob.update({ where: { id: job.id }, data: { status: "cancelled" } });
  });
}

export async function retryBuckyJob(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const job = await lockJob(tx, jobId);
    if (!["failed", "cancelled", "needs_review"].includes(job.status)) throw new BuckyJobError("Only failed, cancelled, or review jobs can be retried");
    // Preserve the attempt history and fencing sequence. A fresh job is a new operation.
    return tx.buckyJob.create({ data: {
      kind: job.kind, request: job.request as Prisma.InputJsonValue,
      sourceDocumentId: job.sourceDocumentId, sourceVersion: job.sourceVersion,
      // Document chunks can resume for the same version. Development and archive
      // reviews must inspect current inputs instead of replaying an old proposal.
      checkpoint: job.kind === "document_analysis" ? job.checkpoint ?? Prisma.JsonNull : Prisma.JsonNull,
      initiatedById: job.initiatedById,
      initiatedByName: job.initiatedByName, priority: job.priority,
      fallbackAfter: new Date(Date.now() + FALLBACK_DELAY_MS),
    } });
  });
}
