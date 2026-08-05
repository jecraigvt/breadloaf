// Re-enrich archive rows stranded by the Gemini quota outage.
//
// Preview inside Railway:
//   BACKFILL_UPLOAD_ROOT=/app/public/uploads npx tsx scripts/backfill-document-analysis.ts
// Apply inside Railway:
//   BACKFILL_UPLOAD_ROOT=/app/public/uploads npx tsx scripts/backfill-document-analysis.ts --apply

import "dotenv/config";
import { readFile, stat } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/prisma";
import {
  categorizeDocument,
  categorizeText,
  processMediaFile,
  type CategoryOption,
} from "../src/lib/ai";
import { resolveDocumentCategory } from "../src/lib/document-categories";
import { extractTextFromFile, isExtractableType } from "../src/lib/extract-text";
import { AI_SIZE_LIMIT } from "../src/lib/document-analysis";
import { indexDocument } from "../src/lib/embeddings";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const parsedLimit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : undefined;
const limit = parsedLimit && parsedLimit > 0 ? parsedLimit : undefined;
const uploadRoot = path.resolve(
  process.env.BACKFILL_UPLOAD_ROOT || path.join(process.cwd(), "public", "uploads")
);

type AnalysisResult = Awaited<ReturnType<typeof categorizeDocument>>;

interface Counters {
  enriched: number;
  skippedOversize: number;
  fileMissing: number;
  failed: number;
}

function documentPath(filePath: string): string | null {
  const relative = filePath.replace(/^[/\\]*uploads[/\\]/, "");
  const resolved = path.resolve(uploadRoot, relative);
  return resolved.startsWith(`${uploadRoot}${path.sep}`) ? resolved : null;
}

async function analyze(
  buffer: Buffer,
  document: { fileType: string; fileName: string },
  categories: CategoryOption[]
): Promise<AnalysisResult> {
  const type = document.fileType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("audio/") || type.startsWith("video/")) {
    return processMediaFile(buffer.toString("base64"), type, categories, document.fileName);
  }
  if (type.startsWith("image/") || type === "application/pdf") {
    return categorizeDocument(buffer.toString("base64"), type, categories, document.fileName);
  }
  if (isExtractableType(type)) {
    const extracted = await extractTextFromFile(buffer, type);
    if (!extracted?.trim()) throw new Error("no extractable text");
    return categorizeText(extracted, document.fileName, categories);
  }
  throw new Error(`unsupported file type: ${type || "unknown"}`);
}

