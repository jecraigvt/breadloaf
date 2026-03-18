import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Return categories with counts if requested
  if (searchParams.get("categoriesOnly") === "true") {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(categories);
  }

  const query = searchParams.get("q") || "";
  const categorySlug = searchParams.get("category");

  const where: Record<string, unknown> = {};

  if (query) {
    where.OR = [
      { title: { contains: query } },
      { aiSummary: { contains: query } },
      { aiExtractedText: { contains: query } },
      { tags: { contains: query } },
      { description: { contains: query } },
    ];
  }

  if (categorySlug) {
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
    } = body;

    // Find category by name or slug
    let categoryId: string | null = null;
    if (categorySlug) {
      // Try exact slug match first
      let category = await prisma.category.findUnique({
        where: { slug: categorySlug.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "") },
      });

      // Try name match
      if (!category) {
        category = await prisma.category.findUnique({
          where: { name: categorySlug },
        });
      }

      // Try partial match
      if (!category) {
        category = await prisma.category.findFirst({
          where: { name: { contains: categorySlug } },
        });
      }

      if (category) {
        categoryId = category.id;
      }
    }

    const document = await prisma.document.create({
      data: {
        title,
        description,
        fileName,
        filePath,
        fileType,
        fileSize: typeof fileSize === "string" ? parseInt(fileSize) : fileSize,
        categoryId,
        tags: tags ? JSON.stringify(tags) : null,
        aiSummary,
        aiExtractedText,
        uploadedBy,
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
        await prisma.maintenanceRecord.create({
          data: {
            title: title || "Maintenance Receipt",
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
      } catch (e) {
        // Don't fail the document save if cross-linking fails
        console.error("Cross-link maintenance record failed:", e);
      }
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error("Create document error:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }
}
