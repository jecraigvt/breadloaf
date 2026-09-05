import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor, getDoorFamily } from "@/lib/actor";
import { BuckyJobError, getBuckyJob, cancelBuckyJob, promoteBuckyJob, retryBuckyJob } from "@/lib/bucky-jobs";
import { queueExistingDocument } from "@/lib/bucky-background-documents";
import { readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";
import { jobDocumentIds } from "@/lib/bucky-job-handlers";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!await getDoorFamily(request)) throw new BuckyJobError("Please sign in", 401);
    const actor = await getCurrentActor(request);
    const { action } = z.object({ action: z.enum(["expedite", "cancel", "retry"]) }).parse(await readWorkerBody(request));
    const job = await getBuckyJob(params.id);
    if (!job) throw new BuckyJobError("Job not found", 404);
    const sources = jobDocumentIds(job);
    if (sources.length && await prisma.document.count({ where: { id: { in: sources }, deletedAt: null, accessScope: "family" } }) !== sources.length) throw new BuckyJobError("A source is no longer available", 404);
    if (job.kind === "site_improvement" && !actor?.isCurator && !actor?.isBoardMember) throw new BuckyJobError("Curator or board identity required", 403);
    let updated;
    if (action === "retry" && job.kind === "document_analysis" && job.sourceDocumentId) {
      if (!["failed", "cancelled", "needs_review"].includes(job.status)) throw new BuckyJobError("Only failed, cancelled, or review jobs can be retried");
      // queueExistingDocument may find the original terminal dedupe row. Retry
      // that row for identical sources, otherwise make a fresh versioned job.
      const fresh = await queueExistingDocument(job.sourceDocumentId, actor);
      updated = ["failed", "cancelled", "needs_review"].includes(fresh.status) ? await retryBuckyJob(fresh.id) : fresh;
    } else updated = action === "expedite" ? await promoteBuckyJob(job.id) : action === "cancel" ? await cancelBuckyJob(job.id) : await retryBuckyJob(job.id);
    return NextResponse.json({ job: { id: updated.id, kind: updated.kind, status: updated.status } });
  } catch (error) { return workerRouteError(error); }
}
