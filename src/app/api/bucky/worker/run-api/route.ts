import { NextRequest, NextResponse } from "next/server";
import { authenticateBuckyWorker, workerRouteError } from "@/lib/bucky-worker-auth";
import { BuckyJobError } from "@/lib/bucky-jobs";
import { runHostedBuckyPart } from "@/lib/bucky-api-runner";
import { flushBuckyJobEffects } from "@/lib/bucky-job-handlers";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const worker = await authenticateBuckyWorker(request);
    if (worker.provider !== "api") throw new BuckyJobError("API worker required", 403);
    if (worker.paused) return NextResponse.json({ state: "paused" });
    const result = await runHostedBuckyPart(worker.id);
    await flushBuckyJobEffects();
    return NextResponse.json(result);
  } catch (error) { return workerRouteError(error); }
}
