import { NextRequest, NextResponse } from "next/server";
import { analyzeDocumentBuffer } from "@/lib/document-analysis";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { prisma } from "@/lib/prisma";
import path from "path";
import { resolveDocumentTitle } from "@/lib/document-title";
import { readTrustedRetainedFile, retainedPathName } from "@/lib/retained-file-security";
import { requestAccessContext, assertDocumentAccess, accessPolicyResponse, accessibleDocumentScopes, AccessPolicyError } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function POST(request: NextRequest) {
  try {
    const access = await requestAccessContext(request);
    const { filePath, fileType, fileName } = await request.json();

    if (typeof filePath !== "string" || typeof fileType !== "string" || !filePath || !fileType) {
      return NextResponse.json(
        { error: "filePath and fileType required" },
        { status: 400 }
      );
    }

    try { retainedPathName(filePath); } catch { return NextResponse.json({ error: "Choose a valid uploaded file" }, { status: 400 }); }
    if (!(await filterScopedDerivedRows([{ filePath }], accessibleDocumentScopes(access))).length) throw new AccessPolicyError("This retained source requires verified permission or an unlocked vault", 403);
    const references = await prisma.document.findMany({ where: { filePath }, select: { accessScope: true, deletedAt: true } });
    for (const reference of references) {
      if (reference.deletedAt) return NextResponse.json({ error: "That file was removed from the archive" }, { status: 404 });
      assertDocumentAccess(reference.accessScope, access);
    }
    let retained;
    try { retained = await readTrustedRetainedFile({ filePath, fileType, fileName }); }
    catch { return NextResponse.json({ error: "Choose a valid file uploaded to the archive" }, { status: 400 }); }

    const categories = await prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    });

    const buffer = retained.buffer;
    const originalFileName =
      typeof fileName === "string" && fileName.trim()
        ? path.basename(fileName.trim())
        : path.basename(filePath);
    const analysis = await analyzeDocumentBuffer({
      buffer,
      fileName: originalFileName,
      fileType: retained.fileType,
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
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    console.error("Categorization error:", error);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
