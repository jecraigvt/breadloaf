import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BuckyJobError } from "@/lib/bucky-jobs";

export function hashBuckyWorkerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateBuckyWorker(request: NextRequest, workerId?: string) {
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match) throw new BuckyJobError("Unauthorized worker", 401);
  const worker = await prisma.buckyWorker.findUnique({ where: { tokenHash: hashBuckyWorkerToken(match[1]) } });
  if (!worker || (workerId && worker.id !== workerId)) throw new BuckyJobError("Unauthorized worker", 401);
  return worker;
}

export const workerIdSchema = z.string().min(1).max(128);
export const leaseFields = { workerId: workerIdSchema, jobId: workerIdSchema, leaseToken: z.string().uuid() };
export const quotaSchema = z.number().finite().min(0).max(100).nullable();
export const jsonResultSchema = z.unknown().refine((value) => value !== undefined && value !== null, "A result is required");

export async function readWorkerBody(request: NextRequest) {
  const limit = 12 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new BuckyJobError("Worker request is too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BuckyJobError("JSON body required", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new BuckyJobError("Worker request is too large", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new BuckyJobError("Invalid JSON body", 400); }
}

export function workerRouteError(error: unknown) {
  if (error instanceof BuckyJobError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid worker request", issues: error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
  // Never include raw database failures, file paths, or credentials in worker responses.
  console.error("[Bucky worker] Request failed", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "Worker request failed" }, { status: 500 });
}
