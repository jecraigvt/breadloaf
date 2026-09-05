import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { completeBuckyJob } from "@/lib/bucky-jobs";
import { applyJobResult } from "@/lib/bucky-job-handlers";
import { authenticateBuckyWorker, jsonResultSchema, leaseFields, readWorkerBody, workerRouteError } from "@/lib/bucky-worker-auth";

export const runtime = "nodejs";
const schema = z.object({ ...leaseFields, result: jsonResultSchema, usage: z.object({
  costCents: z.number().int().nonnegative().max(1_000_000), inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(), model: z.string().max(128).optional(),
}).optional() });
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const body = schema.parse(await readWorkerBody(request));
    if (worker.id !== body.workerId) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
    return NextResponse.json(await completeBuckyJob(worker.id, body.jobId, body.leaseToken, body.result as Prisma.InputJsonValue, body.usage, applyJobResult));
  } catch (error) { return workerRouteError(error); }
}
