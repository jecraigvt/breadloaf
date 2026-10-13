import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestAccessContext, assertDocumentAccess, accessPolicyResponse } from "@/lib/access-policy";
import { retainedPathName } from "@/lib/retained-file-security";
import { retainedFileResponse } from "@/lib/retained-file-response";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";
import { accessibleDocumentScopes } from "@/lib/access-policy";

export const dynamic = "force-dynamic";

/** Middleware rewrites /uploads here so Next's public-file serving cannot bypass scopes. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const access = await requestAccessContext(request);
    const { path: parts } = await params;
    const filePath = `/uploads/${parts.join("/")}`;
    try { retainedPathName(filePath); }
    catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
    if (!(await filterScopedDerivedRows([{ filePath }], accessibleDocumentScopes(access))).length) return NextResponse.json({ error: "This file requires verified permission or an unlocked vault" }, { status: 403 });
    const references = await prisma.document.findMany({
      where: { filePath }, select: { fileName: true, fileType: true, filePath: true, accessScope: true, deletedAt: true },
    });
    const active = references.filter((document) => !document.deletedAt);
    if (active.length) {
      for (const document of active) assertDocumentAccess(document.accessScope, access);
      return retainedFileResponse(request, active[0]);
    }
    if (references.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [memory, portrait] = await Promise.all([
      prisma.jarvisMemory.findFirst({ where: { filePath, status: "active", accessScope: "family" }, select: { id: true } }),
      prisma.familyMember.findFirst({ where: { photoUrl: filePath }, select: { id: true } }),
    ]);
    const fileType = resolveSupportedFileType("", parts[0]);
    if ((!memory && !portrait) || !fileType) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return retainedFileResponse(request, { filePath, fileName: parts[0], fileType });
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    return NextResponse.json({ error: "File is unavailable" }, { status: 500 });
  }
}
