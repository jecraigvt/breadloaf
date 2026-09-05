import type { BuckyJob, Prisma } from "@prisma/client";
import { z } from "zod";
import type { ActorContext } from "@/lib/actor";
import { prisma } from "@/lib/prisma";
import { enqueueBuckyJob } from "@/lib/bucky-jobs";
import { queueExistingDocument } from "@/lib/bucky-background-documents";

const documentIds = z.array(z.string().trim().min(1).max(128)).min(1).max(50).transform((ids) => Array.from(new Set(ids)));
const instructions = z.string().trim().min(1).max(8000);
const queueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document_analysis"), documentId: z.string().trim().min(1).max(128) }),
  z.object({ kind: z.literal("archive_review"), instructions, sourceDocumentIds: documentIds.optional() }),
  z.object({ kind: z.literal("site_improvement"), instructions }),
]);
const statusSchema = z.object({ jobId: z.string().trim().min(1).max(128).optional() });
type JobSummary = Pick<BuckyJob, "id" | "kind" | "status" | "request" | "sourceDocumentId" | "fallbackAfter">;
type EnqueueInput = {
  kind: "archive_review" | "site_improvement";
  request: Prisma.InputJsonValue;
  initiatedById?: string;
  initiatedByName?: string;
};
interface Dependencies {
  familyDocuments: (ids?: string[]) => Promise<{ id: string }[]>;
  queueDocument: (id: string, actor: ActorContext | null) => Promise<JobSummary>;
  enqueue: (input: EnqueueInput) => Promise<JobSummary>;
  findJobs: (id?: string) => Promise<JobSummary[]>;
}
const dependencies: Dependencies = {
  familyDocuments: (ids) => prisma.document.findMany({
    where: { deletedAt: null, accessScope: "family", ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { updatedAt: "desc" }, select: { id: true }, ...(ids ? {} : { take: 50 }),
  }),
  queueDocument: queueExistingDocument,
  enqueue: enqueueBuckyJob,
  findJobs: (id) => prisma.buckyJob.findMany({
    where: id ? { id } : {}, orderBy: { createdAt: "desc" }, take: id ? 1 : 10,
    select: { id: true, kind: true, status: true, request: true, sourceDocumentId: true, fallbackAfter: true },
  }),
};

function describeJob(job: JobSummary) {
  const request = job.request && typeof job.request === "object" && !Array.isArray(job.request) ? job.request : {};
  return { id: job.id, kind: job.kind, status: job.status,
    title: typeof request.title === "string" ? request.title : job.kind.replaceAll("_", " "),
    fallbackAfter: job.fallbackAfter.toISOString(), link: `/bucky/jobs#job-${encodeURIComponent(job.id)}` };
}

/** Called only from the authenticated chat path; actor is server context, never model arguments. */
export async function queueAssistantBackgroundWork(args: Record<string, unknown>, actor: ActorContext | null, services: Dependencies = dependencies): Promise<Record<string, unknown>> {
  const parsed = queueSchema.safeParse(args);
  if (!parsed.success) return { success: false, error: "Document analysis needs an exact documentId from the archive; archive or website review needs clear instructions. Up to 50 source documents may be specified." };
  const input = parsed.data;
  if (input.kind === "site_improvement" && !actor?.isCurator && !actor?.isBoardMember) {
    return { success: false, error: "Website improvement requests require the signed-in curator or board identity. A name mentioned in chat does not grant that role." };
  }
  let job: JobSummary;
  if (input.kind === "document_analysis") {
    job = await services.queueDocument(input.documentId, actor);
  } else {
    let ids: string[] = [];
    if (input.kind === "archive_review") {
      const available = await services.familyDocuments(input.sourceDocumentIds);
      ids = input.sourceDocumentIds ?? available.map((doc) => doc.id);
      const availableIds = new Set(available.map((doc) => doc.id));
      if (!ids.length || ids.some((id) => !availableIds.has(id))) {
        return { success: false, error: "Choose available family archive documents for this review." };
      }
    }
    job = await services.enqueue({ kind: input.kind,
      request: { title: input.kind === "archive_review" ? "Archive review" : "Website improvement", instructions: input.instructions, ...(ids.length ? { sourceDocumentIds: ids } : {}) },
      initiatedById: actor?.memberId, initiatedByName: actor?.displayName,
    });
  }
  return { success: true, job: describeJob(job),
    note: "The task is saved. Report its returned status and link; do not claim analysis, review findings, or a website change are complete. Existing documents stay saved. Process now is available on the task page for a queued task.",
    _audit: { entityType: "background_job", entityId: job.id, afterState: describeJob(job), reversible: false },
  };
}

export async function getAssistantBackgroundWorkStatus(args: Record<string, unknown>, services: Dependencies = dependencies): Promise<Record<string, unknown>> {
  const parsed = statusSchema.safeParse(args);
  if (!parsed.success) return { error: "Use the exact jobId returned when the task was saved." };
  const jobs = await services.findJobs(parsed.data.jobId);
  const attachedIds = (job: JobSummary) => {
    const request = job.request && typeof job.request === "object" && !Array.isArray(job.request) ? job.request : {};
    const ids = Array.isArray(request.sourceDocumentIds) ? request.sourceDocumentIds.filter((id): id is string => typeof id === "string") : [];
    return Array.from(new Set([...(job.sourceDocumentId ? [job.sourceDocumentId] : []), ...ids]));
  };
  const ids = Array.from(new Set(jobs.flatMap(attachedIds)));
  const allowed = new Set((ids.length ? await services.familyDocuments(ids) : []).map((doc) => doc.id));
  const visible = jobs.filter((job) => attachedIds(job).every((id) => allowed.has(id)));
  // Deliberately omit success:true: this is a read and must not create a write-action ledger entry.
  return { jobs: visible.map(describeJob), link: "/bucky/jobs", note: visible.length ? "These are saved task statuses. Open the task page for findings and any review or publication link." : "No matching task is available. A source may have been removed or its access changed." };
}
