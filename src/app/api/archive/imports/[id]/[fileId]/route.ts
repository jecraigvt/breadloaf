import type { NextRequest } from "next/server";
import { archiveRowId } from "@/lib/archive-import-format";
import { archiveImportError, archiveImportResponse, requireArchiveAccount } from "@/lib/archive-import-http";
import { archiveBatchFile, archiveImportProgress, relayArchiveChunk } from "@/lib/archive-imports";
import { archiveImportFolder } from "@/lib/archive-original-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; fileId: string }> };

async function importFile(request: NextRequest, { params }: Context) {
  const actor = await requireArchiveAccount(request);
  archiveImportFolder();
  const { id, fileId } = await params;
  const file = await archiveBatchFile(archiveRowId.parse(id), archiveRowId.parse(fileId), actor.memberId);
  return { actor, file };
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { actor, file } = await importFile(request, context);
    return archiveImportResponse(await archiveImportProgress(file, actor));
  } catch (error) {
    return archiveImportError(error);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { actor, file } = await importFile(request, context);
    return archiveImportResponse(await relayArchiveChunk(file, actor, request));
  } catch (error) {
    return archiveImportError(error);
  }
}
