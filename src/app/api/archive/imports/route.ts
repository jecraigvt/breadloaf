import type { NextRequest } from "next/server";
import { archiveBatchInput } from "@/lib/archive-import-format";
import { archiveImportError, archiveImportResponse, readArchiveImportJson, requireArchiveAccount } from "@/lib/archive-import-http";
import { createArchiveImport, listArchiveImports } from "@/lib/archive-imports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireArchiveAccount(request);
    return archiveImportResponse({ imports: await listArchiveImports(actor.memberId) });
  } catch (error) {
    return archiveImportError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireArchiveAccount(request);
    const input = archiveBatchInput.parse(await readArchiveImportJson(request));
    return archiveImportResponse(await createArchiveImport(input, actor.memberId));
  } catch (error) {
    return archiveImportError(error);
  }
}
