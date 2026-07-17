// One-time backfill: regenerate every embedding with the current
// MODELS.embedding (run after switching embedding model IDs so stored
// vectors and query vectors live in the same space).
//
// Usage (against production):  railway run npx tsx scripts/re-embed.ts
// Usage (local dev):           npx tsx scripts/re-embed.ts
//
// Safe to re-run — embedAndStore upserts by (sourceType, sourceId).
// Orphaned embedding rows (source deleted) are removed.

import { prisma } from "../src/lib/prisma";
import { generateEmbedding, MODELS } from "../src/lib/ai";

// Same store shape as embedAndStore in ai.ts, but throws on failure so the
// script can count and report errors (embedAndStore swallows them).
async function reEmbed(sourceType: string, sourceId: string, content: string) {
  const vector = await generateEmbedding(content.slice(0, 5000));
  await prisma.embedding.upsert({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    update: { content: content.slice(0, 2000), vector: JSON.stringify(vector) },
    create: {
      sourceType,
      sourceId,
      content: content.slice(0, 2000),
      vector: JSON.stringify(vector),
    },
  });
}

async function main() {
  console.log(`Re-embedding with model: ${MODELS.embedding}`);

  const [documents, memories, existing] = await Promise.all([
    prisma.document.findMany({ include: { category: true } }),
    prisma.jarvisMemory.findMany(),
    prisma.embedding.findMany({ select: { sourceType: true, sourceId: true } }),
  ]);
  console.log(
    `${documents.length} documents, ${memories.length} memories, ${existing.length} existing embedding rows`
  );

  let ok = 0;
  let failed = 0;

  // Same content shape as the document creation sites (documents route,
  // file-document.ts, email-processor.ts)
  for (const doc of documents) {
    const content = [
      doc.title,
      doc.category?.name || "",
      doc.aiSummary || doc.description || "",
      doc.aiExtractedText || "",
    ]
      .filter(Boolean)
      .join(" | ");
    if (!content.trim()) continue;
    try {
      await reEmbed("document", doc.id, content);
      ok++;
      console.log(`  doc ok: ${doc.title}`);
    } catch (err) {
      failed++;
      console.error(`  doc FAILED: ${doc.title}:`, String(err).slice(0, 150));
    }
    // Gentle pacing for the embedding API
    await new Promise((r) => setTimeout(r, 300));
  }

  // Same content shape as save_memory in ai.ts
  for (const mem of memories) {
    try {
      await reEmbed("memory", mem.id, `${mem.topic}: ${mem.content}`);
      ok++;
      console.log(`  memory ok: ${mem.topic}`);
    } catch (err) {
      failed++;
      console.error(`  memory FAILED: ${mem.topic}:`, String(err).slice(0, 150));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // Remove orphans: embedding rows whose source row no longer exists
  const liveDocIds = new Set(documents.map((d) => d.id));
  const liveMemIds = new Set(memories.map((m) => m.id));
  const orphans = existing.filter(
    (e) =>
      (e.sourceType === "document" && !liveDocIds.has(e.sourceId)) ||
      (e.sourceType === "memory" && !liveMemIds.has(e.sourceId))
  );
  for (const o of orphans) {
    await prisma.embedding.deleteMany({
      where: { sourceType: o.sourceType, sourceId: o.sourceId },
    });
    console.log(`  removed orphan: ${o.sourceType}:${o.sourceId}`);
  }

  console.log(
    `Done — ${ok} re-embedded, ${failed} failed, ${orphans.length} orphans removed`
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
