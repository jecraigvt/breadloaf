import { zodTextFormat } from "openai/helpers/zod";
import { prisma } from "@/lib/prisma";
import { MODELS } from "@/lib/ai-models";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { sha256 } from "@/lib/archive-integrity";
import { distillRetrievalQueries } from "@/lib/bucky-retrieval-query";
import {
  DICTATION_ANALYSIS_INSTRUCTIONS, DictationAnalysisSchema, recordingSources,
  validateDictationAnalysis, type DictationSource,
} from "@/lib/dictation-analysis";

async function loadSources(keys: string[]): Promise<DictationSource[]> {
  const ids = (type: string) => keys.filter((key) => key.startsWith(`${type}:`)).map((key) => key.slice(type.length + 1));
  const now = new Date();
  const [documents, maintenance, memories] = await Promise.all([
    prisma.document.findMany({ where: { id: { in: ids("document") }, deletedAt: null, accessScope: "family" } }),
    prisma.maintenanceRecord.findMany({ where: { id: { in: ids("maintenance") } } }),
    prisma.jarvisMemory.findMany({ where: { id: { in: ids("memory") }, status: "active", accessScope: "family",
      AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] } }),
  ]);
  return [
    ...documents.map((doc) => ({ key: `document:${doc.id}`, title: doc.title, url: `/documents/${doc.id}`,
      updatedAt: doc.updatedAt.toISOString(), text: doc.aiExtractedText || doc.description || doc.aiSummary || "" })),
    ...maintenance.map((record) => ({ key: `maintenance:${record.id}`, title: record.title, url: `/maintenance#${record.id}`,
      updatedAt: record.updatedAt.toISOString(), text: recordingSources(record.sourceRecordings).map((source) => source.transcript).join("\n\n") || record.description || "" })),
    ...memories.map((memory) => ({ key: `memory:${memory.id}`, title: memory.topic, url: "/assistant",
      updatedAt: memory.updatedAt.toISOString(), text: memory.content })),
  ];
}

// Select actual source passages, not embedded summaries or previously inferred links.
function sourceExcerpt(text: string, queries: string[]): string {
  if (text.length <= 9000) return text;
  const words = Array.from(new Set(queries.join(" ").toLowerCase().split(/\W+/).filter((word) => word.length > 3)));
  const sections = text.match(/[\s\S]{1,3000}/g) || [];
  return sections.map((section, index) => ({ section, index, score: words.filter((word) => section.toLowerCase().includes(word)).length }))
    .sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.index - b.index).map(({ section }) => section).join("\n[Other source passages omitted]\n");
}

export async function analyzeRetainedDictation(input: { filePath: string; transcript: string; title: string }, force = false) {
  if (!input.filePath.startsWith("/uploads/") || !input.transcript.trim()) return null;
  const transcriptHash = sha256(Buffer.from(input.transcript));
  const existing = await prisma.dictationAnalysis.findUnique({ where: { filePath: input.filePath } });
  if (!force && existing?.transcriptHash === transcriptHash) return existing;
  const queries = await distillRetrievalQueries(`${input.title}\n${input.transcript}`);
  const { hybridSearch } = await import("@/lib/embeddings");
  const matches = await Promise.all(queries.map((query) => hybridSearch(query, 8, ["document", "maintenance", "memory"])));
  const keys = Array.from(new Set(matches.flatMap((set) => set.map((match) => `${match.sourceType}:${match.sourceId}`)))).slice(0, 16);
  const sources = (await loadSources(keys))
    // The archived copy and native maintenance record can contain this same transcript.
    .filter((source) => source.text.trim() && !source.text.includes(input.transcript) && !input.transcript.includes(source.text))
    .map((source) => ({ ...source, text: sourceExcerpt(source.text, queries) }));
  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: [
      { role: "system", content: DICTATION_ANALYSIS_INSTRUCTIONS },
      { role: "user", content: JSON.stringify({ title: input.title, transcript: input.transcript, priorRecords: sources }) },
    ],
    text: { format: zodTextFormat(DictationAnalysisSchema, "dictation_analysis") },
  }));
  const analysis = validateDictationAnalysis(response.output_parsed, input.transcript, sources);
  // Only this derived table is writable here. Never write to a Document, memory,
  // maintenance description, sourceRecordings, or the retained file.
  const data = { transcriptHash, ...analysis, analyzedAt: new Date() };
  return prisma.dictationAnalysis.upsert({ where: { filePath: input.filePath }, create: { filePath: input.filePath, ...data }, update: data });
}

/** Intake awaits the analysis attempt after durable saving; failure cannot lose a dictation. */
export async function tryAnalyzeRetainedDictation(input: { filePath: string; transcript: string; title: string }) {
  try { return await analyzeRetainedDictation(input); }
  catch (error) {
    console.error("[Dictation] Internal analysis did not complete; original retained:", error instanceof Error ? error.name : "Unknown error");
    return null;
  }
}

/** Family-facing routes deliberately select only the single display sentence. */
export async function dictationDisplaySummaries(filePaths: string[]) {
  if (!filePaths.length) return new Map<string, string>();
  const rows = await prisma.dictationAnalysis.findMany({ where: { filePath: { in: filePaths } }, select: { filePath: true, displaySummary: true } });
  return new Map(rows.map((row) => [row.filePath, row.displaySummary]));
}

/** Index only this recording's facts; source-linked hypotheses are loaded fresh
 * at answer time so a removed/restricted source cannot survive in a stale vector. */
export async function dictationIndexText(filePaths: string[]) {
  if (!filePaths.length) return new Map<string, string>();
  const rows = await prisma.dictationAnalysis.findMany({ where: { filePath: { in: filePaths } }, select: { filePath: true, internalSummary: true } });
  return new Map(rows.map((row) => [row.filePath, `Bucky's derived summary of this recording (not the transcript):\n${row.internalSummary}`]));
}

/** Only use with paths of sources already authorized for Bucky's current context. */
export async function dictationContext(filePaths: string[]): Promise<Map<string, string>> {
  if (!filePaths.length) return new Map();
  const rows = await prisma.dictationAnalysis.findMany({ where: { filePath: { in: filePaths } } });
  const connections = rows.flatMap((row) => {
    const parsed = DictationAnalysisSchema.safeParse(row);
    return parsed.success ? parsed.data.connections : [];
  });
  const liveSources = await loadSources(Array.from(new Set(connections.map((connection) => connection.sourceKey))));
  return new Map(rows.map((row) => {
    const parsed = DictationAnalysisSchema.safeParse(row);
    if (!parsed.success) return [row.filePath, ""];
    const links = parsed.data.connections.filter((connection) => liveSources.some((source) =>
      source.key === connection.sourceKey && source.text.replace(/\s+/g, " ").includes(connection.sourceEvidence.replace(/\s+/g, " "))
    )).map((connection) => {
      const source = liveSources.find((candidate) => candidate.key === connection.sourceKey)!;
      return `UNCONFIRMED ${connection.confidence} connection to [${source.title}](${source.url}): ${connection.explanation}\nDictation evidence: ${connection.dictationEvidence}\nOther source evidence: ${connection.sourceEvidence}`;
    });
    return [row.filePath, `BUCKY INTERNAL NOTE (derived analysis, not the speaker's words; analyzed ${row.analyzedAt.toISOString()}):\n${row.internalSummary}\n${links.join("\n")}\nTreat connections as hypotheses and cite both originals. Never present them as established facts or as part of the transcript.`];
  }));
}
