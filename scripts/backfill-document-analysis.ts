// Workstream E Phase 3: re-analyze every family archive document in place.
//
// Default (required first step): analyze and print field-level previews, but
// perform no database, index, or journal writes.
//   BACKFILL_UPLOAD_ROOT=/app/public/uploads npx tsx scripts/backfill-document-analysis.ts
//
// Apply only after the dry run has been reviewed:
//   BACKFILL_UPLOAD_ROOT=/app/public/uploads \
//   CONFIRM_ARCHIVE_REANALYSIS=workstream-e-phase3-reviewed \
//   npx tsx scripts/backfill-document-analysis.ts --apply

import "dotenv/config";
import { readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { resolveDocumentCategory } from "../src/lib/document-categories";
import {
  analyzeDocumentBuffer,
  normalizeStoredAnalysis,
} from "../src/lib/document-analysis";
import { indexDocument } from "../src/lib/embeddings";
import { sha256 } from "../src/lib/archive-integrity";
import {
  analyzeLinkedDocumentText,
  fetchLinkedDocumentText,
} from "../src/lib/link-document-analysis";
import {
  categoryReanalysisAction,
  reanalysisTextDelta,
  shouldSkipCompletedReanalysis,
  type ReanalysisJournalEntry,
} from "../src/lib/archive-reanalysis-plan";

const APPLY_CONFIRMATION = "workstream-e-phase3-reviewed";
const JOURNAL_VERSION = 1;
const apply = process.argv.includes("--apply");
const retryFailures = process.argv.includes("--retry-failures");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const offsetArg = process.argv.find((arg) => arg.startsWith("--offset="));
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const parsedLimit = limitArg ? Number.parseInt(limitArg.slice(8), 10) : undefined;
const parsedOffset = offsetArg ? Number.parseInt(offsetArg.slice(9), 10) : 0;
const limit = parsedLimit && parsedLimit > 0 ? parsedLimit : undefined;
const offset = parsedOffset && parsedOffset > 0 ? parsedOffset : 0;
const onlyId = onlyArg?.slice(7).trim() || undefined;
const uploadRoot = path.resolve(
  process.env.BACKFILL_UPLOAD_ROOT || path.join(process.cwd(), "public", "uploads")
);
const journalPath = path.resolve(
  process.env.BACKFILL_JOURNAL_PATH ||
    path.join(uploadRoot, ".workstream-e-phase3-reanalysis.json")
);

interface ReanalysisJournal {
  version: number;
  run: "workstream-e-phase3";
  items: Record<string, ReanalysisJournalEntry>;
}

interface Counters {
  examined: number;
  wouldUpdateOk: number;
  wouldRecordFailure: number;
  updatedOk: number;
  recordedFailure: number;
  skippedCompleted: number;
  fileMissing: number;
  integrityMismatch: number;
  stale: number;
  indexFailed: number;
}

function cleanPreview(value: string | null, maxChars: number): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
}

function safeDocumentPath(filePath: string): string | null {
  const relative = filePath.replace(/^[/\\]*uploads[/\\]/, "");
  const resolved = path.resolve(uploadRoot, relative);
  return resolved.startsWith(`${uploadRoot}${path.sep}`) ? resolved : null;
}

function assertSafeJournalPath(): void {
  if (!journalPath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("BACKFILL_JOURNAL_PATH must stay inside BACKFILL_UPLOAD_ROOT");
  }
}

async function loadJournal(): Promise<ReanalysisJournal> {
  try {
    const parsed = JSON.parse(await readFile(journalPath, "utf8")) as ReanalysisJournal;
    if (
      parsed.version !== JOURNAL_VERSION ||
      parsed.run !== "workstream-e-phase3" ||
      !parsed.items ||
      typeof parsed.items !== "object"
    ) {
      throw new Error("unsupported journal format");
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { version: JOURNAL_VERSION, run: "workstream-e-phase3", items: {} };
    }
    throw error;
  }
}

