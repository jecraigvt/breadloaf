import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentActor, getDoorFamily } from "@/lib/actor";
import { BuckyJobError, enqueueBuckyJob } from "@/lib/bucky-jobs";
import { configuredCents } from "@/lib/bucky-job-policy";
import { queueBackgroundUpload, queueExistingDocument, validateBackgroundFile } from "@/lib/bucky-background-documents";
import { readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";
import { jobDocumentIds } from "@/lib/bucky-job-handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const sources = z.array(z.string().min(1).max(128)).min(1).max(50).transform((ids) => Array.from(new Set(ids)));
const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document_analysis"), sourceDocumentIds: sources }),
  z.object({ kind: z.literal("archive_review"), instructions: z.string().trim().min(1).max(8000), sourceDocumentIds: sources.optional() }),
  z.object({ kind: z.literal("site_improvement"), instructions: z.string().trim().min(1).max(8000) }),
]);

export async function GET(request: NextRequest) {
  try {
    if (!await getDoorFamily(request)) throw new BuckyJobError("Please sign in", 401);
    const actor = await getCurrentActor(request);
    const [jobs, workers, storedBudget] = await Promise.all([
      prisma.buckyJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.buckyWorker.findMany({ select: { id: true, label: true, provider: true, paused: true, lastSeenAt: true, quotaRemaining: true }, orderBy: { label: "asc" } }),
      prisma.buckyApiBudget.findUnique({ where: { month: new Date().toISOString().slice(0, 7) } }),
    ]);
    // Do not send worker checkpoints, lease tokens or full source extractions to
    // the family list. The archive owns full document data and access controls.
    const sourceIds = Array.from(new Set(jobs.flatMap(jobDocumentIds)));
    const accessible = new Set((await prisma.document.findMany({ where: { id: { in: sourceIds }, deletedAt: null, accessScope: "family" }, select: { id: true } })).map((doc) => doc.id));
    const visibleJobs = jobs.filter((job) => jobDocumentIds(job).every((id) => accessible.has(id))).map(({ checkpoint: _checkpoint, result, ...job }) => {
      const artifact = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
      if (!artifact) return { ...job, result: null };
      const { patch: _patch, extractedText: _text, ...visibleResult } = artifact;
      return { ...job, result: visibleResult };
    });
    return NextResponse.json({ jobs: visibleJobs, workers,
      budget: { spentCents: storedBudget?.spentCents ?? 0, reservedCents: storedBudget?.reservedCents ?? 0,
        limitCents: configuredCents(process.env.BUCKY_BACKGROUND_API_BUDGET_CENTS, 300) },
      canManage: !!(actor?.isCurator || actor?.isBoardMember),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return workerRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!await getDoorFamily(request)) throw new BuckyJobError("Please sign in", 401);
    const actor = await getCurrentActor(request);
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 110 * 1024 * 1024) throw new BuckyJobError("Upload at most 100 MB per batch", 413);
      const form = await request.formData();
      if (form.get("kind") !== "document_analysis") throw new BuckyJobError("Unsupported background upload", 400);
      const files = form.getAll("files").filter((entry): entry is File => typeof entry !== "string");
      if (!files.length || files.length > 20 || files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) throw new BuckyJobError("Choose 1–20 files, totalling at most 100 MB", 400);
      files.forEach(validateBackgroundFile);
      const jobs = [];
      for (const file of files) jobs.push(await queueBackgroundUpload(file, actor));
      return NextResponse.json({ jobs }, { status: 202 });
    }
    const input = createSchema.parse(await readWorkerBody(request));
    if (input.kind === "document_analysis") {
      const jobs = [];
      for (const id of input.sourceDocumentIds) jobs.push(await queueExistingDocument(id, actor));
      return NextResponse.json({ jobs }, { status: 202 });
    }
    if (input.kind === "site_improvement" && !actor?.isCurator && !actor?.isBoardMember) throw new BuckyJobError("Choose your curator or board identity to request website changes", 403);
    let ids: string[] = [];
    if (input.kind === "archive_review") {
      ids = input.sourceDocumentIds ?? (await prisma.document.findMany({ where: { deletedAt: null, accessScope: "family" }, orderBy: { updatedAt: "desc" }, select: { id: true }, take: 50 })).map((d) => d.id);
      if (!ids.length || await prisma.document.count({ where: { id: { in: ids }, deletedAt: null, accessScope: "family" } }) !== ids.length) throw new BuckyJobError("Choose available family archive documents", 400);
    }
    const job = await enqueueBuckyJob({ kind: input.kind, request: {
      title: input.kind === "archive_review" ? "Archive review" : "Website improvement",
      instructions: input.instructions, ...(ids.length ? { sourceDocumentIds: ids } : {}),
    }, initiatedById: actor?.memberId, initiatedByName: actor?.displayName });
    return NextResponse.json({ jobs: [job] }, { status: 202 });
  } catch (error) { return workerRouteError(error); }
}