async function closeReadyArchiveQuestions(documentIds: string[]): Promise<number> {
  if (documentIds.length === 0) return 0;
  const questions = await prisma.buckyQuestion.findMany({
    where: {
      sourceType: "document",
      questionType: "archive",
      status: "open",
      sourceId: { in: documentIds },
    },
    select: { id: true, sourceId: true },
  });
  if (questions.length === 0) return 0;

  const documents = await prisma.document.findMany({
    where: {
      id: { in: questions.map((question) => question.sourceId as string) },
      categoryId: { not: null },
      NOT: [{ aiSummary: null }, { aiSummary: "" }],
    },
    select: { id: true, category: { select: { name: true } } },
  });
  const ready = new Map(documents.map((document) => [document.id, document.category?.name]));
  let closed = 0;
  for (const question of questions) {
    const categoryName = question.sourceId ? ready.get(question.sourceId) : null;
    if (!categoryName) continue;
    const result = await prisma.buckyQuestion.updateMany({
      where: { id: question.id, status: "open" },
      data: {
        status: "answered",
        answeredBy: "Bucky backfill",
        answeredAt: new Date(),
        answer: `Filed under ${categoryName}`,
      },
    });
    closed += result.count;
  }
  return closed;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  if (apply && process.env.BACKFILL_UPLOAD_ROOT !== "/app/public/uploads") {
    throw new Error("Refusing --apply unless BACKFILL_UPLOAD_ROOT=/app/public/uploads");
  }

  const [allCandidates, categories] = await Promise.all([
    prisma.document.findMany({
      where: {
        deletedAt: null,
        OR: [{ aiSummary: null }, { aiSummary: "" }],
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        filePath: true,
        fileType: true,
        fileSize: true,
        categoryId: true,
        tags: true,
        aiSummary: true,
        aiExtractedText: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const candidates = limit ? allCandidates.slice(0, limit) : allCandidates;
  const humanCategories = new Map(
    allCandidates
      .filter((document) => document.categoryId !== null)
      .map((document) => [document.id, document.categoryId])
  );
  const counters: Counters = { enriched: 0, skippedOversize: 0, fileMissing: 0, failed: 0 };

  console.log(
    `${apply ? "Applying" : "Previewing"} analysis backfill for ${candidates.length} of ${allCandidates.length} falsy-summary document(s); ${humanCategories.size} already have a category`
  );

  for (const document of candidates) {
    const fullPath = documentPath(document.filePath);
    if (!fullPath) {
      counters.fileMissing++;
      console.log(`file-missing ${document.id} ${document.fileName} (unsafe path: ${document.filePath})`);
      continue;
    }

    let actualSize: number;
    try {
      actualSize = (await stat(fullPath)).size;
    } catch {
      counters.fileMissing++;
      console.log(`file-missing ${document.id} ${document.fileName} (${document.filePath})`);
      continue;
    }
    if (actualSize > AI_SIZE_LIMIT) {
      counters.skippedOversize++;
      console.log(`skipped-oversize ${document.id} ${document.fileName} (${(actualSize / 1024 / 1024).toFixed(1)}MB)`);
      continue;
    }
    if (!apply) {
      console.log(`enriched ${document.id} ${document.fileName} (preview only; would analyze)`);
      continue;
    }

    try {
      const buffer = await readFile(fullPath);
      const result = await analyze(buffer, document, categories);
      const summary = result.summary.trim();
      if (!summary) throw new Error("AI returned an empty summary");
      const extractedText = result.extractedText.trim() || summary;
      const resolution = document.categoryId === null
        ? await resolveDocumentCategory({
            suggestedCategory: result.suggestedCategory,
            newCategoryProposal: result.newCategoryProposal,
            confidence: result.confidence,
          })
        : null;

      const before = await prisma.document.findUnique({ where: { id: document.id } });
      if (!before || before.deletedAt) throw new Error("document disappeared during backfill");
      if (before.aiSummary) {
        console.log(`enriched ${document.id} ${document.fileName} (already completed by another run)`);
        continue;
      }

      const updated = await prisma.document.update({
        where: { id: document.id },
        data: {
          aiSummary: summary,
          aiExtractedText: extractedText,
          analysisState: "ok",
          analysisError: null,
          tags: JSON.stringify(result.tags),
          ...(before.categoryId === null && resolution?.categoryId
            ? { categoryId: resolution.categoryId }
            : {}),
        },
      });

      try {
        await indexDocument(updated.id, { throwOnError: true });
      } catch (indexError) {
        await prisma.document.update({
          where: { id: document.id },
          data: {
            aiSummary: before.aiSummary,
            aiExtractedText: before.aiExtractedText,
            tags: before.tags,
            categoryId: before.categoryId,
          },
        });
        throw new Error(`index failed; enrichment rolled back: ${String(indexError)}`);
      }

      counters.enriched++;
      console.log(
        `enriched ${document.id} ${document.fileName}${before.categoryId ? " (preserved category)" : ""}`
      );
    } catch (error) {
      counters.failed++;
      console.log(`failed ${document.id} ${document.fileName}: ${String(error).slice(0, 240)}`);
    }
  }

  const closedQuestions = apply
    ? await closeReadyArchiveQuestions(allCandidates.map((document) => document.id))
    : 0;
  const categoriesAfter = humanCategories.size
    ? await prisma.document.findMany({
        where: { id: { in: Array.from(humanCategories.keys()) } },
        select: { id: true, categoryId: true },
      })
    : [];
  const changedHumanCategories = categoriesAfter.filter(
    (document) => humanCategories.get(document.id) !== document.categoryId
  );
  const remaining = await prisma.document.count({
    where: { deletedAt: null, OR: [{ aiSummary: null }, { aiSummary: "" }] },
  });

  console.log(JSON.stringify({ ...counters, closedQuestions, remaining, changedHumanCategories: changedHumanCategories.length }));
  if (counters.failed > 0 || changedHumanCategories.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`Backfill failed before completion: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
