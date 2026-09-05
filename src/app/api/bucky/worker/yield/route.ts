import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { yieldBuckyJob, BuckyJobError } from "@/lib/bucky-jobs";
import { authenticateBuckyWorker, leaseFields, readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";

const schema = z.object({ ...leaseFields, checkpoint: z.unknown(), usage: z.object({
  costCents: z.number().int().min(0).max(1000000), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), model: z.string().max(128).optional(),
}).optional() });
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const input = schema.parse(await readWorkerBody(request));
    if (worker.id !== input.workerId) throw new BuckyJobError("Unauthorized worker", 401);
    return NextResponse.json(await yieldBuckyJob(worker.id, input.jobId, input.leaseToken, (input.checkpoint ?? {}) as Prisma.InputJsonValue, input.usage));
  } catch (error) { return workerRouteError(error); }
}
