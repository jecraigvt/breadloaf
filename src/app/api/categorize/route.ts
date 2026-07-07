import { NextRequest, NextResponse } from "next/server";
import { categorizeDocument, categorizeText, processMediaFile } from "@/lib/ai";
import { extractTextFromFile, isExtractableType } from "@/lib/extract-text";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const { filePath, fileType } = await request.json();

    if (!filePath || !fileType) {
      return NextResponse.json(
        { error: "filePath and fileType required" },
        { status: 400 }
      );
    }

    // Existing categories, with descriptions so the AI files consistently
    const categories = await prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    });

    // Read the file and convert to base64
    const fullPath = path.join(process.cwd(), "public", filePath);
    const buffer = await readFile(fullPath);
    const base64 = buffer.toString("base64");

    // Gemini's inline-data request limit is ~20MB — send oversized files to review
    const AI_SIZE_LIMIT = 15 * 1024 * 1024;

    // Route to the right processor
    let result;
    if (buffer.length > AI_SIZE_LIMIT) {
      return NextResponse.json({
        suggestedCategory: "",
        title: path.basename(filePath),
        summary: "File too large for AI analysis — categorize manually",
        extractedText: "",
        tags: [],
        confidence: 0.3,
        resolvedCategorySlug: null,
        resolvedCategoryName: null,
        categoryCreated: false,
        needsReview: true,
      });
    }
    if (fileType.startsWith("audio/") || fileType.startsWith("video/")) {
      result = await processMediaFile(base64, fileType, categories);
    } else if (fileType.startsWith("image/") || fileType === "application/pdf") {
      // Gemini reads images and PDFs natively
      result = await categorizeDocument(base64, fileType, categories);
    } else if (isExtractableType(fileType)) {
      // Word/Excel/CSV/TXT — extract text server-side, then categorize
      const extracted = await extractTextFromFile(buffer, fileType);
      if (extracted?.trim()) {
        result = await categorizeText(extracted, path.basename(filePath), categories);
      }
    }

    if (!result) {
      // Unsupported format or empty extraction — manual categorization
      return NextResponse.json({
        suggestedCategory: "",
        title: path.basename(filePath),
        summary: "Document uploaded — categorize manually or ask Jarvis about it",
        extractedText: "",
        tags: [],
        confidence: 0.3,
        resolvedCategorySlug: null,
        resolvedCategoryName: null,
        categoryCreated: false,
        needsReview: true,
      });
    }

    // Apply guardrails: match to an existing category, create a genuinely
    // new one from the AI's proposal, or flag for review.
    const resolution = await resolveDocumentCategory({
      suggestedCategory: result.suggestedCategory,
      newCategoryProposal: result.newCategoryProposal,
      confidence: result.confidence,
    });

    return NextResponse.json({
      ...result,
      resolvedCategorySlug: resolution.categorySlug,
      resolvedCategoryName: resolution.categoryName,
      categoryCreated: resolution.categoryCreated,
      needsReview: resolution.needsReview,
    });
  } catch (error) {
    console.error("Categorization error:", error);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
