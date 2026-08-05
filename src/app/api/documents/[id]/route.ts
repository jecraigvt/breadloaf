import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { closeOpenArchiveQuestions } from "@/lib/archive-questions";
import { getCurrentActor } from "@/lib/actor";
import { indexDocument, removeFromIndex } from "@/lib/embeddings";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(document);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (body.action === "restore") {
    const document = await prisma.document.update({
      where: { id },
      data: { deletedAt: null, deletedBy: null },
      include: { category: true },
    });
    void indexDocument(document.id);
    return NextResponse.json(document);
  }

  const data: Record<string, unknown> = {};
  for (const key of ["title", "description", "categoryId", "tags", "assetId"]) {
    if (key in body) data[key] = body[key];
  }
  if (typeof body.accessScope === "string" && ["family", "board", "vault"].includes(body.accessScope)) {
    data.accessScope = body.accessScope;
  }

  const actor = typeof data.categoryId === "string" && data.categoryId
    ? await getCurrentActor(request)
    : null;
  const document = await prisma.$transaction(async (tx) => {
    const existing = await tx.document.findUnique({
      where: { id },
      select: { categoryId: true },
    });
    if (!existing) throw new Error("Document not found");

    const updated = await tx.document.update({
      where: { id },
      data,
      include: { category: true },
    });
    if (
      typeof data.categoryId === "string" &&
      data.categoryId &&
      data.categoryId !== existing.categoryId &&
      updated.category
    ) {
      await closeOpenArchiveQuestions(tx, {
        documentId: updated.id,
        categoryName: updated.category.name,
        answeredBy: actor?.displayName || "Family member",
      });
    }
    return updated;
  });
  void indexDocument(document.id);

  return NextResponse.json(document);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deletedBy = await getFamilyFromAuthToken(
    _request.cookies.get(getAuthCookieName())?.value
  );
  await prisma.document.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: deletedBy || undefined },
  });
  void removeFromIndex("document", id).catch((error) =>
    console.error("Document index cleanup failed:", error)
  );

  return NextResponse.json({ success: true, recoverable: true });
}
