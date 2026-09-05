import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BuckyJobError } from "@/lib/bucky-jobs";
import { authenticateBuckyWorker, readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";
import { BackgroundDevelopmentResultSchema } from "@/lib/bucky-background-contract";

export const dynamic = "force-dynamic";
async function publisher(request: NextRequest) {
  const worker = await authenticateBuckyWorker(request);
  if (worker.provider !== "api" || worker.paused || !Array.isArray(worker.capabilities) || !worker.capabilities.includes("site_improvement")) throw new BuckyJobError("Publishing worker required", 403);
}

export async function GET(request: NextRequest) {
  try {
    await publisher(request);
    const jobId = request.nextUrl.searchParams.get("jobId");
    const pendingIds = jobId ? [jobId] : (await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BuckyJob" WHERE "kind" = 'site_improvement'
        AND "status" IN ('succeeded', 'needs_review') AND "result" IS NOT NULL
        AND "result"->>'publishStatus' IS NULL ORDER BY "createdAt" ASC LIMIT 100
    `).map((job) => job.id);
    const jobs = await prisma.buckyJob.findMany({ where: { id: { in: pendingIds }, kind: "site_improvement", status: { in: ["succeeded", "needs_review"] } }, orderBy: { createdAt: "asc" } });
    for (const job of jobs) {
      const stored = job.result as Record<string, unknown> | null;
      if (!stored || (!jobId && stored.publishStatus)) continue;
      const parsed = BackgroundDevelopmentResultSchema.safeParse(stored);
      if (!parsed.success) continue;
      return NextResponse.json({ jobId: job.id, result: parsed.data }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(null);
  } catch (error) { return workerRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await publisher(request);
    const input = z.object({ jobId: z.string().max(128), baseCommit: z.string().regex(/^[a-f0-9]{40}$/), proposalUrl: z.string().url().optional(), publishStatus: z.enum(["published", "review", "blocked"]), reason: z.string().max(2000).optional() }).parse(await readWorkerBody(request));
    const repository = process.env.BUCKY_GITHUB_REPOSITORY;
    if (input.publishStatus !== "blocked") {
      const url = input.proposalUrl ? new URL(input.proposalUrl) : null;
      if (!url || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || url.origin !== "https://github.com" || !url.pathname.startsWith(`/${repository}/`) || !/^\/(?:[\w.-]+\/){2}(?:pull\/\d+|commit\/[a-f0-9]{40})\/?$/.test(url.pathname)) throw new BuckyJobError("Proposal URL does not belong to the configured repository", 400);
    }
    const job = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BuckyJob" WHERE "id" = ${input.jobId} FOR UPDATE`;
      const current = await tx.buckyJob.findUnique({ where: { id: input.jobId } });
      if (!current || current.kind !== "site_improvement" || !["succeeded", "needs_review"].includes(current.status)) throw new BuckyJobError("Completed development job required", 409);
      const stored = current.result as Record<string, string | number | boolean | object | null>;
      const result = BackgroundDevelopmentResultSchema.parse(stored);
      if (result.baseCommit !== input.baseCommit) throw new BuckyJobError("Artifact base changed", 409);
      if (stored.publishStatus) return current;
      return tx.buckyJob.update({ where: { id: current.id }, data: {
        status: input.publishStatus === "published" ? "succeeded" : "needs_review",
        result: { ...result, ...(input.proposalUrl ? { proposalUrl: input.proposalUrl } : {}), publishStatus: input.publishStatus, ...(input.reason ? { reviewReason: input.reason } : {}) },
      } });
    });
    return NextResponse.json({ jobId: job.id, status: job.status });
  } catch (error) { return workerRouteError(error); }
}
