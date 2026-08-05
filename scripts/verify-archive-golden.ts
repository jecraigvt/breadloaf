import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hybridSearch } from "../src/lib/embeddings";
import { verificationPassRate } from "../src/lib/archive-verification";
import {
  ARCHIVE_GOLDEN_QUESTIONS,
  type GoldenQuestion,
} from "../src/lib/archive-golden-questions";

const TOP_N = 3;
const CONCURRENCY = 4;
const verbose = process.argv.includes("--verbose");

interface GoldenResult {
  label: string;
  passed: boolean;
  reason: string;
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

async function verifyQuestion(
  fixture: GoldenQuestion,
  titles: Map<string, string>
): Promise<GoldenResult> {
  const missingExpected = fixture.expectedDocuments.filter(
    (expected) => !titles.has(expected.documentId)
  );
  if (missingExpected.length > 0) {
    return {
      label: fixture.question,
      passed: false,
      reason: `expected document missing from archive: ${missingExpected.map((item) => item.title).join(" | ")}`,
    };
  }

  try {
    const results = await hybridSearch(fixture.question, TOP_N, ["document"]);
    const returnedIds = new Set(results.map((result) => result.sourceId));
    const returnedTitles = results.map(
      (result) => titles.get(result.sourceId) || result.sourceId
    );

    if (fixture.expectedDocuments.length === 0) {
      return {
        label: fixture.question,
        passed: results.length === 0,
        reason: results.length === 0
          ? "returned nothing"
          : `negative control returned ${returnedTitles.join(" | ")}`,
      };
    }

    const missed = fixture.expectedDocuments.filter(
      (expected) => !returnedIds.has(expected.documentId)
    );
    return {
      label: fixture.question,
      passed: missed.length === 0,
      reason: missed.length === 0
        ? "expected document found"
        : `missing ${missed.map((item) => item.title).join(" | ")}; returned ${returnedTitles.length ? returnedTitles.join(" | ") : "nothing"}`,
    };
  } catch (error) {
    return {
      label: fixture.question,
      passed: false,
      reason: `retrieval error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

  const documents = await prisma.document.findMany({
    where: { deletedAt: null, accessScope: "family" },
    select: { id: true, title: true },
  });
  const titles = new Map(documents.map((document) => [document.id, document.title]));
  const results = await mapConcurrent(
    ARCHIVE_GOLDEN_QUESTIONS,
    CONCURRENCY,
    (fixture) => verifyQuestion(fixture, titles)
  );
  const failures = results.filter((result) => !result.passed);

  console.log(`${verificationPassRate(results).toFixed(1)}%`);
  for (const failure of failures) {
    console.log(`FAIL ${failure.label}: ${failure.reason}`);
  }
  if (verbose) {
    for (const result of results.filter((item) => item.passed)) {
      console.log(`PASS ${result.label}: ${result.reason}`);
    }
  }
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`Golden verification failed before completion: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
