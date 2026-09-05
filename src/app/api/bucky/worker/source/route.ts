import { NextRequest } from "next/server";
import { z } from "zod";
import { BuckyJobError, getLeasedBuckyJob } from "@/lib/bucky-jobs";
import { authorizedJobSource } from "@/lib/bucky-job-policy";
import { prepareJobSource } from "@/lib/bucky-job-handlers";
import { authenticateBuckyWorker, workerIdSchema, workerRouteError } from "@/lib/bucky-worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ jobId: workerIdSchema, leaseToken: z.string().uuid(), sourceId: workerIdSchema.optional() });
export async function GET(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const query = schema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const job = await getLeasedBuckyJob(worker.id, query.jobId, query.leaseToken);
    let sourceId: string | undefined;
    try { sourceId = authorizedJobSource(job, query.sourceId); }
    catch { throw new BuckyJobError("Source is not attached to this job", 403); }
    const source = await prepareJobSource(job, sourceId);
    return new Response(source.body as BodyInit, { headers: { "Content-Type": source.contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return workerRouteError(error); }
}
