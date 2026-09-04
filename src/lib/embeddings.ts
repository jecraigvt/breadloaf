import { prisma } from "@/lib/prisma";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { Prisma } from "@prisma/client";

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
    "about", "after", "and", "are", "before", "can", "cannot", "could",
    "did", "does", "for", "from", "had", "handle", "handles", "has", "have", "how", "into",
    "just", "know", "not", "our", "please", "show", "that", "the", "their",
    "said", "say", "tell", "there", "these", "they", "this", "told", "was", "we", "were", "what", "when",
    "where", "which", "who", "why", "will", "with", "would", "you", "your",
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

function searchKey(result: Pick<SearchResult, "sourceType" | "sourceId" | "chunkIndex">) {
  return `${result.sourceType}:${result.sourceId}:${result.chunkIndex}`;
}

export function fuseSearchResults(
  semantic: SearchResult[],
  keyword: SearchResult[]
): SearchResult[] {
  const semanticTop = semantic[0]?.score || 1;
  const channels = new Map<string, { result: SearchResult; semantic: number; keyword: number }>();
  for (const result of semantic) {
    channels.set(searchKey(result), { result, semantic: result.score / semanticTop, keyword: 0 });
  }
  for (const result of keyword) {
    const key = searchKey(result);
    const existing = channels.get(key);
    channels.set(key, {
      result,
      semantic: existing?.semantic || 0,
      keyword: result.score,
    });
  }
  return Array.from(channels.values()).map(({ result, semantic: semanticScore, keyword: keywordScore }) => ({
    ...result,
    // Keep the stronger channel authoritative. Corroboration gets a small
    // bonus without letting a weak lexical match erase a clear semantic lead.
    score: Math.max(semanticScore, keywordScore) + Math.min(semanticScore, keywordScore) * 0.1,
  })).sort((left, right) => right.score - left.score);
}

const SEMANTIC_CANDIDATES = 40;
const KEYWORD_CANDIDATES = 60;
// Dimensionless, query-relative gates. RE-TUNE AFTER ANY CORPUS-WIDE CHANGE:
// these values are properties of the archive's content, not of the code, and
// re-analysis on 2026-08-05 invalidated the previous pair without touching a
// line of retrieval logic. Spread 1.20 had passed 4/4 controls before that
// re-analysis and dropped to 2/4 after it, because 46 documents gained content
// and nonsense queries began matching newly-populated photo summaries.
//
// Re-measured as a 35-pair grid against the repaired archive. The floor turned
// out to be inert — every value from 0.65 to 0.80 produced identical results —
// so the spread is the only real lever. 1.28 was the minimum that recovered all
// four controls; 1.30 is chosen for margin at identical measured cost:
//
//   spread 1.15-1.20    92% round-trip / 84% golden / 2 of 4 controls
//   spread 1.22         90% round-trip / 84% golden / 2 of 4 controls
//   spread 1.25         88% round-trip / 84% golden / 2 of 4 controls
//   spread 1.28-1.30    90% round-trip / 88% golden / 4 of 4 controls
// The tuner applies the same analysis-health requirement as the golden harness,
// so the two genuinely blank Word files can never earn a hollow title-only pass.
//
// Tune with scripts/tune-archive-retrieval-guards.ts, which fixes the generated
// questions across the grid. Do NOT compare bare harness runs to each other:
// round-trip questions are generated fresh by a model each run, so a few points
// of movement between runs is noise rather than a result.
//
// Keyword evidence must explain at least half of the query's IDF weight so one
// stray real word in a nonsense query cannot admit the other semantic noise.
export interface RetrievalGuards {
  relativeSemanticFloor: number;
  uncorroboratedTopSpread: number;
}

export const DEFAULT_RETRIEVAL_GUARDS: RetrievalGuards = {
  relativeSemanticFloor: 0.7,
  uncorroboratedTopSpread: 1.3,
};
const KEYWORD_QUERY_COVERAGE = 0.5;

export interface HybridSearchCandidates {
  semantic: SearchResult[];
  keyword: SearchResult[];
}

interface DatabaseSearchResult extends Omit<SearchResult, "score"> {
  score: number | string;
}

function normalizeDatabaseResults(results: DatabaseSearchResult[]): SearchResult[] {
  return results.map((result) => ({ ...result, score: Number(result.score) }));
}

// Similarity magnitudes are model-specific, so retain candidates relative to
// this query's own best result. If no query term occurs anywhere, require the
// best semantic match to stand distinctly above the runner-up; this keeps
// ungrounded controls such as "purple monkey dishwasher" from manufacturing
// context while preserving strong semantic-only matches.
export function filterSemanticCandidates(
  candidates: SearchResult[],
  hasKeywordEvidence: boolean,
  guards: RetrievalGuards = DEFAULT_RETRIEVAL_GUARDS
): SearchResult[] {
  if (candidates.length === 0) return [];
  const topScore = candidates[0].score;
  if (topScore <= 0) return [];
  const comparisonScore = candidates[Math.min(4, candidates.length - 1)]?.score ?? 0;
  if (
    !hasKeywordEvidence &&
    comparisonScore > 0 &&
    topScore / comparisonScore < guards.uncorroboratedTopSpread
  ) {
    return [];
  }
  return candidates.filter(
    (candidate) => candidate.score >= topScore * guards.relativeSemanticFloor
  );
}

export function filterKeywordCandidates(candidates: SearchResult[]): SearchResult[] {
  return (candidates[0]?.score || 0) >= KEYWORD_QUERY_COVERAGE ? candidates : [];
}

