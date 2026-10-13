import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { closeOpenArchiveQuestions } from "@/lib/archive-questions";
import { getCurrentActor } from "@/lib/actor";
import { indexDocument, removeFromIndex } from "@/lib/embeddings";
import { dictationDisplaySummaries } from "@/lib/dictation-intelligence";
import { requestAccessContext, assertDocumentAccess, isPrivilegedActor, AccessPolicyError, accessPolicyResponse } from "@/lib/access-policy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
 try {
  const access = await requestAccessContext(request);
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { category: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertDocumentAccess(document.accessScope, access);

  const summaries = await dictationDisplaySummaries(document.fileType.startsWith("audio/") ? [document.filePath] : []);
  return NextResponse.json({ ...document, displaySummary: summaries.get(document.filePath) || null });
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  return NextResponse.json({ error: "Unable to load document" }, { status: 500 });
 }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
 try {
  const access = await requestAccessContext(request);
  const { id } = await params;
  const body = await request.json();
  const existingDocument = await prisma.document.findUnique({ where: { id } });
  if (!existingDocument) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertDocumentAccess(existingDocument.accessScope, access);

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
    if (body.accessScope !== existingDocument.accessScope && !isPrivilegedActor(access.actor)) {
      throw new AccessPolicyError("Only a verified curator or board member can change document access", 403);
    }
    assertDocumentAccess(body.accessScope, access);
    data.accessScope = body.accessScope;
  }

  const actor = typeof data.categoryId === "string" && data.categoryId
    ? await getCurrentActor(request)
    : null;
  const document = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.document.findUnique({
      where: { id },
      select: { categoryId: true, accessScope: true, filePath: true },
    });
    if (!existing) throw new Error("Document not found");
    assertDocumentAccess(existing.accessScope, access);

    const updated = await tx.document.update({
      where: { id },
      data,
      include: { category: true },
    });
    if (updated.accessScope !== "family" && updated.accessScope !== existing.accessScope) {
      const questions = await tx.buckyQuestion.findMany({ where: { sourceType: "document", sourceId: id }, select: { id: true } });
      await tx.jarvisMemory.updateMany({ where: { accessScope: "family", OR: [
        { filePath: existing.filePath }, { sourceType: "document", sourceId: id },
        { sourceType: "question", sourceId: { in: questions.map(question => question.id) } },
      ] }, data: { accessScope: updated.accessScope } });
    }
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
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  return NextResponse.json({ error: "Unable to update document" }, { status: 500 });
 }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
 try {
  const access = await requestAccessContext(_request);
  const { id } = await params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertDocumentAccess(document.accessScope, access);

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
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  return NextResponse.json({ error: "Unable to delete document" }, { status: 500 });
 }
}
