import { NextRequest, NextResponse } from "next/server";
import { analyzeDocumentBuffer } from "@/lib/document-analysis";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import path from "path";
import { resolveDocumentTitle } from "@/lib/document-title";

export async function POST(request: NextRequest) {
  try {
    const { filePath, fileType, fileName } = await request.json();

    if (!filePath || !fileType) {
      return NextResponse.json(
        { error: "filePath and fileType required" },
        { status: 400 }
      );
    }

    const categories = await prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    });

    const fullPath = path.join(process.cwd(), "public", filePath);
    const buffer = await readFile(fullPath);
    const originalFileName =
      typeof fileName === "string" && fileName.trim()
        ? path.basename(fileName.trim())
        : path.basename(filePath);
    const analysis = await analyzeDocumentBuffer({
      buffer,
      fileName: originalFileName,
      fileType,
      categories,
    });
    const result = analysis.result;

    if (!result) {
      return NextResponse.json({
        suggestedCategory: "",
        title: resolveDocumentTitle({
          fileName: originalFileName,
          fileType,
          createdAt: new Date(),
        }),
        summary: null,
        extractedText: null,
        tags: [],
        confidence: 0.3,
        analysisState: analysis.state,
        analysisError: analysis.error,
        resolvedCategorySlug: null,
        resolvedCategoryName: null,
        categoryCreated: false,
        needsReview: true,
      });
    }

    const resolution = await resolveDocumentCategory({
      suggestedCategory: result.suggestedCategory,
      newCategoryProposal: result.newCategoryProposal,
      confidence: result.confidence,
    });

    return NextResponse.json({
      ...result,
      analysisState: "ok",
      analysisError: null,
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