async function keywordSearch(
  terms: string[],
  sourceTypes?: string[]
): Promise<SearchResult[]> {
  if (terms.length === 0) return [];
  const sourceFilter = sourceTypes?.length
    ? Prisma.sql`AND e."sourceType" IN (${Prisma.join(sourceTypes)})`
    : Prisma.empty;
  const termValues = Prisma.join(terms.map((term) => Prisma.sql`(${term})`));
  const rows = await prisma.$queryRaw<DatabaseSearchResult[]>(Prisma.sql`
    WITH query_terms(term) AS (
      VALUES ${termValues}
    ),
    scoped AS (
      SELECT e.*
      FROM "Embedding" e
      WHERE TRUE ${sourceFilter}
    ),
    corpus AS (
      SELECT COUNT(*)::float8 AS total
      FROM scoped
    ),
    term_stats AS (
      SELECT
        query_terms.term,
        (LN((corpus.total + 1) / (COUNT(scoped.id)::float8 + 1)) + 1)::float8 AS weight
      FROM query_terms
      CROSS JOIN corpus
      LEFT JOIN scoped
        ON scoped."searchVector" @@ plainto_tsquery('simple', query_terms.term)
      GROUP BY query_terms.term, corpus.total
    ),
    total_weight AS (
      SELECT SUM(weight)::float8 AS weight
      FROM term_stats
    )
    SELECT
      scoped."sourceType",
      scoped."sourceId",
      scoped."chunkIndex",
      scoped.content,
      (SUM(term_stats.weight) / NULLIF(total_weight.weight, 0))::float8 AS score
    FROM scoped
    JOIN term_stats
      ON scoped."searchVector" @@ plainto_tsquery('simple', term_stats.term)
    CROSS JOIN total_weight
    GROUP BY
      scoped.id,
      scoped."sourceType",
      scoped."sourceId",
      scoped."chunkIndex",
      scoped.content,
      scoped."updatedAt",
      total_weight.weight
    ORDER BY score DESC, scoped."updatedAt" DESC
    LIMIT ${KEYWORD_CANDIDATES}
  `);
  return normalizeDatabaseResults(rows);
}

async function semanticSearchCandidates(
  queryVector: number[],
  sourceTypes?: string[]
): Promise<SearchResult[]> {
  const sourceFilter = sourceTypes?.length
    ? Prisma.sql`WHERE e."sourceType" IN (${Prisma.join(sourceTypes)})`
    : Prisma.empty;
  const vector = JSON.stringify(queryVector);
  const rows = await prisma.$queryRaw<DatabaseSearchResult[]>(Prisma.sql`
    SELECT
      e."sourceType",
      e."sourceId",
      e."chunkIndex",
      e.content,
      (1 - (e.embedding <=> ${vector}::vector))::float8 AS score
    FROM "Embedding" e
    ${sourceFilter}
    ORDER BY e.embedding <=> ${vector}::vector
    LIMIT ${SEMANTIC_CANDIDATES}
  `);
  return normalizeDatabaseResults(rows);
}

export async function getHybridSearchCandidates(
  query: string,
  sourceTypes?: string[]
): Promise<HybridSearchCandidates> {
  const terms = tokenizeSearchQuery(query);
  const [queryVector, keywordCandidates] = await Promise.all([
    process.env.OPENAI_API_KEY
      ? generateEmbedding(query).catch((error) => {
          console.error("[Embedding] Semantic query failed; using keyword retrieval:", error);
          return null;
        })
      : Promise.resolve(null),
    keywordSearch(terms, sourceTypes),
  ]);

  let semantic: SearchResult[] = [];
  if (queryVector) {
    try {
      semantic = await semanticSearchCandidates(queryVector, sourceTypes);
    } catch (error) {
      console.error("[Embedding] Semantic query failed; using keyword retrieval:", error);
    }
  }

  return { semantic, keyword: keywordCandidates };
}

export function rankHybridSearchCandidates(
  candidates: HybridSearchCandidates,
  limit: number,
  guards: RetrievalGuards = DEFAULT_RETRIEVAL_GUARDS
): SearchResult[] {
  const keyword = filterKeywordCandidates(candidates.keyword);
  const semantic = filterSemanticCandidates(
    candidates.semantic,
    keyword.length > 0,
    guards
  );
  return fuseSearchResults(semantic, keyword).slice(0, limit);
}

export async function hybridSearch(
  query: string,
  limit = 12,
  sourceTypes?: string[]
): Promise<SearchResult[]> {
  const candidates = await getHybridSearchCandidates(query, sourceTypes);

  return rankHybridSearchCandidates(candidates, limit);
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

export function memoryIndexContent(memory: {
  topic: string;
  type: string;
  subject: string | null;
  location: string | null;
  scope: string;
  content: string;
  source: string | null;
}): string {
  return [
    `Memory: ${memory.topic}`,
    `Type: ${memory.type}`,
    memory.subject ? `Subject: ${memory.subject}` : "",
    memory.location ? `Location: ${memory.location}` : "",
    `Scope: ${memory.scope}`,
    memory.content,
    memory.source ? `Source: ${memory.source}` : "",
  ].filter(Boolean).join("\n");
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
      memoryIndexContent(memory),
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
        record.sourceRecordings
          ? `Original dictated transcript: ${JSON.stringify(record.sourceRecordings)}`
          : "",
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
