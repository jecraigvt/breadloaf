import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexDocument, indexMaintenance } from "@/lib/embeddings";
import { slugifyCategory } from "@/lib/document-categories";
import { resolveDocumentTitle } from "@/lib/document-title";
import {
  normalizeStoredAnalysis,
} from "@/lib/document-analysis";
import { getArchiveHealth } from "@/lib/archive-health";
import { createHistoricalPhotoQuestion } from "@/lib/historical-photo";
import { dictationDisplaySummaries, tryAnalyzeRetainedDictation } from "@/lib/dictation-intelligence";
import { requestAccessContext, accessibleDocumentScopes, assertDocumentAccess, accessPolicyResponse } from "@/lib/access-policy";
import { readTrustedRetainedFile } from "@/lib/retained-file-security";
import { safeLinkUrl } from "@/lib/safe-external-fetch";
import { getCurrentActor } from "@/lib/actor";
import type { Prisma } from "@prisma/client";
import { maintenanceInputSchema } from "@/lib/maintenance-contract";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";
import { AccessPolicyError } from "@/lib/access-policy";

function documentPageResponse(documents: unknown[], total: number, offset: number) {
  const next = offset + documents.length;
  return NextResponse.json(documents, { headers: {
    "X-Total-Count": String(total), "X-Has-More": String(next < total), "X-Next-Offset": String(next),
  } });
}

