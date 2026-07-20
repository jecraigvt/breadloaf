import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  categorizeDocument,
  categorizeText,
  processMediaFile,
  embedAndStore,
} from "@/lib/ai";
import { extractTextFromFile, isExtractableType } from "@/lib/extract-text";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { generateId } from "@/lib/utils";
import { sha256 } from "@/lib/archive-integrity";

// Shared server-side document filing: save to /uploads, categorize with AI,
// apply category guardrails, create the Document row, cross-link maintenance
// receipts, and embed for semantic search. Used by the Bucky chat attachment
// flow; same pipeline shape as the Mail Room's fileAttachment and the /upload
// page's batch mode.

const AI_SIZE_LIMIT = 15 * 1024 * 1024; // Gemini inline-data limit (~20MB, with headroom)
const SAVE_SIZE_LIMIT = 100 * 1024 * 1024; // matches lib/upload.ts MAX_SIZE

export interface FiledDocument {
  id: string;
  title: string;
  category: string | null;
  categoryCreated: boolean;
  needsReview: boolean;
  summary: string | null;
  extractedText: string | null;
}

export async function fileDocumentFromBuffer(opts: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  uploadedBy?: string;
}): Promise<FiledDocument> {
  const { buffer, fileName, uploadedBy } = opts;
  const type = opts.contentType.split(";")[0].trim().toLowerCase();

  if (buffer.length > SAVE_SIZE_LIMIT) {
    throw new Error(`File too large (${Math.round(buffer.length / 1024 / 1024)}MB, max 100MB)`);
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

  let result = null;
  if (buffer.length <= AI_SIZE_LIMIT) {
    if (type.startsWith("audio/") || type.startsWith("video/")) {
      result = await processMediaFile(buffer.toString("base64"), type, categories);
    } else if (type.startsWith("image/") || type === "application/pdf") {
      result = await categorizeDocument(buffer.toString("base64"), type, categories);
    } else if (isExtractableType(type)) {
      const extracted = await extractTextFromFile(buffer, type);
      if (extracted?.trim()) {
        result = await categorizeText(extracted, fileName, categories);
      }
    }
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
      title: result?.title || fileName,
      description: result?.summary || null,
      fileName,
      filePath: `/uploads/${uniqueName}`,
      fileType: type,
      fileSize: buffer.length,
      categoryId: resolution.categoryId,
      tags: result?.tags?.length ? JSON.stringify(result.tags) : null,
      aiSummary: result?.summary || null,
      aiExtractedText: result?.extractedText || null,
      uploadedBy: uploadedBy || undefined,
      checksum: sha256(buffer),
    },
    include: { category: true },
  });

  // Cross-link: auto-create a maintenance record for maintenance/receipt docs
  const categoryName = doc.category?.name?.toLowerCase() || "";
  const isMaintenance = categoryName === "maintenance" || categoryName === "receipts";
  if (isMaintenance && (result?.maintenanceCost || result?.maintenanceVendor)) {
    try {
      await prisma.maintenanceRecord.create({
        data: {
          title: doc.title || "Maintenance Receipt",
          description: doc.aiSummary || undefined,
          category: categoryName === "receipts" ? "other" : undefined,
          performedBy: result?.maintenanceVendor || undefined,
          performedAt: result?.maintenanceDate ? new Date(result.maintenanceDate) : new Date(),
          cost: result?.maintenanceCost ? parseFloat(String(result.maintenanceCost)) : undefined,
        },
      });
    } catch (e) {
      console.error("Cross-link maintenance record failed:", e);
    }
  }

  // Embed for semantic search so Bucky can recall it later
  const embeddingContent = [
    doc.title,
    doc.category?.name || "",
    doc.aiSummary || "",
    doc.aiExtractedText || "",
  ]
    .filter(Boolean)
    .join(" | ");
  embedAndStore("document", doc.id, embeddingContent).catch((e) =>
    console.error("Document embedding failed:", e)
  );

  return {
    id: doc.id,
    title: doc.title,
    category: resolution.categoryName,
    categoryCreated: resolution.categoryCreated,
    needsReview: resolution.needsReview,
    summary: doc.aiSummary,
    extractedText: doc.aiExtractedText,
  };
}
