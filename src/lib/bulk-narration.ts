import { z } from "zod";

export const BULK_NARRATION_MAX_BYTES = 15 * 1024 * 1024;
export const BULK_NARRATION_MAX_ITEMS = 100;

export const NarratedMemoryItemSchema = z.object({
  type: z.enum(["semantic", "episodic", "procedural"]),
  topic: z.string().trim().min(1).max(120),
  subject: z.string().trim().max(160).nullable(),
  location: z.string().trim().max(240).nullable(),
  scope: z.enum(["property", "family", "entity"]),
  content: z.string().trim().min(1).max(8000),
});

export const NarratedMemoryItemsSchema = z.object({
  items: z.array(NarratedMemoryItemSchema).min(1).max(BULK_NARRATION_MAX_ITEMS),
});

export const EditableNarratedMemoryItemSchema = NarratedMemoryItemSchema.extend({
  clientId: z.string().trim().min(1).max(100),
});

export const BulkNarrationCommitSchema = z.object({
  captureId: z.string().trim().min(8).max(100),
  items: z.array(EditableNarratedMemoryItemSchema).min(1).max(BULK_NARRATION_MAX_ITEMS),
});

export type NarratedMemoryItem = z.infer<typeof NarratedMemoryItemSchema>;
export type EditableNarratedMemoryItem = z.infer<typeof EditableNarratedMemoryItemSchema>;
export type BulkNarrationCommit = z.infer<typeof BulkNarrationCommitSchema>;

export function makeEditableNarratedMemoryItems(
  items: NarratedMemoryItem[]
): EditableNarratedMemoryItem[] {
  return items.map((item, index) => ({
    ...item,
    clientId: `item-${index + 1}`,
  }));
}

export function narrationSourceId(captureId: string, clientId: string): string {
  return `${captureId}:${clientId}`;
}
