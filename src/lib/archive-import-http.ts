import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AccessPolicyError, accessPolicyResponse, requestAccessContext } from "@/lib/access-policy";
import { ArchiveImportError } from "@/lib/archive-import-format";

export const archiveNoStore = { "Cache-Control": "private, no-store" };

export async function requireArchiveCurator(request: NextRequest) {
  const { actor } = await requestAccessContext(request);
  if (!actor?.verified || !actor.isCurator) throw new AccessPolicyError("A verified archive curator is required.", 403);
  return actor;
}

export async function readArchiveImportJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) {
    throw new ArchiveImportError("Send a JSON import request.", 415);
  }
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) throw new ArchiveImportError("The import request is too large.", 413);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ArchiveImportError) throw error;
    throw new ArchiveImportError("Invalid JSON import request.", 400);
  } finally {
    reader.releaseLock();
  }
}

export function archiveImportResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: archiveNoStore });
}

export function archiveImportError(error: unknown) {
  const access = accessPolicyResponse(error);
  if (access) {
    access.headers.set("Cache-Control", "private, no-store");
    return access;
  }
  if (error instanceof ArchiveImportError) return archiveImportResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return archiveImportResponse({ error: "Check the selected folder and file." }, 400);
  // Error strings from fetch can include a resumable URL. Keep that URL private.
  return archiveImportResponse({ error: "Unable to finish this import request. Resume the folder to try again." }, 502);
}
