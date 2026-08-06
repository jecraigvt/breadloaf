import type { IntakeDocumentType } from "@/lib/document-intake";

export const VOICE_MEMO_DISPOSITIONS = ["quick_note", "archive_document"] as const;
export type VoiceMemoDisposition = (typeof VOICE_MEMO_DISPOSITIONS)[number];

export interface VoiceRoutingTriage {
  documentType: IntakeDocumentType;
  voiceMemoDisposition: VoiceMemoDisposition | null;
}

export function isQuickVoiceNote(triage: VoiceRoutingTriage): boolean {
  return triage.documentType === "voice_memo" && triage.voiceMemoDisposition === "quick_note";
}

export function quickVoiceNoteTopic(transcript: string): string {
  const oneLine = transcript.replace(/\s+/g, " ").trim();
  const firstThought = oneLine.split(/(?<=[.!?])\s/, 1)[0] || "Voice note";
  if (firstThought.length <= 120) return firstThought.replace(/[.!?]+$/, "") || "Voice note";
  return `${firstThought.slice(0, 117).trimEnd()}...`;
}

export interface VoiceMemoryRecord {
  id: string;
  topic: string;
  filePath: string | null;
}

export interface VoiceMemoryData {
  type: "semantic";
  topic: string;
  content: string;
  source: string;
  sourceType: "voice_note";
  sourceId: string;
  filePath: string;
  scope: "property";
  confidence: number;
  importance: number;
  accessScope: "family";
}

interface VoiceNoteDependencies {
  findExisting: (sourceId: string) => Promise<VoiceMemoryRecord | null>;
  createMemory: (data: VoiceMemoryData) => Promise<VoiceMemoryRecord>;
  attachFile: (id: string, filePath: string) => Promise<VoiceMemoryRecord>;
  indexMemory: (id: string) => Promise<unknown>;
}

export async function captureQuickVoiceNote(
  dependencies: VoiceNoteDependencies,
  input: {
    transcript: string;
    checksum: string;
    actorName: string | null;
    filePath: string;
  }
): Promise<VoiceMemoryRecord & { created: boolean }> {
  const existing = await dependencies.findExisting(input.checksum);
  if (existing) {
    const linked = existing.filePath
      ? existing
      : await dependencies.attachFile(existing.id, input.filePath);
    await dependencies.indexMemory(linked.id);
    return { ...linked, created: false };
  }

  const memory = await dependencies.createMemory({
    type: "semantic",
    topic: quickVoiceNoteTopic(input.transcript),
    content: input.transcript.trim(),
    source: input.actorName
      ? `Voice note from ${input.actorName}`
      : "Voice note from an unidentified family member",
    sourceType: "voice_note",
    sourceId: input.checksum,
    filePath: input.filePath,
    scope: "property",
    confidence: 1,
    importance: 0.6,
    accessScope: "family",
  });
  await dependencies.indexMemory(memory.id);
  return { ...memory, created: true };
}
