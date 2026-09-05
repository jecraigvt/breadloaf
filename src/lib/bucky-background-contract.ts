import { z } from "zod";

// Provider-neutral artifacts: the subscription runner and paid runner return
// identical data. They never receive authority to write the production database.
export const BackgroundDocumentResultSchema = z.object({
  kind: z.literal("document_analysis"),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(600000),
  extractedText: z.string().max(2200000),
  tags: z.array(z.string().max(100)).max(50),
  suggestedCategory: z.string().max(150),
  confidence: z.number().min(0).max(1),
});
export const BackgroundReviewResultSchema = z.object({
  kind: z.literal("archive_review"),
  summary: z.string().min(1).max(600000),
  findings: z.array(z.object({
    sourceId: z.string().max(200).nullable(),
    problem: z.string().min(1).max(3000),
    suggestion: z.string().min(1).max(3000),
  })).max(500),
});
export const BackgroundDevelopmentResultSchema = z.object({
  kind: z.literal("site_improvement"),
  summary: z.string().min(1).max(10000),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  patch: z.string().max(200000),
  tests: z.array(z.object({ command: z.string().max(300), passed: z.boolean() })).max(20),
  requiresReview: z.boolean(),
});
export const BackgroundResultSchema = z.discriminatedUnion("kind", [
  BackgroundDocumentResultSchema, BackgroundReviewResultSchema, BackgroundDevelopmentResultSchema,
]);
export type BackgroundResult = z.infer<typeof BackgroundResultSchema>;
export type BackgroundDocumentResult = z.infer<typeof BackgroundDocumentResultSchema>;

export interface BackgroundSourcePart {
  id: string;
  sourceId?: string;
  fileName?: string;
  mimeType: string;
  checksum?: string;
  text?: string;
  imageBase64?: string;
  fileBase64?: string;
}
export interface BackgroundSourceBundle {
  jobId: string;
  kind: BackgroundResult["kind"];
  instructions: string;
  categories: { name: string; description: string | null }[];
  parts: BackgroundSourcePart[];
  resultSchema: Record<string, unknown>;
}

export function backgroundResultJsonSchema(kind: string): Record<string, unknown> {
  const schema = kind === "document_analysis" ? BackgroundDocumentResultSchema
    : kind === "archive_review" ? BackgroundReviewResultSchema : BackgroundDevelopmentResultSchema;
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

export function splitBackgroundText(text: string, size = 12000): string[] {
  if (!text.trim()) throw new Error("The document contains no readable text.");
  if (text.length > 2000000) throw new Error("This document exceeds the background text limit of 2 million characters.");
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) parts.push(text.slice(offset, offset + size));
  return parts;
}

export function combineDocumentParts(parts: BackgroundDocumentResult[]): BackgroundDocumentResult {
  if (!parts.length) throw new Error("No completed document sections were returned.");
  const first = parts[0];
  return BackgroundDocumentResultSchema.parse({
    ...first,
    summary: parts.length === 1 ? first.summary : parts.map((part, i) => `Section ${i + 1}: ${part.summary}`).join("\n\n"),
    extractedText: parts.map((part, i) => `Section ${i + 1}\n${part.extractedText}`).join("\n\n"),
    tags: Array.from(new Set(parts.flatMap((part) => part.tags))).slice(0, 50),
    confidence: Math.min(...parts.map((part) => part.confidence)),
  });
}
