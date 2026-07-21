// Rebuild Bucky's derived knowledge index. Safe to run repeatedly.
//
// Production: railway run npx tsx scripts/re-embed.ts
// Local:      npx tsx scripts/re-embed.ts

import { prisma } from "../src/lib/prisma";
import {
  EMBEDDING_MODEL,
  indexAsset,
  indexDocument,
  indexExpense,
  indexMaintenance,
  indexMemory,
} from "../src/lib/embeddings";

interface IndexItem {
  sourceType: string;
  sourceId: string;
  label: string;
  run: () => Promise<void>;
}

async function main() {
  console.log(`Rebuilding Bucky knowledge index with ${EMBEDDING_MODEL}`);

  const [documents, memories, assets, maintenance, expenses, existing] = await Promise.all([
    prisma.document.findMany({ select: { id: true, title: true } }),
    prisma.jarvisMemory.findMany({ select: { id: true, topic: true } }),
    prisma.asset.findMany({ select: { id: true, name: true } }),
    prisma.maintenanceRecord.findMany({ select: { id: true, title: true } }),
    prisma.expense.findMany({ select: { id: true, description: true } }),
    prisma.embedding.findMany({ select: { sourceType: true, sourceId: true } }),
  ]);

  const items: IndexItem[] = [
    ...documents.map((item) => ({ sourceType: "document", sourceId: item.id, label: item.title, run: () => indexDocument(item.id, { throwOnError: true }) })),
    ...memories.map((item) => ({ sourceType: "memory", sourceId: item.id, label: item.topic, run: () => indexMemory(item.id, { throwOnError: true }) })),
    ...assets.map((item) => ({ sourceType: "asset", sourceId: item.id, label: item.name, run: () => indexAsset(item.id, { throwOnError: true }) })),
    ...maintenance.map((item) => ({ sourceType: "maintenance", sourceId: item.id, label: item.title, run: () => indexMaintenance(item.id, { throwOnError: true }) })),
    ...expenses.map((item) => ({ sourceType: "expense", sourceId: item.id, label: item.description, run: () => indexExpense(item.id, { throwOnError: true }) })),
  ];
  console.log(`${items.length} source records, ${existing.length} existing chunks`);

  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await item.run();
      ok++;
      console.log(`  ${item.sourceType} ok: ${item.label}`);
    } catch (error) {
      failed++;
      console.error(`  ${item.sourceType} FAILED: ${item.label}:`, String(error).slice(0, 180));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const live = new Map<string, Set<string>>([
    ["document", new Set(documents.map((item) => item.id))],
    ["memory", new Set(memories.map((item) => item.id))],
    ["asset", new Set(assets.map((item) => item.id))],
    ["maintenance", new Set(maintenance.map((item) => item.id))],
    ["expense", new Set(expenses.map((item) => item.id))],
  ]);
  const orphanSources = new Map<string, { sourceType: string; sourceId: string }>();
  for (const entry of existing) {
    const knownIds = live.get(entry.sourceType);
    if (knownIds && !knownIds.has(entry.sourceId)) {
      orphanSources.set(`${entry.sourceType}:${entry.sourceId}`, entry);
    }
  }
  for (const orphan of Array.from(orphanSources.values())) {
    await prisma.embedding.deleteMany({ where: orphan });
    console.log(`  removed orphan: ${orphan.sourceType}:${orphan.sourceId}`);
  }

  console.log(`Done: ${ok} indexed, ${failed} failed, ${orphanSources.size} orphan sources removed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
