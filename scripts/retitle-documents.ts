// Improve filename-like archive titles without overwriting intentional names.
//
// Preview stored-content changes:
//   npm run archive:retitle
// Apply them:
//   npm run archive:retitle -- --apply
// Ask Bucky to reread unresolved files, sequentially:
//   npm run archive:retitle -- --reanalyze --limit=20
// Resume after a reviewed batch:
//   npm run archive:retitle -- --reanalyze --offset=20 --limit=20

import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { categorizeDocument, categorizeText, processMediaFile } from "../src/lib/ai";
import { needsDocumentRetitle, resolveDocumentTitle } from "../src/lib/document-title";
import { extractTextFromFile, isExtractableType } from "../src/lib/extract-text";
import { indexDocument } from "../src/lib/embeddings";

const AI_SIZE_LIMIT = 15 * 1024 * 1024;
const apply = process.argv.includes("--apply");
const reanalyze = process.argv.includes("--reanalyze");
const skipIndex = process.argv.includes("--skip-index");
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

async function main() {
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
  if (reanalyze) console.log("Bucky rereading is enabled and runs one file at a time");

  let changed = 0;
  let unresolved = 0;
  let failed = 0;
  let indexFailed = 0;
  for (const document of candidates) {
    try {
      let nextTitle = resolveDocumentTitle({
        fileName: document.fileName,
        summary: document.aiSummary,
        extractedText: document.aiExtractedText,
        fileType: document.fileType,
        createdAt: document.createdAt,
      });

      if (isFallbackTitle(nextTitle) && reanalyze) {
        nextTitle = (await rereadTitle(document, categories)) || nextTitle;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }

      if (isFallbackTitle(nextTitle) || nextTitle === document.title) {
        unresolved++;
        console.log(`  NEEDS REVIEW: ${document.title} (${document.fileName})`);
        continue;
      }

      console.log(`  ${apply ? "RENAME" : "WOULD RENAME"}: ${document.title} -> ${nextTitle}`);
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
