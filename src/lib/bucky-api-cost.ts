// MODELS.pro pricing, verified 2026-09-05:
// https://developers.openai.com/api/docs/pricing
// Keep this schedule in sync when changing that central model. Rates are USD
// cents per million tokens; cached input is conservatively charged in full.
export const BACKGROUND_API_MAX_OUTPUT_TOKENS = 4096;
export function backgroundApiCostCents(inputTokens: number, outputTokens: number, cacheWriteTokens = 0): number {
  if (![inputTokens, outputTokens, cacheWriteTokens].every((n) => Number.isFinite(n) && n >= 0) || cacheWriteTokens > inputTokens) throw new Error("Invalid token usage");
  return Math.ceil((inputTokens * 200 + cacheWriteTokens * 50 + outputTokens * 1200) / 1_000_000);
}
export function backgroundApiUpperBoundCents(prompt: string, outputTokens = BACKGROUND_API_MAX_OUTPUT_TOKENS, imageCount = 0): number {
  // UTF-8 bytes bound text tokenization conservatively. Add per-image capacity
  // and fixed provider framing overhead rather than relying on word counts.
  const inputBound = Buffer.byteLength(prompt, "utf8") + 2048 + imageCount * 16384;
  return backgroundApiCostCents(inputBound, outputTokens, inputBound);
}
