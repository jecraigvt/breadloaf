import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveSupportedFileType, normalizeMimeType } from "@/lib/document-file-types";
import { sha256 } from "@/lib/archive-integrity";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "application/pdf": "pdf", "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt", "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp", "text/plain": "txt", "text/csv": "csv",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-msvideo": "avi",
};

export function retainedExtension(fileName: string, fileType: string): string {
  const type = normalizeMimeType(fileType);
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const inferred = resolveSupportedFileType("", `file.${extension}`);
  if (inferred === type || (extension === "webm" && type === "audio/webm")) return extension;
  const canonical = EXTENSIONS[type];
  if (!canonical) throw new Error("Unsupported retained file type");
  return canonical;
}

export function retainedPathName(value: string): string {
  // Files are generated names in one flat directory; no encoded paths or separators.
  const match = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]{0,200})$/.exec(value);
  if (!match || match[1].includes("..")) throw new Error("Invalid retained file path");
  return match[1];
}

export async function containedRetainedPath(filePath: string, root = path.join(process.cwd(), "public", "uploads")): Promise<string> {
  const name = retainedPathName(filePath);
  const realRoot = await realpath(root);
  const resolved = await realpath(path.join(realRoot, name));
  const relative = path.relative(realRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid retained file path");
  return resolved;
}

export async function readTrustedRetainedFile(input: { filePath: string; fileName?: string; fileType?: string }, root?: string) {
  const name = retainedPathName(input.filePath);
  let fileType = resolveSupportedFileType("", name);
  if (name.endsWith(".webm") && input.fileType === "audio/webm") fileType = "audio/webm";
  if (!fileType) throw new Error("Unsupported retained file type");
  // Type is determined by the server's retained filename, never an arbitrary MIME header.
  if (input.fileType && normalizeMimeType(input.fileType) !== fileType) {
    // Common browser aliases share the same retained format.
    if (retainedExtension(name, input.fileType) !== path.extname(name).slice(1).toLowerCase()) {
      throw new Error("Retained file type does not match the uploaded format");
    }
  }
  const absolute = await containedRetainedPath(input.filePath, root);
  const info = await stat(absolute);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error("Retained file is unavailable or too large");
  const buffer = await readFile(absolute);
  return { buffer, filePath: input.filePath, fileName: path.basename(input.fileName || name), fileType, fileSize: buffer.length, checksum: sha256(buffer) };
}

export function retainedResponseType(declaredType: string): { fileType: string; inline: boolean } {
  const fileType = normalizeMimeType(declaredType);
  const inline = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/plain", "text/csv"].includes(fileType)
    || /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|wav|x-wav|ogg|webm)$/.test(fileType)
    || /^video\/(mp4|quicktime|webm|x-msvideo)$/.test(fileType);
  return { fileType: inline ? fileType : "application/octet-stream", inline };
}
