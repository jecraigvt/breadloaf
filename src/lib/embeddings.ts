import { prisma } from "@/lib/prisma";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";

export const EMBEDDING_MODEL = "text-embedding-3-small";

const MAX_CHUNK_CHARS = 3600;
const CHUNK_OVERLAP_CHARS = 350;
const CONTEXT_PREFIX_CHARS = 600;
export interface SearchResult {
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  score: number;
}

interface IndexOptions {
  throwOnError?: boolean;
}

function splitAtWordBoundary(content: string, target: number): number {
  if (content.length <= target) return content.length;
  const paragraph = content.lastIndexOf("\n", target);
  if (paragraph >= target * 0.65) return paragraph;
  const sentence = Math.max(
    content.lastIndexOf(". ", target),
    content.lastIndexOf("? ", target),
    content.lastIndexOf("! ", target)
  );
  if (sentence >= target * 0.65) return Math.min(sentence + 1, target);
  const space = content.lastIndexOf(" ", target);
  return space >= target * 0.65 ? space : target;
}

export function splitContentIntoChunks(content: string): string[] {
  const clean = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHUNK_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const remaining = clean.slice(start);
    const length = splitAtWordBoundary(remaining, MAX_CHUNK_CHARS);
    const chunk = remaining.slice(0, length).trim();
    if (chunk) chunks.push(chunk);
    if (start + length >= clean.length) break;
    start += Math.max(length - CHUNK_OVERLAP_CHARS, 1);
  }
  return chunks;
}

export function tokenizeSearchQuery(query: string): string[] {
  const stopWords = new Set([
    "about", "after", "before", "could", "does", "from", "have", "into",
    "just", "know", "please", "show", "that", "their", "there", "these",
    "the", "they", "this", "what", "when", "where", "which", "with", "would",
  ]);
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9$-]+/g, " ")
        .split(/\s+/)
        .filter((term) => term.length >= 3 && !stopWords.has(term))
    )
  ).slice(0, 12);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const result = await withRetry(() =>
    getOpenAIClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      encoding_format: "float",
    })
  );
  return result.data[0].embedding;
}

export async function embedAndStore(
  sourceType: string,
  sourceId: string,
  content: string,
  options: IndexOptions = {}
): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const chunks = splitContentIntoChunks(content);
    if (chunks.length === 0) {
      await prisma.embedding.deleteMany({ where: { sourceType, sourceId } });
      return;
    }

    const prefix = content.slice(0, CONTEXT_PREFIX_CHARS).trim();
    const indexed = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const contextualized = chunkIndex === 0
        ? chunks[chunkIndex]
        : `Source context: ${prefix}\n\nRelevant section: ${chunks[chunkIndex]}`;
      const vector = await generateEmbedding(contextualized);
      indexed.push({
        sourceType,
        sourceId,
        chunkIndex,
        content: contextualized,
        vector: JSON.stringify(vector),
      });
    }

    await prisma.$transaction([
      prisma.embedding.deleteMany({ where: { sourceType, sourceId } }),
      prisma.embedding.createMany({ data: indexed }),
    ]);
  } catch (error) {
    console.error(`[Embedding] Failed to index ${sourceType}:${sourceId}:`, error);
    if (options.throwOnError) throw error;
  }
}

export async function removeFromIndex(sourceType: string, sourceId: string): Promise<void> {
  await prisma.embedding.deleteMany({ where: { sourceType, sourceId } });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}

function searchKey(result: Pick<SearchResult, "sourceType" | "sourceId" | "chunkIndex">) {
  return `${result.sourceType}:${result.sourceId}:${result.chunkIndex}`;
}