async function saveJournal(journal: ReanalysisJournal): Promise<void> {
  const temporaryPath = `${journalPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  await rename(temporaryPath, journalPath);
}

function selectedDocuments<T>(documents: T[]): T[] {
  return documents.slice(offset, limit ? offset + limit : documents.length);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  if (apply) {
    if (process.env.BACKFILL_UPLOAD_ROOT !== "/app/public/uploads") {
      throw new Error("Refusing --apply unless BACKFILL_UPLOAD_ROOT=/app/public/uploads");
    }
    if (process.env.CONFIRM_ARCHIVE_REANALYSIS !== APPLY_CONFIRMATION) {
      throw new Error(`Refusing --apply unless CONFIRM_ARCHIVE_REANALYSIS=${APPLY_CONFIRMATION}`);
    }
    assertSafeJournalPath();
  }

  const [allDocuments, categories] = await Promise.all([
    prisma.document.findMany({
      where: {
        deletedAt: null,
        accessScope: "family",
        ...(onlyId ? { id: onlyId } : {}),
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        filePath: true,
        fileType: true,
        fileSize: true,
        checksum: true,
        categoryId: true,
        category: { select: { name: true } },
        tags: true,
        aiSummary: true,
        aiExtractedText: true,
        analysisState: true,
        analysisError: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const documents = selectedDocuments(allDocuments);
  const protectedCategories = new Map(
    documents
      .filter((document) => document.categoryId)
      .map((document) => [document.id, document.categoryId as string])
  );
  const journal = apply
    ? await loadJournal()
    : { version: JOURNAL_VERSION, run: "workstream-e-phase3" as const, items: {} };
  const counters: Counters = {
    examined: 0,
    wouldUpdateOk: 0,
    wouldRecordFailure: 0,
    updatedOk: 0,
    recordedFailure: 0,
    skippedCompleted: 0,
    fileMissing: 0,
    integrityMismatch: 0,
    stale: 0,
    indexFailed: 0,
  };
  const predictedStates = new Map<string, number>();

  console.log(
    `${apply ? "APPLY" : "DRY RUN — NO DATABASE, INDEX, OR JOURNAL WRITES"}: ${documents.length} of ${allDocuments.length} family archive documents; ${protectedCategories.size} existing categories protected`
  );

  for (const document of documents) {
    let buffer: Buffer;
    let linkedText: string | null = null;
    if (document.fileType === "link") {
      try {
        const linked = await fetchLinkedDocumentText(document.filePath);
        linkedText = linked.text;
        buffer = Buffer.from(linked.text, "utf8");
      } catch (error) {
        counters.fileMissing++;
        console.log(JSON.stringify({ status: "link-unreadable", id: document.id, title: document.title, reason: String(error).slice(0, 180) }));
        continue;
      }
    } else {
      const fullPath = safeDocumentPath(document.filePath);
      if (!fullPath) {
        counters.fileMissing++;
        console.log(JSON.stringify({ status: "file-missing", id: document.id, title: document.title, reason: `unsafe path ${document.filePath}` }));
        continue;
      }
      try {
        buffer = await readFile(fullPath);
      } catch (error) {
        counters.fileMissing++;
        console.log(JSON.stringify({ status: "file-missing", id: document.id, title: document.title, reason: String(error).slice(0, 180) }));
        continue;
      }
    }
    const sourceChecksum = sha256(buffer);
    if (
      document.fileType !== "link" &&
      ((document.checksum && document.checksum !== sourceChecksum) ||
        (!document.checksum && document.fileSize !== buffer.length))
    ) {
      counters.integrityMismatch++;
      console.log(JSON.stringify({
        status: "integrity-mismatch",
        id: document.id,
        title: document.title,
        expectedChecksum: document.checksum,
        actualChecksum: sourceChecksum,
        expectedBytes: document.fileSize,
        actualBytes: buffer.length,
      }));
      continue;
    }
    if (
      apply &&
      shouldSkipCompletedReanalysis({
        entry: journal.items[document.id],
        sourceChecksum,
        retryFailures,
      })
    ) {
      counters.skippedCompleted++;
      console.log(JSON.stringify({ status: "skipped-completed", id: document.id, title: document.title, analysisState: journal.items[document.id].analysisState }));
      continue;
    }

    counters.examined++;
    const outcome = linkedText !== null
      ? await analyzeLinkedDocumentText({
          text: linkedText,
          fileName: document.fileName,
          categories,
        })
      : await analyzeDocumentBuffer({
          buffer,
          fileName: document.fileName,
          fileType: document.fileType,
          categories,
        });
    const result = outcome.result;
    const proposed = normalizeStoredAnalysis({
      analysisState: outcome.state,
      analysisError: outcome.error,
      aiSummary: result?.summary,
      aiExtractedText: result?.extractedText,
    });
    const proposedTags = result?.tags?.length ? JSON.stringify(result.tags) : null;
    predictedStates.set(
      proposed.analysisState,
      (predictedStates.get(proposed.analysisState) || 0) + 1
    );
    const categoryPlan = categoryReanalysisAction({
      currentCategoryId: document.categoryId,
      currentCategoryName: document.category?.name || null,
      suggestedCategory: result?.suggestedCategory || null,
    });
    const preview = {
      status: apply
        ? proposed.analysisState === "ok" ? "updated" : "recorded-failure"
        : proposed.analysisState === "ok" ? "would-update" : "would-record-failure",
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      sourceBytes: buffer.length,
      sourceChecksum,
      analysisState: { before: document.analysisState, after: proposed.analysisState },
      analysisError: proposed.analysisError,
      summary: reanalysisTextDelta(document.aiSummary, proposed.aiSummary),
      extractedText: reanalysisTextDelta(document.aiExtractedText, proposed.aiExtractedText),
      tags: reanalysisTextDelta(document.tags, proposedTags),
      summaryPreview: cleanPreview(proposed.aiSummary, 240),
      extractedTextPreview: cleanPreview(proposed.aiExtractedText, 180),
      titleAction: "preserve",
      aiSuggestedTitle: result?.title || null,
      category: categoryPlan,
      indexAction: "replace document chunks after database update",
    };

    if (!apply) {
      if (proposed.analysisState === "ok") counters.wouldUpdateOk++;
      else counters.wouldRecordFailure++;
      console.log(JSON.stringify(preview));
      continue;
    }

    const current = await prisma.document.findUnique({
      where: { id: document.id },
      select: {
        id: true,
        deletedAt: true,
        filePath: true,
        checksum: true,
        categoryId: true,
        tags: true,
        aiSummary: true,
        aiExtractedText: true,
        analysisState: true,
        analysisError: true,
      },
    });
    if (
      !current ||
      current.deletedAt ||
      current.filePath !== document.filePath ||
      current.checksum !== document.checksum
    ) {
      counters.stale++;
      console.log(JSON.stringify({ status: "stale-not-updated", id: document.id, title: document.title }));
      continue;
    }

    let nextCategoryId = current.categoryId;
    if (!nextCategoryId && result) {
      const resolution = await resolveDocumentCategory({
        suggestedCategory: result.suggestedCategory,
        newCategoryProposal: result.newCategoryProposal,
        confidence: result.confidence,
      });
      nextCategoryId = resolution.categoryId;
    }
    const before = { ...current };
    await prisma.document.update({
      where: { id: document.id },
      data: {
        aiSummary: proposed.aiSummary,
        aiExtractedText: proposed.aiExtractedText,
        analysisState: proposed.analysisState,
        analysisError: proposed.analysisError,
        tags: proposedTags,
        categoryId: current.categoryId || nextCategoryId,
      },
    });

    try {
      await indexDocument(document.id, { throwOnError: true });
    } catch (error) {
      counters.indexFailed++;
      await prisma.document.update({
        where: { id: document.id },
        data: {
          aiSummary: before.aiSummary,
          aiExtractedText: before.aiExtractedText,
          analysisState: before.analysisState,
          analysisError: before.analysisError,
          tags: before.tags,
          categoryId: before.categoryId,
        },
      });
      console.log(JSON.stringify({ status: "index-failed-rolled-back", id: document.id, title: document.title, reason: String(error).slice(0, 180) }));
      continue;
    }

    journal.items[document.id] = {
      sourceChecksum,
      analysisState: proposed.analysisState,
      completedAt: new Date().toISOString(),
    };
    await saveJournal(journal);
    if (proposed.analysisState === "ok") counters.updatedOk++;
    else counters.recordedFailure++;
    console.log(JSON.stringify(preview));
  }

  const categoriesAfter = protectedCategories.size
    ? await prisma.document.findMany({
        where: { id: { in: Array.from(protectedCategories.keys()) } },
        select: { id: true, categoryId: true },
      })
    : [];
  const changedProtectedCategories = apply
    ? categoriesAfter.filter(
        (document) => protectedCategories.get(document.id) !== document.categoryId
      ).map((document) => document.id)
    : [];
  const summary = {
    mode: apply ? "apply" : "dry-run",
    totalFamilyDocuments: allDocuments.length,
    selectedDocuments: documents.length,
    protectedExistingCategories: protectedCategories.size,
    changedProtectedCategories,
    predictedAnalysisState: Object.fromEntries(
      Array.from(predictedStates.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    ...counters,
  };
  console.log(`SUMMARY ${JSON.stringify(summary)}`);
  if (
    counters.fileMissing > 0 ||
    counters.integrityMismatch > 0 ||
    counters.stale > 0 ||
    counters.indexFailed > 0 ||
    changedProtectedCategories.length > 0
  ) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`Archive reanalysis failed before completion: ${String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
