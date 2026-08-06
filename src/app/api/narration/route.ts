import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentActor } from "@/lib/actor";
import {
  BULK_NARRATION_MAX_BYTES,
  BulkNarrationCommitSchema,
  makeEditableNarratedMemoryItems,
  narrationSourceId,
} from "@/lib/bulk-narration";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";
import { segmentBulkNarration, transcribeMediaBuffer } from "@/lib/ai";
import { indexMemory } from "@/lib/embeddings";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Narration processing failed";
}

async function prepareRecording(request: NextRequest) {
  const formData = await request.formData();
  const recording = formData.get("recording");
  if (!(recording instanceof File) || recording.size === 0) {
    return NextResponse.json({ error: "A recording is required." }, { status: 400 });
  }
  if (!recording.type.startsWith("audio/")) {
    return NextResponse.json({ error: "The narration must be an audio recording." }, { status: 400 });
  }
  if (recording.size > BULK_NARRATION_MAX_BYTES) {
    return NextResponse.json(
      { error: "This recording is over 15 MB. Record a shorter session so it can be transcribed safely." },
      { status: 413 }
    );
  }

  const transcript = await transcribeMediaBuffer(
    Buffer.from(await recording.arrayBuffer()),
    recording.type,
    recording.name || "bulk-narration"
  );
  const items = makeEditableNarratedMemoryItems(await segmentBulkNarration(transcript));
  return NextResponse.json({ transcript, items });
}

async function commitMemories(request: NextRequest) {
  const input = BulkNarrationCommitSchema.parse(await request.json());
  const actor = await getCurrentActor(request);
  const source = actor
    ? `Bulk narration by ${actor.fullName}`
    : "Bulk narration by an unidentified family member";

  const committed = await prisma.$transaction(async (tx) => {
    const results: Array<{ id: string; topic: string; created: boolean }> = [];
    for (const item of input.items) {
      const sourceId = narrationSourceId(input.captureId, item.clientId);
      const existing = await tx.jarvisMemory.findFirst({
        where: { sourceType: "bulk_narration", sourceId },
        select: { id: true, topic: true },
      });
      if (existing) {
        results.push({ ...existing, created: false });
        continue;
      }

      const memory = await tx.jarvisMemory.create({
        data: {
          type: item.type,
          topic: item.topic,
          content: item.content,
          source,
          sourceType: "bulk_narration",
          sourceId,
          scope: item.scope,
          subject: item.subject || null,
          location: item.location || null,
          confidence: 0.9,
          importance: 0.7,
          accessScope: "family",
        },
        select: { id: true, topic: true },
      });
      results.push({ ...memory, created: true });
    }
    return results;
  });

  const indexing = await Promise.allSettled(
    committed.map((memory) => indexMemory(memory.id, { throwOnError: true }))
  );
  const failedTopics = indexing.flatMap((result, index) =>
    result.status === "rejected" ? [committed[index].topic] : []
  );
  const created = committed.filter((memory) => memory.created);

  if (created.length > 0) {
    await recordBuckyLedgerEntry({
      actionType: "bulk_narration_capture",
      summary: `Catalogued ${created.length} item${created.length === 1 ? "" : "s"} from one narration`,
      details: created.map((memory) => memory.topic).join("; "),
      initiatedBy: actor?.fullName,
      entityType: "memory_batch",
      entityId: input.captureId,
      sourceType: "bulk_narration",
      sourceId: input.captureId,
      afterState: { memoryIds: created.map((memory) => memory.id) },
    });
  }

  if (failedTopics.length > 0) {
    return NextResponse.json(
      {
        error: `${committed.length} memories were saved, but ${failedTopics.length} could not be indexed. It is safe to retry.`,
        savedCount: committed.length,
        failedTopics,
        retrySafe: true,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    savedCount: committed.length,
    createdCount: created.length,
    memories: committed.map(({ id, topic }) => ({ id, topic })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    return contentType.includes("multipart/form-data")
      ? await prepareRecording(request)
      : await commitMemories(request);
  } catch (error) {
    console.error("Bulk narration failed:", error);
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Review the item list and fill in every topic and description." }, { status: 400 });
    }
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
