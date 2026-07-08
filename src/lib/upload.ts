import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { generateId } from "./utils";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const ALLOWED_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "text/plain",
  "text/csv",
  // Audio
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  // Video
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
];

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
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`File type ${file.type} not allowed`);
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
    fileType: file.type,
    fileSize: file.size,
  };
}

export function getBase64FromBuffer(buffer: Buffer): string {
  return buffer.toString("base64");
}
