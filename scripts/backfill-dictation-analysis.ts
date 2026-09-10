import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { analyzeRetainedDictation } from "../src/lib/dictation-intelligence";
import { indexDocument, indexMemory, indexMaintenance } from "../src/lib/embeddings";
import { recordingSources } from "../src/lib/dictation-analysis";

// Dry run lists candidates without provider calls. --apply writes only derived
// DictationAnalysis rows and search indexes; --force refreshes prior analyses.
async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
  const docs = await prisma.document.findMany({ where: { deletedAt: null, accessScope: "family", fileType: { startsWith: "audio/" }, ...(only ? { id: only } : {}) }, orderBy: { createdAt: "asc" } });
  const memories = only ? [] : await prisma.jarvisMemory.findMany({ where: { accessScope: "family", status: "active", sourceType: "voice_note", filePath: { not: null } } });
  const maintenance = await prisma.maintenanceRecord.findMany();
  const candidates = [
    ...docs.map((doc) => ({ id: doc.id, type: "document", filePath: doc.filePath, title: doc.title, transcript: doc.aiExtractedText })),
    ...memories.map((memory) => ({ id: memory.id, type: "memory", filePath: memory.filePath!, title: memory.topic, transcript: memory.content })),
  ];
  let failed = 0;
  for (const candidate of candidates) {
    if (!candidate.transcript || !candidate.filePath.startsWith("/uploads/")) continue;
    if (!apply) { console.log(`Would analyze ${candidate.id}: ${candidate.title}`); continue; }
    try {
      const result = await analyzeRetainedDictation({ ...candidate, transcript: candidate.transcript }, force);
      if (!result) throw new Error("No analysis result");
      if (candidate.type === "document") await indexDocument(candidate.id, { throwOnError: true });
      else await indexMemory(candidate.id, { throwOnError: true });
      for (const record of maintenance.filter((record) => recordingSources(record.sourceRecordings).some((source) => source.filePath === candidate.filePath))) {
        await indexMaintenance(record.id, { throwOnError: true });
      }
      console.log(JSON.stringify({ id: candidate.id, title: candidate.title, displaySummary: result.displaySummary, connections: result.connections }));
    } catch (error) {
      failed++;
      console.error(`Analysis failed for ${candidate.id}: ${error instanceof Error ? error.name : "Unknown error"}`);
    }
  }
  if (failed) throw new Error(`${failed} dictation analyses did not complete`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
