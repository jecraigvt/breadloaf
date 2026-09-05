import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { failBuckyJob } from "@/lib/bucky-jobs";
import { authenticateBuckyWorker, leaseFields, readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";

export const runtime = "nodejs";
const schema = z.object({ ...leaseFields, error: z.string().min(1).max(2000), retryable: z.boolean().default(true), usage: z.object({
  costCents: z.number().int().nonnegative().max(1_000_000), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), model: z.string().max(128).optional(),
}).optional() });
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const body = schema.parse(await readWorkerBody(request));
    if (worker.id !== body.workerId) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
    return NextResponse.json(await failBuckyJob(worker.id, body.jobId, body.leaseToken, body.error, body.retryable, body.usage));
  } catch (error) { return workerRouteError(error); }
}
