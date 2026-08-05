import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hybridSearch } from "../src/lib/embeddings";
import { meaningfulAnalysisContent } from "../src/lib/document-analysis";
import { deriveArchiveQuestion } from "../src/lib/archive-roundtrip-question";
import {
  ROUND_TRIP_NEGATIVE_CONTROLS,
  verificationPassRate,
} from "../src/lib/archive-verification";

const TOP_N = 3;
const CONCURRENCY = 4;
const verbose = process.argv.includes("--verbose");

interface ArchiveDocument {
  id: string;
  title: string;
  fileType: string;
  fileSize: number;
  aiSummary: string | null;
  aiExtractedText: string | null;
  analysisState: string;
  analysisError: string | null;
}

interface VerificationResult {
  label: string;
  passed: boolean;
  reason: string;
  question?: string;
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

async function verifyDocument(
  document: ArchiveDocument,
  indexChunks: number,
  titles: Map<string, string>
): Promise<VerificationResult> {
  const content = meaningfulAnalysisContent(
    document.aiSummary,
    document.aiExtractedText
  );
  if (!content) {
    return {
      label: document.title,
      passed: false,
      reason: `no usable analysis content (${document.analysisState}: ${document.analysisError || "no error recorded"})`,
    };
  }
  if (indexChunks === 0) {
    return {
      label: document.title,
      passed: false,
      reason: "no document chunks exist in the retrieval index",
    };
  }

  try {
    const question = await deriveArchiveQuestion(document, content);
    const results = await hybridSearch(question, TOP_N, ["document"]);
    const rank = results.findIndex((result) => result.sourceId === document.id);
    const returned = results.map((result) => titles.get(result.sourceId) || result.sourceId);
    return rank >= 0
      ? {
          label: document.title,
          passed: true,
          reason: `rank ${rank + 1}`,
          question,
        }
      : {
          label: document.title,
          passed: false,
          reason: `not in top ${TOP_N}; returned ${returned.length ? returned.join(" | ") : "nothing"}`,
          question,
        };
  } catch (error) {
    return {
      label: document.title,
      passed: false,
      reason: `question or retrieval error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function verifyNegativeControl(
  query: string,
  titles: Map<string, string>
): Promise<VerificationResult> {
  try {
    const results = await hybridSearch(query, TOP_N, ["document"]);
    const returned = results.map((result) => titles.get(result.sourceId) || result.sourceId);
    return {
      label: `negative control \"${query}\"`,
      passed: results.length === 0,
      reason: results.length === 0
        ? "returned nothing"
        : `expected nothing; returned ${returned.join(" | ")}`,
      question: query,
    };
  } catch (error) {
    return {
      label: `negative control \"${query}\"`,
      passed: false,
      reason: `retrieval error: ${error instanceof Error ? error.message : String(error)}`,
      question: query,
    };
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

  const [documents, indexed] = await Promise.all([
    prisma.document.findMany({
      where: { deletedAt: null, accessScope: "family" },
      select: {
        id: true,
        title: true,
        fileType: true,
        fileSize: true,
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
  if (documents.length === 0) throw new Error("No family archive documents found");

  const chunkCounts = new Map(indexed.map((item) => [item.sourceId, item._count]));
  const titles = new Map(documents.map((document) => [document.id, document.title]));
  const documentResults = await mapConcurrent(
    documents,
    CONCURRENCY,
    (document) => verifyDocument(document, chunkCounts.get(document.id) || 0, titles)
  );
  const negativeResults = await mapConcurrent(
    [...ROUND_TRIP_NEGATIVE_CONTROLS],
    CONCURRENCY,
    (query) => verifyNegativeControl(query, titles)
  );
  const results = [...documentResults, ...negativeResults];
  const failures = results.filter((result) => !result.passed);

  console.log(`${verificationPassRate(results).toFixed(1)}%`);
  for (const failure of failures) {
    console.log(
      `FAIL ${failure.label}: ${failure.reason}${failure.question ? `; question: ${failure.question}` : ""}`
    );
  }
  if (verbose) {
    for (const result of results.filter((item) => item.passed)) {
      console.log(
        `PASS ${result.label}: ${result.reason}${result.question ? `; question: ${result.question}` : ""}`
      );
    }
  }
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`Round-trip verification failed before completion: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
