import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { claimBuckyJob } from "@/lib/bucky-jobs";
import { authenticateBuckyWorker, quotaSchema, readWorkerBody, workerIdSchema, workerRouteError } from "@/lib/bucky-worker-auth";

export const runtime = "nodejs";
const schema = z.object({ workerId: workerIdSchema, capabilities: z.array(z.string().max(80)).max(10), quotaRemaining: quotaSchema.default(null) });
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    const body = schema.parse(await readWorkerBody(request));
    if (worker.id !== body.workerId) return NextResponse.json({ error: "Unauthorized worker" }, { status: 401 });
    return NextResponse.json(await claimBuckyJob(worker.id, body.capabilities, body.quotaRemaining));
  } catch (error) { return workerRouteError(error); }
}
