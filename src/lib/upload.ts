import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { generateId } from "./utils";
import { sha256 } from "./archive-integrity";
import { resolveSupportedFileType } from "./document-file-types";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const MAX_SIZE = 100 * 1024 * 1024; // 100MB for audio/video

export function isAudioType(type: string): boolean {
  return type.startsWith("audio/");
}

export function isVideoType(type: string): boolean {
  return type.startsWith("video/");
}

export function isMediaType(type: string): boolean {
  return isAudioType(type) || isVideoType(type);
}

export async function saveUploadedFile(file: File) {
  const resolvedType = resolveSupportedFileType(file.type, file.name);
  if (!resolvedType) {
    throw new Error(
      `File type ${file.type || "unknown"} is not supported because Breadloaf cannot read it`
    );
  }

  if (file.size > MAX_SIZE) {
    throw new Error("File too large (max 100MB)");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const ext = file.name.split(".").pop() || "jpg";
  const uniqueName = `${generateId()}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, uniqueName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  return {
    fileName: file.name,
    filePath: `/uploads/${uniqueName}`,
    fileType: resolvedType,
    fileSize: file.size,
    checksum: sha256(buffer),
  };
}

export function getBase64FromBuffer(buffer: Buffer): string {
  return buffer.toString("base64");
}
