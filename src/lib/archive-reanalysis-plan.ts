import { createHash } from "node:crypto";

export interface ReanalysisJournalEntry {
  sourceChecksum: string;
  analysisState: string;
  completedAt: string;
}

export interface ReanalysisTextDelta {
  changed: boolean;
  beforeChars: number;
  afterChars: number;
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
}

function fingerprint(value: string | null): string | null {
  return value
    ? createHash("sha256").update(value).digest("hex").slice(0, 12)
    : null;
}

export function reanalysisTextDelta(
  before: string | null,
  after: string | null
): ReanalysisTextDelta {
  return {
    changed: before !== after,
    beforeChars: before?.length || 0,
    afterChars: after?.length || 0,
    beforeFingerprint: fingerprint(before),
    afterFingerprint: fingerprint(after),
  };
}

export function categoryReanalysisAction(input: {
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  suggestedCategory: string | null;
}): {
  action: "preserve" | "resolve-if-applied";
  currentCategory: string | null;
  suggestedCategory: string | null;
} {
  return {
    action: input.currentCategoryId ? "preserve" : "resolve-if-applied",
    currentCategory: input.currentCategoryName,
    suggestedCategory: input.suggestedCategory,
  };
}

export function shouldSkipCompletedReanalysis(input: {
  entry?: ReanalysisJournalEntry;
  sourceChecksum: string;
  retryFailures: boolean;
}): boolean {
  const { entry } = input;
  if (!entry || entry.sourceChecksum !== input.sourceChecksum) return false;
  return !input.retryFailures || entry.analysisState === "ok";
}
