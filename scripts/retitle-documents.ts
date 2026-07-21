// Improve filename-like archive titles without overwriting intentional names.
//
// Preview stored-content changes:
//   npm run archive:retitle
// Apply them:
//   npm run archive:retitle -- --apply
// Ask Bucky to reread unresolved files, sequentially:
//   npm run archive:retitle -- --reanalyze --limit=20
// Ask Bucky to reread every filename-like candidate for the best title:
//   npm run archive:retitle -- --reanalyze-all --write-plan=/tmp/archive-title-plan.json
// Apply the exact reviewed titles (and refuse stale rows):
//   npm run archive:retitle -- --apply-plan=/tmp/archive-title-plan.json
// Resume after a reviewed batch:
//   npm run archive:retitle -- --reanalyze --offset=20 --limit=20

import "dotenv/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { categorizeDocument, categorizeText, processMediaFile } from "../src/lib/ai";
import { needsDocumentRetitle, resolveDocumentTitle } from "../src/lib/document-title";
import { extractTextFromFile, isExtractableType } from "../src/lib/extract-text";
import { indexDocument } from "../src/lib/embeddings";

const AI_SIZE_LIMIT = 15 * 1024 * 1024;
const apply = process.argv.includes("--apply");
const reanalyzeAll = process.argv.includes("--reanalyze-all");
const reanalyze = process.argv.includes("--reanalyze") || reanalyzeAll;
const skipIndex = process.argv.includes("--skip-index");
const writePlanArg = process.argv.find((arg) => arg.startsWith("--write-plan="));
const applyPlanArg = process.argv.find((arg) => arg.startsWith("--apply-plan="));
const writePlanPath = writePlanArg?.slice("--write-plan=".length);
const applyPlanPath = applyPlanArg?.slice("--apply-plan=".length);
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const offsetArg = process.argv.find((arg) => arg.startsWith("--offset="));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;
const parsedOffset = offsetArg ? Number.parseInt(offsetArg.split("=")[1], 10) : 0;
const limit = parsedLimit && parsedLimit > 0 ? parsedLimit : undefined;
const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

interface ArchiveDocument {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  fileType: string;
  aiSummary: string | null;
  aiExtractedText: string | null;
  createdAt: Date;
}

interface TitlePlanItem {
  id: string;
  oldTitle: string;
  newTitle: string;
  fileName: string;
}

interface TitlePlan {
  version: 1;
  createdAt: string;
  items: TitlePlanItem[];
}

function isFallbackTitle(title: string): boolean {
  return /^(?:Archived (?:Document|PDF|Photo|Spreadsheet|Presentation)|Voice Memo|Video Recording) \(/.test(title);
}

async function rereadTitle(
  document: ArchiveDocument,
  categories: { name: string; description: string | null }[]
): Promise<string | null> {
  if (document.fileType === "link") return null;

  const publicRoot = path.resolve(process.cwd(), "public");
  const fullPath = path.resolve(publicRoot, document.filePath.replace(/^[/\\]+/, ""));
  if (!fullPath.startsWith(`${publicRoot}${path.sep}`)) return null;

  const buffer = await readFile(fullPath);
  if (buffer.length > AI_SIZE_LIMIT) return null;

  let result = null;
  if (document.fileType.startsWith("audio/") || document.fileType.startsWith("video/")) {
    result = await processMediaFile(
      buffer.toString("base64"),
      document.fileType,
      categories,
      document.fileName
    );
  } else if (document.fileType.startsWith("image/") || document.fileType === "application/pdf") {
    result = await categorizeDocument(
      buffer.toString("base64"),
      document.fileType,
      categories,
      document.fileName
    );
  } else if (isExtractableType(document.fileType)) {
    const extracted = await extractTextFromFile(buffer, document.fileType);
    if (extracted?.trim()) {
      result = await categorizeText(extracted, document.fileName, categories);
    }
  }

  return result?.title || null;
}

function assertTitlePlan(value: unknown): asserts value is TitlePlan {
  if (!value || typeof value !== "object") throw new Error("Invalid title plan");
  const plan = value as Partial<TitlePlan>;
  if (plan.version !== 1 || !Array.isArray(plan.items)) throw new Error("Unsupported title plan");

  for (const item of plan.items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.oldTitle !== "string" ||
      typeof item.newTitle !== "string" ||
      typeof item.fileName !== "string" ||
      !item.newTitle.trim() ||
      item.newTitle.length > 100 ||
      item.oldTitle === item.newTitle
    ) {
      throw new Error("Title plan contains an invalid item");
    }
  }
}

