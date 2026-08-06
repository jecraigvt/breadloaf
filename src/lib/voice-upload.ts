import type {
  FiledDocument,
  FileDocumentBufferOptions,
} from "@/lib/file-document";
import { sha256 } from "@/lib/archive-integrity";
import type {
  StoredFile,
  StoreFileBufferOptions,
} from "@/lib/file-storage";
import {
  isQuickVoiceNote,
  type VoiceMemoryRecord,
  type VoiceRoutingTriage,
} from "@/lib/voice-note";

export interface VoiceUploadInput {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  actorName: string | null;
}

interface VoiceUploadDependencies {
  findRetainedFile: (checksum: string) => Promise<string | null>;
  storeFile: (options: StoreFileBufferOptions) => Promise<StoredFile>;
  transcribe: (buffer: Buffer, contentType: string, fileName: string) => Promise<string>;
  triage: (transcript: string, fileName: string) => Promise<VoiceRoutingTriage>;
  captureQuickNote: (input: {
    transcript: string;
    checksum: string;
    actorName: string | null;
    filePath: string;
  }) => Promise<VoiceMemoryRecord & { created: boolean }>;
  fileDocument: (options: FileDocumentBufferOptions) => Promise<FiledDocument>;
}

export type ProcessedVoiceUpload =
  | {
      route: "quick_note";
      transcript: string;
      storedFile: StoredFile;
      memory: VoiceMemoryRecord & { created: boolean };
    }
  | {
      route: "document";
      transcript: string;
      storedFile: StoredFile;
      document: FiledDocument;
    };

/** Retain first; transcription and routing are allowed to fail only afterward. */
export async function processVoiceUpload(
  dependencies: VoiceUploadDependencies,
  input: VoiceUploadInput
): Promise<ProcessedVoiceUpload> {
  const checksum = sha256(input.buffer);
  const existingFilePath = await dependencies.findRetainedFile(checksum);
  const storedFile = await dependencies.storeFile({
    buffer: input.buffer,
    fileName: input.fileName,
    contentType: input.contentType,
    existingFilePath,
  });
  const transcript = await dependencies.transcribe(
    input.buffer,
    storedFile.fileType,
    input.fileName
  );
  const triage = await dependencies.triage(transcript, input.fileName);

  if (isQuickVoiceNote(triage)) {
    const memory = await dependencies.captureQuickNote({
      transcript,
      checksum: storedFile.checksum,
      actorName: input.actorName,
      filePath: storedFile.filePath,
    });
    return { route: "quick_note", transcript, storedFile, memory };
  }

  const document = await dependencies.fileDocument({
    buffer: input.buffer,
    fileName: input.fileName,
    contentType: storedFile.fileType,
    uploadedBy: input.actorName || undefined,
    storedFile,
  });
  return { route: "document", transcript, storedFile, document };
}
