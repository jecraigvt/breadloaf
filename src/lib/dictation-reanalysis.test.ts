import assert from "node:assert/strict";
import test from "node:test";
import type { BuckyJob, Prisma } from "@prisma/client";
import { applyJobResult } from "./bucky-job-handlers";

test("background reanalysis cannot replace a retained transcript with a rewrite or section markers", async () => {
  const transcript = "Roof.\nSoutheast roof over Great Room.\nEric's friend, Roofing. Um, August 20th.";
  const updatedAt = new Date("2026-09-04T12:00:00Z");
  for (const fileType of ["audio/mp4", "video/mp4"]) {
    const source = { id: "dictation", title: "Roof", categoryId: "existing", fileType, fileName: "roof.m4a", aiExtractedText: transcript, aiSummary: "Old summary", updatedAt, accessScope: "family", deletedAt: null };
    let written: Record<string, unknown> = {};
    const tx = {
      $queryRaw: async () => [],
      document: { findUnique: async () => source, update: async ({ data }: { data: Record<string, unknown> }) => { written = data; return { ...source, ...data }; } },
      buckyLedgerEntry: { create: async () => ({}) },
    } as unknown as Prisma.TransactionClient;
    const job = { kind: "document_analysis", id: "job", sourceDocumentId: source.id, sourceVersion: updatedAt.toISOString(), request: {}, initiatedByName: "Tester" } as BuckyJob;
    const outcome = await applyJobResult(tx, job, { kind: "document_analysis", title: "Rewritten title", summary: "A new summary.", extractedText: "Section 1\nRewritten words.", tags: [], suggestedCategory: "Maintenance", confidence: 1 });
    assert.equal(written.aiExtractedText, transcript);
    assert.equal((outcome.result as Record<string, unknown>).extractedText, transcript);
    assert.equal(written.title, undefined);
    assert.equal(source.aiExtractedText, transcript);
  }
});
