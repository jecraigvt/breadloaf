import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordingSources } from "@/lib/dictation-analysis";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { retainedFileResponse } from "@/lib/retained-file-response";
import { requestAccessContext, accessibleDocumentScopes, accessPolicyResponse } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
 try {
  const access = await requestAccessContext(request);
  const { id } = await params;
  const record = await prisma.maintenanceRecord.findUnique({ where: { id }, select: { sourceRecordings: true } });
  const index = Number(request.nextUrl.searchParams.get("index") || "0");
  const source = Number.isInteger(index) && index >= 0 ? recordingSources(record?.sourceRecordings)[index] : null;
  if (!source) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  const scopes = accessibleDocumentScopes(access);
  if (!(await filterScopedDerivedRows([record!], scopes)).length || !(await filterScopedDerivedRows([{ filePath: source.filePath }], scopes)).length) return NextResponse.json({ error: "This recording requires verified permission or an unlocked vault" }, { status: 403 });
  return retainedFileResponse(request, { ...source, fileType: resolveSupportedFileType("", source.fileName) || "application/octet-stream" });
 } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Recording is unavailable" }, { status: 503 }); }
}
