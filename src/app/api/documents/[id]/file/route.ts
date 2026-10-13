import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retainedFileResponse } from "@/lib/retained-file-response";
import { requestAccessContext, assertDocumentAccess, accessPolicyResponse, accessibleDocumentScopes } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";
import { safeLinkUrl } from "@/lib/safe-external-fetch";

// Stream a document's file from the uploads volume. Next.js only
// guarantees serving public/ assets present at BUILD time, so runtime
// uploads need this route. Also keeps file access behind the PIN.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
 try {
  const access = await requestAccessContext(request);
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc || doc.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertDocumentAccess(doc.accessScope, access);
  if (doc.fileType === "link") {
    try { return NextResponse.redirect(safeLinkUrl(doc.filePath)); }
    catch { return NextResponse.json({ error: "This link is invalid" }, { status: 400 }); }
  }

  if (!(await filterScopedDerivedRows([{ filePath: doc.filePath }], accessibleDocumentScopes(access))).length) return NextResponse.json({ error: "This file requires verified permission or an unlocked vault" }, { status: 403 });
  return retainedFileResponse(request, doc, request.nextUrl.searchParams.get("download") === "1");
 } catch (error) {
  const denied = accessPolicyResponse(error);
  if (denied) return denied;
  return NextResponse.json({ error: "Original file is unavailable" }, { status: 500 });
 }
}