export async function GET(request: NextRequest) {
 try {
  const access = await requestAccessContext(request);
  const scopes = accessibleDocumentScopes(access);
  const searchParams = request.nextUrl.searchParams;

  if (searchParams.get("healthOnly") === "true") {
    return NextResponse.json(await getArchiveHealth(scopes));
  }

  // Return categories with counts if requested
  if (searchParams.get("categoriesOnly") === "true") {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { documents: { where: { deletedAt: null, accessScope: { in: scopes } } } } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(categories);
  }

  const query = (searchParams.get("q") || "").trim();
  const rawOffset = searchParams.get("offset") || "0";
  const rawLimit = searchParams.get("limit") || "50";
  if (query.length > 300 || !/^\d+$/.test(rawOffset) || !/^\d+$/.test(rawLimit)
    || Number(rawOffset) > 1_000_000 || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    return NextResponse.json({ error: "Use a search under 300 characters and a valid document page." }, { status: 400 });
  }
  const offset = Number(rawOffset), limit = Number(rawLimit);
  const categorySlug = searchParams.get("category");
  const showDeleted = searchParams.get("deleted") === "true";

  const where: Prisma.DocumentWhereInput = {
    deletedAt: showDeleted ? { not: null } : null,
    accessScope: { in: scopes },
  };

  if (query) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { aiSummary: { contains: query, mode: "insensitive" } },
      { aiExtractedText: { contains: query, mode: "insensitive" } },
      { tags: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ];
  }

  if (categorySlug === "uncategorized") {
    // Needs Review bucket — docs the AI couldn't confidently file
    where.categoryId = null;
  } else if (categorySlug) {
    const category = await prisma.category.findUnique({
      where: { slug: categorySlug },
    });
    if (!category) return documentPageResponse([], 0, offset);
    where.categoryId = category.id;
  }

  const [documents, total] = await Promise.all([
    prisma.document.findMany({ where, include: { category: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
    prisma.document.count({ where }),
  ]);

  const summaries = await dictationDisplaySummaries(documents.filter((doc) => doc.fileType.startsWith("audio/")).map((doc) => doc.filePath));
  return documentPageResponse(documents.map((doc) => ({ ...doc, displaySummary: summaries.get(doc.filePath) || null })), total, offset);
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  console.error("Document list failed", error);
  return NextResponse.json({ error: "Unable to load documents" }, { status: 500 });
 }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requestAccessContext(request);
    const actor = await getCurrentActor(request);
    const body = await request.json();
    const {
      title,
      description,
      fileName: requestedFileName,
      filePath: requestedFilePath,
      fileType: requestedFileType,
      categorySlug,
      tags,
      aiSummary,
      aiExtractedText,
      accessScope,
      analysisState: requestedAnalysisState,
      analysisError: requestedAnalysisError,
      intakeType,
      historicalPhotoCandidateIds,
      historicalPhotoEra,
      historicalPhotoSetting,
    } = body;

    const scope = typeof accessScope === "string" ? accessScope : "family";
    assertDocumentAccess(scope, access);
    if (typeof requestedFilePath !== "string" || typeof requestedFileType !== "string") {
      return NextResponse.json({ error: "An uploaded file or valid link is required" }, { status: 400 });
    }
    let fileName: string;
    let filePath: string;
    let fileType: string;
    let fileSize: number;
    let checksum: string | null;
    try {
      if (requestedFileType === "link") {
        filePath = safeLinkUrl(requestedFilePath).toString();
        fileName = typeof requestedFileName === "string" ? requestedFileName.slice(0, 255) : "Linked document";
        fileType = "link";
        fileSize = 0;
        checksum = null;
      } else {
        if (!(await filterScopedDerivedRows([{ filePath: requestedFilePath }], accessibleDocumentScopes(access))).length) throw new AccessPolicyError("This retained source requires verified permission or an unlocked vault", 403);
        const existing = await prisma.document.findMany({ where: { filePath: requestedFilePath }, include: { category: true } });
        for (const reference of existing) {
          assertDocumentAccess(reference.accessScope, access);
          if (reference.deletedAt) return NextResponse.json({ error: "Restore the existing archived file instead" }, { status: 409 });
        }
        if (existing.length) return NextResponse.json(existing[0]);
        const retained = await readTrustedRetainedFile({ filePath: requestedFilePath, fileName: requestedFileName, fileType: requestedFileType });
        ({ fileName, filePath, fileType, fileSize, checksum } = retained);
      }
    } catch (error) {
      const denied = accessPolicyResponse(error);
      if (denied) return denied;
      return NextResponse.json({ error: "Choose a valid uploaded file or an HTTP(S) link" }, { status: 400 });
    }
    const uploadedBy = actor?.fullName || "Family member";

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
        fileSize,
        categoryId,
        tags: tags ? JSON.stringify(tags) : null,
        aiSummary: storedSummary,
        aiExtractedText: storedExtractedText,
        analysisState,
        analysisError,
        uploadedBy,
        checksum: checksum || null,
        accessScope: scope,
      },
      include: { category: true },
    });

    // Cross-link: auto-create maintenance record for maintenance/receipt documents
    const categoryName = document.category?.name?.toLowerCase() || "";
    const isMaintenance =
      categoryName === "maintenance" || categoryName === "receipts";
    const { maintenanceCost, maintenanceDate, maintenanceVendor } = body;

    if (document.accessScope === "family" && isMaintenance && (maintenanceCost != null || maintenanceVendor)) {
      try {
        const maintenanceInput = maintenanceInputSchema.safeParse({
          title: resolvedTitle || "Maintenance Receipt", description: aiSummary || description || undefined,
          category: "General", performedBy: maintenanceVendor || undefined,
          performedAt: maintenanceDate, cost: maintenanceCost ?? undefined,
        });
        // Keep the original document even when intake lacks an actual work date.
        // The upload date is not evidence of when the repair happened.
        if (maintenanceInput.success) {
        const maintenance = await prisma.maintenanceRecord.create({
          data: {
            ...maintenanceInput.data,
            sourceRecordings: document.fileType.startsWith("audio/") && document.aiExtractedText
              ? [{ documentId: document.id, filePath: document.filePath, fileName: document.fileName, transcript: document.aiExtractedText }]
              : [{ documentId: document.id }],
          },
        });
        void indexMaintenance(maintenance.id);
        }
      } catch (e) {
        // Don't fail the document save if cross-linking fails
        console.error("Cross-link maintenance record failed:", e);
      }
    }

    if (document.fileType.startsWith("audio/") && document.aiExtractedText && document.accessScope === "family") {
      await tryAnalyzeRetainedDictation({ filePath: document.filePath, transcript: document.aiExtractedText, title: document.title });
    }

    // Embed document for semantic search (async, don't block response)
    indexDocument(document.id).catch((e) =>
      console.error("Document embedding failed:", e)
    );

    if (document.accessScope === "family" && intakeType === "historical_photo") {
      try {
        await createHistoricalPhotoQuestion({
          documentId: document.id,
          documentTitle: document.title,
          analysis: {
            intakeType,
            historicalPhotoCandidateIds: Array.isArray(historicalPhotoCandidateIds)
              ? historicalPhotoCandidateIds.map(String)
              : [],
            historicalPhotoEra:
              typeof historicalPhotoEra === "string" ? historicalPhotoEra : null,
            historicalPhotoSetting:
              typeof historicalPhotoSetting === "string"
                ? historicalPhotoSetting
                : null,
          },
        });
      } catch (error) {
        console.error("Historical-photo question creation failed:", error);
      }
    }

    return NextResponse.json(document);
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    console.error("Create document error:", error);
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    );
  }
}
