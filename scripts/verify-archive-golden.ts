import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hybridSearch } from "../src/lib/embeddings";
import { verificationPassRate } from "../src/lib/archive-verification";
import { recordVerificationRun } from "../src/lib/archive-verification-record";
import {
  ARCHIVE_GOLDEN_QUESTIONS,
  type GoldenQuestion,
} from "../src/lib/archive-golden-questions";
import {
  describeGoldenDocumentFailure,
  isGoldenDocumentReady,
  type GoldenDocumentHealth,
} from "../src/lib/archive-golden-verification";

const TOP_N = 3;
const CONCURRENCY = 4;
const verbose = process.argv.includes("--verbose");

interface GoldenResult {
  label: string;
  passed: boolean;
  reason: string;
}

interface GoldenDocument extends GoldenDocumentHealth {
  id: string;
  title: string;
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
  documents: Map<string, GoldenDocument>
): Promise<GoldenResult> {
  const missingExpected = fixture.expectedDocuments.filter(
    (expected) => !documents.has(expected.documentId)
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
      (result) => documents.get(result.sourceId)?.title || result.sourceId
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
    const hollowMatches = fixture.expectedDocuments.flatMap((expected) => {
      if (!returnedIds.has(expected.documentId)) return [];
      const document = documents.get(expected.documentId);
      return document && !isGoldenDocumentReady(document)
        ? [`${expected.title} (${describeGoldenDocumentFailure(document)})`]
        : [];
    });
    const failureParts = [
      missed.length
        ? `missing ${missed.map((item) => item.title).join(" | ")}; returned ${returnedTitles.length ? returnedTitles.join(" | ") : "nothing"}`
        : "",
      hollowMatches.length
        ? `matched document has no usable analysis: ${hollowMatches.join(" | ")}`
        : "",
    ].filter(Boolean);
    return {
      label: fixture.question,
      passed: failureParts.length === 0,
      reason: failureParts.length === 0
        ? "expected document found"
        : failureParts.join("; "),
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
    select: {
      id: true,
      title: true,
      analysisState: true,
      aiSummary: true,
      aiExtractedText: true,
    },
  });
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const results = await mapConcurrent(
    ARCHIVE_GOLDEN_QUESTIONS,
    CONCURRENCY,
    (fixture) => verifyQuestion(fixture, documentMap)
  );
  const failures = results.filter((result) => !result.passed);

  console.log(`${verificationPassRate(results).toFixed(1)}%`);
  // A control is a fixture with no expected documents; results come back in
  // fixture order, so the index is what pairs them.
  const controls = results.filter(
    (_result, index) => ARCHIVE_GOLDEN_QUESTIONS[index].expectedDocuments.length === 0
  );
  await recordVerificationRun({
    suite: "golden",
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    rate: verificationPassRate(results),
    controlsPassed: controls.filter((result) => result.passed).length,
    controlsTotal: controls.length,
    failures: failures.map((failure) => `${failure.label}: ${failure.reason}`),
  }).catch((error) => {
    console.error(`(could not record this run: ${String(error)})`);
  });
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