// Minimum cosine similarity for a chunk to reach rank fusion. This constant is
// MODEL-SPECIFIC and must be re-measured whenever the embedding model changes —
// different models produce different similarity distributions, and the old
// value silently discarded good matches after the migration.
//
// Measured against the live index (65 rows) on 2026-08-05, gemini-embedding-2's
// 0.28 was above the top score for whole queries: "the heater will not ignite"
// peaked at 0.252 on Emergency Generator Operating Instructions — the right
// answer — and returned nothing at all. Every real query's best match survives
// at 0.25, while the nonsense control "purple monkey dishwasher" keeps only 3
// of 65, all at ranks the fusion outranks anyway.
//
// An absolute floor is the weak part of this design: per-query score spread is
// wide (one query kept 18 rows at 0.28 while another kept 0), so a threshold
// relative to each query's top score would be more robust. Left for task 12,
// which reworks this retrieval path anyway.
const SEMANTIC_FLOOR = 0.25;

export async function hybridSearch(
  query: string,
  limit = 12,
  sourceTypes?: string[]
): Promise<SearchResult[]> {
  const where = sourceTypes?.length ? { sourceType: { in: sourceTypes } } : {};
  const terms = tokenizeSearchQuery(query);

  const [allEmbeddings, keywordMatches] = await Promise.all([
    process.env.OPENAI_API_KEY
      ? prisma.embedding.findMany({ where })
      : Promise.resolve([]),
    terms.length
      ? prisma.embedding.findMany({
          where: {
            ...where,
            OR: terms.map((term) => ({ content: { contains: term, mode: "insensitive" as const } })),
          },
          take: 60,
        })
      : Promise.resolve([]),
  ]);

  let semantic: SearchResult[] = [];
  if (allEmbeddings.length > 0) {
    try {
      const queryVector = await generateEmbedding(query);
      semantic = allEmbeddings
        .map((entry) => ({
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          chunkIndex: entry.chunkIndex,
          content: entry.content,
          score: cosineSimilarity(queryVector, JSON.parse(entry.vector) as number[]),
        }))
        .filter((entry) => entry.score >= SEMANTIC_FLOOR)
        .sort((left, right) => right.score - left.score)
        .slice(0, 40);
    } catch (error) {
      console.error("[Embedding] Semantic query failed; using keyword retrieval:", error);
    }
  }

  const keyword = keywordMatches
    .map((entry) => {
      const lower = entry.content.toLowerCase();
      const matches = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
      return {
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        chunkIndex: entry.chunkIndex,
        content: entry.content,
        score: matches / Math.max(terms.length, 1),
      };
    })
    .sort((left, right) => right.score - left.score);

  const fused = new Map<string, SearchResult>();
  const addRanked = (results: SearchResult[], weight: number) => {
    results.forEach((result, rank) => {
      const key = searchKey(result);
      const contribution = weight / (60 + rank + 1);
      const existing = fused.get(key);
      fused.set(key, {
        ...result,
        score: (existing?.score || 0) + contribution,
      });
    });
  };
  addRanked(semantic, 1);
  addRanked(keyword, 1.15);

  return Array.from(fused.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function semanticSearch(
  query: string,
  limit = 10,
  sourceType?: string
): Promise<SearchResult[]> {
  return hybridSearch(query, limit, sourceType ? [sourceType] : undefined);
}

async function runIndexer(
  label: string,
  options: IndexOptions,
  operation: () => Promise<void>
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`[Embedding] Failed to refresh ${label}:`, error);
    if (options.throwOnError) throw error;
  }
}

export async function indexDocument(documentId: string, options: IndexOptions = {}) {
  return runIndexer(`document:${documentId}`, options, async () => {
    const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { category: true },
    });
    if (!document || document.deletedAt || document.accessScope !== "family") {
      await removeFromIndex("document", documentId);
      return;
    }
    await embedAndStore(
      "document",
      document.id,
      [
        `Document: ${document.title}`,
        `Category: ${document.category?.name || "Uncategorized"}`,
        document.description ? `Description: ${document.description}` : "",
        document.aiSummary ? `Summary: ${document.aiSummary}` : "",
        document.aiExtractedText ? `Contents:\n${document.aiExtractedText}` : "",
      ].filter(Boolean).join("\n"),
      options
    );
  });
}

