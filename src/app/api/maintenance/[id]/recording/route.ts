import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordingSources } from "@/lib/dictation-analysis";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { retainedFileResponse } from "@/lib/retained-file-response";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const record = await prisma.maintenanceRecord.findUnique({ where: { id: params.id }, select: { sourceRecordings: true } });
  const index = Number(request.nextUrl.searchParams.get("index") || "0");
  const source = Number.isInteger(index) && index >= 0 ? recordingSources(record?.sourceRecordings)[index] : null;
  if (!source) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  return retainedFileResponse(request, { ...source, fileType: resolveSupportedFileType("", source.fileName) || "application/octet-stream" });
}
