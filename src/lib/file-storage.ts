import { access, mkdir, writeFile } from "fs/promises";
import path from "path";
import { sha256 } from "@/lib/archive-integrity";
import { resolveSupportedFileType } from "@/lib/document-file-types";

export const STORED_FILE_SIZE_LIMIT = 100 * 1024 * 1024;

export interface StoredFile {
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  checksum: string;
  alreadyExisted: boolean;
}

export interface StoreFileBufferOptions {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  /** A checksum-matched path already referenced by a Document or memory. */
  existingFilePath?: string | null;
  /** Test seam; production always uses the mounted public/uploads volume. */
  uploadRoot?: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function safeExtension(fileName: string, fileType: string): string {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,12}$/.test(extension)) return extension;
  return MIME_EXTENSIONS[fileType] ?? "bin";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Retain bytes on the uploads volume without creating any archive record.
 *
 * The checksum-derived name makes exact retries a filesystem short-circuit even
 * if an AI/provider failure happened before a database row could reference the
 * first attempt. The write therefore always finishes before any caller starts AI.
 */
export async function storeFileBuffer(
  options: StoreFileBufferOptions
): Promise<StoredFile> {
  const fileType = resolveSupportedFileType(options.contentType, options.fileName);
  if (!fileType) {
    throw new Error(
      `File type ${options.contentType || "unknown"} is not supported because Breadloaf cannot read it`
    );
  }
  if (options.buffer.length > STORED_FILE_SIZE_LIMIT) {
    throw new Error(
      `File too large (${Math.round(options.buffer.length / 1024 / 1024)}MB, max 100MB)`
    );
  }

  const checksum = sha256(options.buffer);
  const uploadRoot = options.uploadRoot ?? path.join(process.cwd(), "public", "uploads");
  const storedName = `${checksum}.${safeExtension(options.fileName, fileType)}`;
  const stored: Omit<StoredFile, "alreadyExisted"> = {
    fileName: options.fileName,
    filePath: options.existingFilePath || `/uploads/${storedName}`,
    fileType,
    fileSize: options.buffer.length,
    checksum,
  };

  if (options.existingFilePath) return { ...stored, alreadyExisted: true };

  const absolutePath = path.join(uploadRoot, storedName);
  await mkdir(uploadRoot, { recursive: true });
  if (await fileExists(absolutePath)) return { ...stored, alreadyExisted: true };

  try {
    await writeFile(absolutePath, options.buffer, { flag: "wx" });
    return { ...stored, alreadyExisted: false };
  } catch (error) {
    // Two identical requests may race between access and write. The winner kept
    // the same checksum-addressed bytes, so the loser safely reuses that path.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { ...stored, alreadyExisted: true };
    }
    throw error;
  }
}