async function applySavedPlan(planPath: string) {
  const parsed: unknown = JSON.parse(await readFile(planPath, "utf8"));
  assertTitlePlan(parsed);
  console.log(`Applying ${parsed.items.length} reviewed title change(s) from ${planPath}`);

  let changed = 0;
  let conflicts = 0;
  let indexFailed = 0;
  for (const item of parsed.items) {
    const current = await prisma.document.findFirst({
      where: { id: item.id, deletedAt: null },
      select: { title: true, fileName: true },
    });
    if (!current || current.title !== item.oldTitle || current.fileName !== item.fileName) {
      conflicts++;
      console.warn(`  STALE, NOT CHANGED: ${item.fileName}`);
      continue;
    }

    await prisma.document.update({ where: { id: item.id }, data: { title: item.newTitle } });
    console.log(`  RENAME: ${item.oldTitle} -> ${item.newTitle}`);
    changed++;
    if (!skipIndex) {
      try {
        await indexDocument(item.id, { throwOnError: true });
      } catch (error) {
        indexFailed++;
        console.warn(`  INDEX PENDING: ${item.newTitle}: ${String(error).slice(0, 140)}`);
      }
    }
  }

  console.log(`Done: ${changed} renamed, ${conflicts} stale, ${indexFailed} need reindexing`);
  if (conflicts > 0) process.exitCode = 1;
}

async function main() {
  if (writePlanPath && apply) throw new Error("Use --write-plan only during preview");
  if (applyPlanPath) {
    if (apply || reanalyze || writePlanPath || limit || offset) {
      throw new Error("Use --apply-plan by itself (optionally with --skip-index)");
    }
    await applySavedPlan(applyPlanPath);
    return;
  }

  const documents = await prisma.document.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      fileName: true,
      filePath: true,
      fileType: true,
      aiSummary: true,
      aiExtractedText: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const candidates = documents
    .filter((document) => needsDocumentRetitle(document.title, document.fileName))
    .slice(offset, limit ? offset + limit : documents.length);
  const categories = reanalyze
    ? await prisma.category.findMany({
        select: { name: true, description: true },
        orderBy: { name: "asc" },
      })
    : [];

  console.log(
    `${apply ? "Applying" : "Previewing"} title changes for ${candidates.length} filename-like document(s)${offset ? ` after offset ${offset}` : ""}`
  );
  if (reanalyze) {
    console.log(
      `Bucky rereading is enabled for ${reanalyzeAll ? "all candidates" : "unresolved files"} and runs one file at a time`
    );
  }

  let changed = 0;
  let unresolved = 0;
  let failed = 0;
  let indexFailed = 0;
  const planItems: TitlePlanItem[] = [];
  for (const document of candidates) {
    try {
      let nextTitle = resolveDocumentTitle({
        fileName: document.fileName,
        summary: document.aiSummary,
        extractedText: document.aiExtractedText,
        fileType: document.fileType,
        createdAt: document.createdAt,
      });

      if (reanalyze && (reanalyzeAll || isFallbackTitle(nextTitle))) {
        nextTitle = (await rereadTitle(document, categories)) || nextTitle;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      if (isFallbackTitle(nextTitle) || nextTitle === document.title) {
        unresolved++;
        console.log(`  NEEDS REVIEW: ${document.title} (${document.fileName})`);
        continue;
      }

      console.log(`  ${apply ? "RENAME" : "WOULD RENAME"}: ${document.title} -> ${nextTitle}`);
      planItems.push({
        id: document.id,
        oldTitle: document.title,
        newTitle: nextTitle,
        fileName: document.fileName,
      });
      if (apply) {
        await prisma.document.update({ where: { id: document.id }, data: { title: nextTitle } });
        if (!skipIndex) {
          try {
            await indexDocument(document.id, { throwOnError: true });
          } catch (error) {
            indexFailed++;
            console.warn(`  INDEX PENDING: ${nextTitle}: ${String(error).slice(0, 140)}`);
          }
        }
      }
      changed++;
    } catch (error) {
      failed++;
      console.error(`  FAILED: ${document.title}: ${String(error).slice(0, 180)}`);
    }
  }

  console.log(
    `Done: ${changed} ${apply ? "renamed" : "rename candidates"}, ${unresolved} need review, ${failed} failed, ${indexFailed} need reindexing`
  );
  if (writePlanPath) {
    const plan: TitlePlan = {
      version: 1,
      createdAt: new Date().toISOString(),
      items: planItems,
    };
    await writeFile(writePlanPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(`Review plan written to ${writePlanPath}`);
  }
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
