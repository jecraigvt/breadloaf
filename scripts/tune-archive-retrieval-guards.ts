import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  getHybridSearchCandidates,
  rankHybridSearchCandidates,
  type HybridSearchCandidates,
  type RetrievalGuards,
} from "../src/lib/embeddings";
import { meaningfulAnalysisContent } from "../src/lib/document-analysis";
import { deriveArchiveQuestion } from "../src/lib/archive-roundtrip-question";
import { ROUND_TRIP_NEGATIVE_CONTROLS } from "../src/lib/archive-verification";
import { ARCHIVE_GOLDEN_QUESTIONS } from "../src/lib/archive-golden-questions";

const TOP_N = 3;
const CONCURRENCY = 4;
const SEMANTIC_FLOORS = [0.65, 0.7, 0.72, 0.75, 0.8];
const TOP_SPREADS = [1.15, 1.18, 1.2, 1.22, 1.25, 1.28, 1.3];

interface VerificationCase {
  suite: "round-trip" | "golden";
  label: string;
  query: string | null;
  expectedDocumentIds: string[];
  negativeControl: boolean;
  preconditionFailure: string | null;
}

interface GridResult {
  guards: RetrievalGuards;
  roundTripRate: number;
  goldenRate: number;
  controlsPassed: number;
  controlsTotal: number;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

function passRate(passes: boolean[]): number {
  return passes.length === 0
    ? 0
    : (passes.filter(Boolean).length / passes.length) * 100;
}

function casePasses(
  testCase: VerificationCase,
  candidates: Map<string, HybridSearchCandidates>,
  guards: RetrievalGuards
): boolean {
  if (testCase.preconditionFailure || !testCase.query) return false;
  const raw = candidates.get(testCase.query);
  if (!raw) return false;
  const results = rankHybridSearchCandidates(raw, TOP_N, guards);
  if (testCase.negativeControl) return results.length === 0;
  const returned = new Set(results.map((result) => result.sourceId));
  return testCase.expectedDocumentIds.every((id) => returned.has(id));
}

async function buildRoundTripCases(): Promise<VerificationCase[]> {
  const [documents, indexed] = await Promise.all([
    prisma.document.findMany({
      where: { deletedAt: null, accessScope: "family" },
      select: {
        id: true,
        title: true,
        aiSummary: true,
        aiExtractedText: true,
        analysisState: true,
        analysisError: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.embedding.groupBy({
      by: ["sourceId"],
      where: { sourceType: "document" },
      _count: true,
    }),
  ]);
  const chunkCounts = new Map(indexed.map((item) => [item.sourceId, item._count]));
  const documentCases = await mapConcurrent(documents, CONCURRENCY, async (document) => {
    const content = meaningfulAnalysisContent(
      document.aiSummary,
      document.aiExtractedText
    );
    let query: string | null = null;
    let preconditionFailure: string | null = null;
    if (!content) {
      preconditionFailure = `no usable analysis content (${document.analysisState}: ${document.analysisError || "no error recorded"})`;
    } else if ((chunkCounts.get(document.id) || 0) === 0) {
      preconditionFailure = "no document chunks exist in the retrieval index";
    } else {
      try {
        query = await deriveArchiveQuestion(document, content);
      } catch (error) {
        preconditionFailure = `question generation failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return {
      suite: "round-trip" as const,
      label: document.title,
      query,
      expectedDocumentIds: [document.id],
      negativeControl: false,
      preconditionFailure,
    };
  });
  return [
    ...documentCases,
    ...ROUND_TRIP_NEGATIVE_CONTROLS.map((query) => ({
      suite: "round-trip" as const,
      label: `negative control \"${query}\"`,
      query,
      expectedDocumentIds: [],
      negativeControl: true,
      preconditionFailure: null,
    })),
  ];
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

  const [roundTripCases, documents] = await Promise.all([
    buildRoundTripCases(),
    prisma.document.findMany({
      where: { deletedAt: null, accessScope: "family" },
      select: { id: true },
    }),
  ]);
  const documentIds = new Set(documents.map((document) => document.id));
  const goldenCases: VerificationCase[] = ARCHIVE_GOLDEN_QUESTIONS.map((fixture) => {
    const missing = fixture.expectedDocuments.filter(
      (expected) => !documentIds.has(expected.documentId)
    );
    return {
      suite: "golden",
      label: fixture.question,
      query: fixture.question,
      expectedDocumentIds: fixture.expectedDocuments.map(
        (expected) => expected.documentId
      ),
      negativeControl: fixture.expectedDocuments.length === 0,
      preconditionFailure: missing.length
        ? `expected document missing: ${missing.map((item) => item.title).join(" | ")}`
        : null,
    };
  });
  const allCases = [...roundTripCases, ...goldenCases];
  const queries = Array.from(
    new Set(allCases.flatMap((testCase) => testCase.query || []))
  );
  const candidateEntries = await mapConcurrent(queries, CONCURRENCY, async (query) => [
    query,
    await getHybridSearchCandidates(query, ["document"]),
  ] as const);
  const candidates = new Map(candidateEntries);

  const rows: GridResult[] = [];
  for (const relativeSemanticFloor of SEMANTIC_FLOORS) {
    for (const uncorroboratedTopSpread of TOP_SPREADS) {
      const guards = { relativeSemanticFloor, uncorroboratedTopSpread };
      const scored = allCases.map((testCase) => ({
        testCase,
        passed: casePasses(testCase, candidates, guards),
      }));
      const roundTrip = scored.filter(
        ({ testCase }) => testCase.suite === "round-trip"
      );
      const golden = scored.filter(({ testCase }) => testCase.suite === "golden");
      const controls = scored.filter(
        ({ testCase }) => testCase.negativeControl
      );
      rows.push({
        guards,
        roundTripRate: passRate(roundTrip.map(({ passed }) => passed)),
        goldenRate: passRate(golden.map(({ passed }) => passed)),
        controlsPassed: controls.filter(({ passed }) => passed).length,
        controlsTotal: controls.length,
      });
    }
  }

  console.log(
    `Fixed corpus: ${roundTripCases.length} round-trip cases, ${goldenCases.length} golden cases, ${queries.length} unique retrieval queries.`
  );
  console.log("floor\tspread\tround-trip\tgolden\tcontrols");
  for (const row of rows) {
    console.log(
      `${row.guards.relativeSemanticFloor.toFixed(2)}\t${row.guards.uncorroboratedTopSpread.toFixed(2)}\t${row.roundTripRate.toFixed(1)}%\t${row.goldenRate.toFixed(1)}%\t${row.controlsPassed}/${row.controlsTotal}`
    );
  }
}

main()
  .catch((error) => {
    console.error(`Retrieval guard grid failed before completion: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
