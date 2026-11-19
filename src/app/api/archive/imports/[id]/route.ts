import type { NextRequest } from "next/server";
import { archiveFileInput, archiveRowId } from "@/lib/archive-import-format";
import { archiveImportError, archiveImportResponse, readArchiveImportJson, requireArchiveCurator } from "@/lib/archive-import-http";
import { prepareArchiveImportFile } from "@/lib/archive-imports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireArchiveCurator(request);
    const id = archiveRowId.parse((await params).id);
    const input = archiveFileInput.parse(await readArchiveImportJson(request));
    return archiveImportResponse(await prepareArchiveImportFile(id, input, actor));
  } catch (error) {
    return archiveImportError(error);
  }
}
