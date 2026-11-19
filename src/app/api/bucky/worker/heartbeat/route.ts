import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { heartbeatBuckyWorker } from "@/lib/bucky-jobs";
import { checkpointArchivePage } from "@/lib/archive-scan-pages";
import { authenticateBuckyWorker, quotaSchema, readWorkerBody, workerIdSchema, workerRouteError } from "@/lib/bucky-worker-auth";

export const runtime = "nodejs";
const schema = z.object({ workerId: workerIdSchema, jobId: workerIdSchema.optional(), leaseToken: z.string().uuid().optional(),
  quotaRemaining: quotaSchema.optional(), checkpoint: z.unknown().optional(),
  scanPage: z.object({ number: z.number().int().min(1).max(10_000), result: z.unknown() }).optional(),
})
  .refine((body) => !!body.jobId === !!body.leaseToken, "jobId and leaseToken must be supplied together")
  .refine(body => !body.scanPage || !!body.jobId, "A scan page requires a job lease");
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const body = schema.parse(await readWorkerBody(request));
    if (worker.id !== body.workerId) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
    return NextResponse.json(await heartbeatBuckyWorker(worker.id,
      { ...body, checkpoint: body.checkpoint == null ? undefined : body.checkpoint as Prisma.InputJsonValue },
      body.scanPage ? (tx, job) => checkpointArchivePage(tx, job, body.scanPage!) : undefined));
  } catch (error) { return workerRouteError(error); }
}
