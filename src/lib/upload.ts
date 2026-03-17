import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { generateId } from "./utils";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

export async function saveUploadedFile(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`File type ${file.type} not allowed`);
  }

  if (file.size > MAX_SIZE) {
    throw new Error("File too large (max 20MB)");
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
