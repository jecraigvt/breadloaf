import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { indexDocument, indexMaintenance } from "@/lib/embeddings";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { generateId } from "@/lib/utils";
import { sha256 } from "@/lib/archive-integrity";
import { resolveDocumentTitle } from "@/lib/document-title";
import {
  analyzeDocumentBuffer,
  type AnalysisState,
} from "@/lib/document-analysis";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { createHistoricalPhotoQuestion } from "@/lib/historical-photo";

// Shared server-side document filing: save to /uploads, categorize with AI,
// apply category guardrails, create the Document row, cross-link maintenance
// receipts, and embed for semantic search. Used by the Bucky chat attachment
// flow; same pipeline shape as the Mail Room's fileAttachment and the /upload
// page's batch mode.

const SAVE_SIZE_LIMIT = 100 * 1024 * 1024; // matches lib/upload.ts MAX_SIZE

export interface FiledDocument {
  id: string;
  title: string;
  category: string | null;
  categoryCreated: boolean;
  needsReview: boolean;
  summary: string | null;
  extractedText: string | null;
  analysisState: AnalysisState;
  analysisError: string | null;
  // True when an identical file was already in the archive and we returned
  // the existing document instead of creating a duplicate.
  alreadyExisted: boolean;
}

export async function fileDocumentFromBuffer(opts: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  uploadedBy?: string;
}): Promise<FiledDocument> {
  const { buffer, fileName, uploadedBy } = opts;
  const type = resolveSupportedFileType(opts.contentType, fileName);
  if (!type) {
    throw new Error(
      `File type ${opts.contentType || "unknown"} is not supported because Breadloaf cannot read it`
    );
  }

  if (buffer.length > SAVE_SIZE_LIMIT) {
    throw new Error(`File too large (${Math.round(buffer.length / 1024 / 1024)}MB, max 100MB)`);
  }

  // Dedup at the source: if a byte-identical file is already filed, return the
  // existing document instead of manufacturing a second row — this is exactly
  // the exact-copy case the Tidy Up librarian used to clean up after the fact
  // (e.g. the same receipt both emailed in and attached in chat).
  const checksum = sha256(buffer);
  const existingCopy = await prisma.document.findFirst({
    where: { checksum, deletedAt: null },
    include: { category: true },
  });
  if (existingCopy) {
    return {
      id: existingCopy.id,
      title: existingCopy.title,
      category: existingCopy.category?.name ?? null,
      categoryCreated: false,
      needsReview: existingCopy.categoryId === null,
      summary: existingCopy.aiSummary,
      extractedText: existingCopy.aiExtractedText,
      analysisState: existingCopy.analysisState as AnalysisState,
      analysisError: existingCopy.analysisError,
      alreadyExisted: true,
    };
  }

  // Save to the uploads volume first — never lose a family document
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const ext = fileName.split(".").pop() || "bin";
  const uniqueName = `${generateId()}.${ext}`;
  await writeFile(path.join(uploadDir, uniqueName), buffer);

  // Categorize — oversized or unreadable formats skip AI and land in Needs Review
  const categories = await prisma.category.findMany({
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  });

  const analysis = await analyzeDocumentBuffer({
    buffer,
    fileName,
    fileType: type,
    categories,
  });
  const result = analysis.result;
  if (!result) {
    // The file is already durable on disk. AI enrichment must never prevent
    // the archive row from being created during a provider outage.
    console.error(
      `[Archive] ${analysis.state} for ${fileName}; filing for review: ${analysis.error}`
    );
  }

  const resolution = result
    ? await resolveDocumentCategory({
        suggestedCategory: result.suggestedCategory,
        newCategoryProposal: result.newCategoryProposal,
        confidence: result.confidence,
      })
    : {
        categoryId: null,
        categoryName: null,
        categorySlug: null,
        categoryCreated: false,
        needsReview: true,
      };

  const doc = await prisma.document.create({
    data: {
      title: resolveDocumentTitle({
        suggestedTitle: result?.title,
        fileName,
        summary: result?.summary,
        extractedText: result?.extractedText,
        fileType: type,
        createdAt: new Date(),
      }),
      description: result?.summary || null,
      fileName,
      filePath: `/uploads/${uniqueName}`,
      fileType: type,
      fileSize: buffer.length,
      categoryId: resolution.categoryId,
      tags: result?.tags?.length ? JSON.stringify(result.tags) : null,
      aiSummary: result?.summary || null,
      aiExtractedText: result?.extractedText || null,
      analysisState: analysis.state,
      analysisError: analysis.error,
      uploadedBy: uploadedBy || undefined,
      checksum,
    },
    include: { category: true },
  });

  // Cross-link: auto-create a maintenance record for maintenance/receipt docs
  const categoryName = doc.category?.name?.toLowerCase() || "";
  const isMaintenance = categoryName === "maintenance" || categoryName === "receipts";
  if (isMaintenance && (result?.maintenanceCost || result?.maintenanceVendor)) {
    try {
      const maintenance = await prisma.maintenanceRecord.create({
        data: {
          title: doc.title || "Maintenance Receipt",
          description: doc.aiSummary || undefined,
          category: categoryName === "receipts" ? "other" : undefined,
          performedBy: result?.maintenanceVendor || undefined,
          performedAt: result?.maintenanceDate ? new Date(result.maintenanceDate) : new Date(),
          cost: result?.maintenanceCost ? parseFloat(String(result.maintenanceCost)) : undefined,
        },
      });
      void indexMaintenance(maintenance.id);
    } catch (e) {
      console.error("Cross-link maintenance record failed:", e);
    }
  }

  // Embed for semantic search so Bucky can recall it later
  indexDocument(doc.id).catch((e) =>
    console.error("Document embedding failed:", e)
  );

  if (result?.intakeType === "historical_photo") {
    try {
      await createHistoricalPhotoQuestion({
        documentId: doc.id,
        documentTitle: doc.title,
        analysis: result,
      });
    } catch (error) {
      console.error("Historical-photo question creation failed:", error);
    }
  }

  // If we couldn't confidently file it, raise a persistent question so the
  // uncertain case is surfaced actively (Questions tab + homepage badge)
  // instead of sitting silently in the Needs Review bucket. No email here —
  // a batch of unclear uploads shouldn't blast the family's inbox; the badge
  // and tab are enough. Answering it lets Bucky refile via set_document_category.
  if (resolution.needsReview) {
    try {
      await prisma.buckyQuestion.create({
        data: {
          question: `Where should "${doc.title}" be filed?`,
          context: result?.suggestedCategory
            ? `My best guess was "${result.suggestedCategory}", but I wasn't confident enough to file it automatically. Open the document to set a category, or just reply with one.`
            : `I couldn't read or confidently categorize this ${type || "file"} on intake. Open the document to set a category, or just reply with one.`,
          questionType: "archive",
          sourceType: "document",
          sourceId: doc.id,
          sourceLabel: doc.title,
          options: result?.suggestedCategory ? [result.suggestedCategory, "Other"] : undefined,
        },
      });
    } catch (e) {
      console.error("Needs-review question creation failed:", e);
    }
  }

  return {
    id: doc.id,
    title: doc.title,
    category: resolution.categoryName,
    categoryCreated: resolution.categoryCreated,
    needsReview: resolution.needsReview,
    summary: doc.aiSummary,
    extractedText: doc.aiExtractedText,
    analysisState: doc.analysisState as AnalysisState,
    analysisError: doc.analysisError,
    alreadyExisted: false,
  };
}
