import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexDocument, indexMaintenance } from "@/lib/embeddings";
import { slugifyCategory } from "@/lib/document-categories";
import { resolveDocumentTitle } from "@/lib/document-title";
import {
  normalizeStoredAnalysis,
} from "@/lib/document-analysis";
import { getArchiveHealth } from "@/lib/archive-health";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  if (searchParams.get("healthOnly") === "true") {
    return NextResponse.json(await getArchiveHealth());
  }

  // Return categories with counts if requested
  if (searchParams.get("categoriesOnly") === "true") {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(categories);
  }

  const query = searchParams.get("q") || "";
  const categorySlug = searchParams.get("category");
  const showDeleted = searchParams.get("deleted") === "true";

  const where: Record<string, unknown> = {
    deletedAt: showDeleted ? { not: null } : null,
  };

  if (query) {
    where.OR = [
      { title: { contains: query } },
      { aiSummary: { contains: query } },
      { aiExtractedText: { contains: query } },
      { tags: { contains: query } },
      { description: { contains: query } },
    ];
  }

  if (categorySlug === "uncategorized") {
    // Needs Review bucket — docs the AI couldn't confidently file
    where.categoryId = null;
  } else if (categorySlug) {
    const category = await prisma.category.findUnique({
      where: { slug: categorySlug },
    });
    if (category) {
      where.categoryId = category.id;
    }
  }

  const documents = await prisma.document.findMany({
    where,
    include: { category: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(documents);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      fileName,
      filePath,
      fileType,
      fileSize,
      categorySlug,
      tags,
      aiSummary,
      aiExtractedText,
      uploadedBy,
      checksum,
      accessScope,
      analysisState: requestedAnalysisState,
      analysisError: requestedAnalysisError,
    } = body;

    const {
      analysisState,
      analysisError,
      aiSummary: storedSummary,
      aiExtractedText: storedExtractedText,
    } = normalizeStoredAnalysis({
      analysisState: requestedAnalysisState,
      analysisError: requestedAnalysisError,
      aiSummary,
      aiExtractedText,
    });

    const resolvedTitle = resolveDocumentTitle({
      suggestedTitle: title,
      fileName,
      summary: storedSummary || description,
      extractedText: storedExtractedText,
      fileType,
      createdAt: new Date(),
    });

    // Strict category lookup: exact slug or exact (case-insensitive) name.
    // No partial matching — a wrong guess should land in Needs Review
    // (categoryId null), not in a random category.
    let categoryId: string | null = null;
    if (categorySlug?.trim()) {
      const raw = categorySlug.trim();
      const category = await prisma.category.findFirst({
        where: {
          OR: [
            { slug: slugifyCategory(raw) },
            { name: { equals: raw, mode: "insensitive" } },
          ],
        },
      });
      if (category) categoryId = category.id;
    }

    const document = await prisma.document.create({
      data: {
        title: resolvedTitle,
        description: analysisState === "ok" ? description || null : null,
        fileName,
        filePath,
        fileType,
        fileSize: typeof fileSize === "string" ? parseInt(fileSize) : fileSize,
        categoryId,
        tags: tags ? JSON.stringify(tags) : null,
        aiSummary: storedSummary,
        aiExtractedText: storedExtractedText,
        analysisState,
        analysisError,
        uploadedBy,
        checksum: checksum || null,
        accessScope: ["family", "board", "vault"].includes(accessScope) ? accessScope : "family",
      },
      include: { category: true },
    });

    // Cross-link: auto-create maintenance record for maintenance/receipt documents
    const categoryName = document.category?.name?.toLowerCase() || "";
    const isMaintenance =
      categoryName === "maintenance" || categoryName === "receipts";
    const { maintenanceCost, maintenanceDate, maintenanceVendor } = body;

    if (isMaintenance && (maintenanceCost || maintenanceVendor)) {
      try {
        const maintenance = await prisma.maintenanceRecord.create({
          data: {
            title: resolvedTitle || "Maintenance Receipt",
            description: aiSummary || description || undefined,
            category: categoryName === "receipts" ? "other" : undefined,
            performedBy: maintenanceVendor || undefined,
            performedAt: maintenanceDate
              ? new Date(maintenanceDate)
              : new Date(),
            cost: maintenanceCost
              ? parseFloat(String(maintenanceCost))
              : undefined,
          },
        });
        void indexMaintenance(maintenance.id);
      } catch (e) {
        // Don't fail the document save if cross-linking fails
        console.error("Cross-link maintenance record failed:", e);
      }
    }

    // Embed document for semantic search (async, don't block response)
    indexDocument(document.id).catch((e) =>
      console.error("Document embedding failed:", e)
    );

    return NextResponse.json(document);
  } catch (error) {
    console.error("Create document error:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }
}
