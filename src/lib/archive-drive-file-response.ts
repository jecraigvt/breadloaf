import { archiveDriveId, ArchiveImportError } from "@/lib/archive-import-format";
import { readArchiveOriginal } from "@/lib/archive-original-response";
import { prisma } from "@/lib/prisma";
import { byteRange } from "@/lib/retained-file-response";
import { retainedResponseType } from "@/lib/retained-file-security";

export async function driveArchiveFileResponse(request: Request,
  doc: { id: string; filePath: string; fileName: string; fileType: string }, download: boolean) {
  const original = await prisma.archiveImportFile.findUnique({ where: { documentId: doc.id } });
  if (!original || original.driveId !== archiveDriveId(doc.filePath)) {
    throw new ArchiveImportError("Original file is unavailable.", 404);
  }
  const size = Number(original.sizeBytes);
  const { fileType, inline } = retainedResponseType(doc.fileType);
  const headers = new Headers({
    "Content-Type": fileType,
    "Content-Disposition": (download || !inline ? "attachment" : "inline") +
      "; filename*=UTF-8''" + encodeURIComponent(doc.fileName.replace(/[\r\n]/g, "")).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16)),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store", "Accept-Ranges": "bytes",
  });
  let range;
  try {
    range = byteRange(request.headers.get("range"), size);
  } catch {
    headers.set("Content-Range", "bytes */" + size);
    return new Response(null, { status: 416, headers });
  }
  const span = range && (range.start + "-" + range.end);
  const response = await readArchiveOriginal(original, { signal: request.signal, range });
  if (response.status !== (span ? 206 : 200) || !response.body ||
      (span && response.headers.get("content-range") !== "bytes " + span + "/" + size)) {
    await response.body?.cancel();
    throw new ArchiveImportError("Drive could not return the requested part of the original.", 502);
  }
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
  if (span) headers.set("Content-Range", "bytes " + span + "/" + size);
  return new Response(response.body, { status: span ? 206 : 200, headers });
}