export async function indexMemory(memoryId: string, options: IndexOptions = {}) {
  return runIndexer(`memory:${memoryId}`, options, async () => {
    const memory = await prisma.jarvisMemory.findUnique({ where: { id: memoryId } });
    const now = new Date();
    if (
      !memory ||
      memory.status !== "active" ||
      memory.accessScope !== "family" ||
      Boolean(memory.validFrom && memory.validFrom > now) ||
      Boolean(memory.validUntil && memory.validUntil < now)
    ) {
      await removeFromIndex("memory", memoryId);
      return;
    }
    await embedAndStore(
      "memory",
      memory.id,
      [
        `Memory: ${memory.topic}`,
        `Type: ${memory.type}`,
        memory.subject ? `Subject: ${memory.subject}` : "",
        `Scope: ${memory.scope}`,
        memory.content,
        memory.source ? `Source: ${memory.source}` : "",
      ].filter(Boolean).join("\n"),
      options
    );
  });
}

export async function indexAsset(assetId: string, options: IndexOptions = {}) {
  return runIndexer(`asset:${assetId}`, options, async () => {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      include: { records: { orderBy: { performedAt: "desc" }, take: 10 } },
    });
    if (!asset || asset.status !== "active") {
      await removeFromIndex("asset", assetId);
      return;
    }
    const recentWork = asset.records.map((record) =>
      `${record.performedAt.toISOString().slice(0, 10)}: ${record.title}${record.description ? ` - ${record.description}` : ""}`
    );
    await embedAndStore(
      "asset",
      asset.id,
      [
        `Property system: ${asset.name}`,
        `Category: ${asset.category}`,
        asset.location ? `Location: ${asset.location}` : "",
        [asset.make, asset.model, asset.serial].filter(Boolean).length
          ? `Equipment: ${[asset.make, asset.model, asset.serial].filter(Boolean).join(" ")}`
          : "",
        asset.installedYear ? `Installed: ${asset.installedYear}` : "",
        asset.notes ? `Notes: ${asset.notes}` : "",
        recentWork.length ? `Maintenance history:\n${recentWork.join("\n")}` : "",
      ].filter(Boolean).join("\n"),
      options
    );
  });
}

export async function indexMaintenance(recordId: string, options: IndexOptions = {}) {
  return runIndexer(`maintenance:${recordId}`, options, async () => {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: recordId },
      include: { asset: true },
    });
    if (!record) {
      await removeFromIndex("maintenance", recordId);
      return;
    }
    await embedAndStore(
      "maintenance",
      record.id,
      [
        `Maintenance: ${record.title}`,
        `Date: ${record.performedAt.toISOString().slice(0, 10)}`,
        `Category: ${record.category}`,
        record.asset ? `Property system: ${record.asset.name}` : "",
        record.description || "",
        record.performedBy ? `Performed by: ${record.performedBy}` : "",
        record.cost != null ? `Cost: $${record.cost.toFixed(2)}` : "",
      ].filter(Boolean).join("\n"),
      options
    );
  });
}

export async function indexExpense(expenseId: string, options: IndexOptions = {}) {
  return runIndexer(`expense:${expenseId}`, options, async () => {
    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense) {
      await removeFromIndex("expense", expenseId);
      return;
    }
    await embedAndStore(
      "expense",
      expense.id,
      [
        `Expense: ${expense.description}`,
        `Date: ${expense.date.toISOString().slice(0, 10)}`,
        `Amount: $${expense.amount.toFixed(2)}`,
        `Category: ${expense.category}`,
        `Type: ${expense.type}`,
        `Paid by: ${expense.paidBy}`,
        expense.vendor ? `Vendor: ${expense.vendor}` : "",
        expense.notes || "",
      ].filter(Boolean).join("\n"),
      options
    );
  });
}
