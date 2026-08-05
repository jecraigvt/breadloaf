import "dotenv/config";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { prisma } from "../src/lib/prisma";
import { MODELS } from "../src/lib/ai";
import { hybridSearch } from "../src/lib/embeddings";
import { getOpenAIClient, withRetry } from "../src/lib/openai-client";
import { meaningfulAnalysisContent } from "../src/lib/document-analysis";
import {
  ROUND_TRIP_NEGATIVE_CONTROLS,
  distinctiveTitleWords,
  leakedTitleWords,
  verificationPassRate,
} from "../src/lib/archive-verification";

const TOP_N = 3;
const CONCURRENCY = 4;
const MAX_CONTENT_CHARS = 7000;
const QUESTION_ATTEMPTS = 3;
const verbose = process.argv.includes("--verbose");

const QuestionSchema = z.object({
  question: z.string().min(12).max(240),
});

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

async function deriveQuestion(document: ArchiveDocument, content: string): Promise<string> {
  const forbidden = distinctiveTitleWords(document.title);
  let lastProblem = "";

  for (let attempt = 1; attempt <= QUESTION_ATTEMPTS; attempt++) {
    const prompt = `Write one realistic question a family member could ask whose answer is supported by the archive content below.

Rules:
- Derive the question only from the supplied content, not from a filename or title.
- Ask about a specific subject, fact, decision, instruction, person, date, amount, or event in the content.
- Do not say document, file, title, archive, upload, summary, or filename.
- Do not use any forbidden title word: ${forbidden.join(", ") || "(none)"}.
- Use natural conversational language and end with a question mark.
${lastProblem ? `- The prior attempt was rejected because ${lastProblem}. Choose a different phrasing.` : ""}

Archive content:
${content.slice(0, MAX_CONTENT_CHARS)}`;
    const response = await withRetry(() =>
      getOpenAIClient().responses.parse({
        model: MODELS.flash,
        input: prompt,
        text: { format: zodTextFormat(QuestionSchema, "archive_round_trip_question") },
      })
    );
    const question = response.output_parsed?.question.trim();
    if (!question) {
      lastProblem = "it returned no question";
      continue;
    }
    const leaked = leakedTitleWords(question, forbidden);
    if (leaked.length > 0) {
      lastProblem = `it reused forbidden word(s): ${leaked.join(", ")}`;
      continue;
    }
    if (/\b(?:document|file|title|archive|upload|summary|filename)\b/i.test(question)) {
      lastProblem = "it referred to the archive or source artifact";
      continue;
    }
    return question.endsWith("?") ? question : `${question}?`;
  }

  throw new Error(lastProblem || "question generation failed");
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
    const question = await deriveQuestion(document, content);
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
