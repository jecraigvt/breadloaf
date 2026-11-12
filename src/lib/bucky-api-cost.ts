// MODELS.pro (Gemini 4 Hydrogen) standard pricing, verified 2026-11-12:
// https://aistudio.google.com/docs/pricing#gemini-4-hydrogen
// Keep this schedule in sync when changing that central model. Rates are USD
// cents per million tokens; cached input is conservatively charged in full.
// Output includes BOTH visible output and thought tokens. Gemini's combined
// max_output_tokens cap makes the existing per-attempt reservation a hard bound.
export const BACKGROUND_API_MAX_OUTPUT_TOKENS = 4096;
export function backgroundApiCostCents(inputTokens: number, outputTokens: number): number {
  if (![inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid token usage");
  return Math.ceil((inputTokens * 150 + outputTokens * 750) / 1_000_000);
}

/** Normalize native Interactions usage without losing billable thinking. */
export function backgroundApiUsage(value: unknown): { inputTokens: number; outputTokens: number; costCents: number } {
  if (!value || typeof value !== "object") throw new Error("Missing Gemini token usage");
  const usage = value as Record<string, unknown>;
  const inputTokens = usage.total_input_tokens;
  const visibleOutput = usage.total_output_tokens;
  const thoughtTokens = usage.total_thought_tokens;
  const totalTokens = usage.total_tokens;
  const isCount = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  if (!isCount(inputTokens) || !isCount(visibleOutput)
    || (thoughtTokens !== undefined && !isCount(thoughtTokens))
    || (totalTokens !== undefined && !isCount(totalTokens))
    || (thoughtTokens === undefined && totalTokens === undefined)) throw new Error("Invalid Gemini token usage");
  const generated = visibleOutput + (isCount(thoughtTokens) ? thoughtTokens : 0);
  if (isCount(totalTokens) && totalTokens < inputTokens + generated) throw new Error("Inconsistent Gemini token usage");
  // A total can retain billable internal output even if a provider omits the
  // thought breakdown. Never undercharge an incompletely itemized response.
  const outputTokens = Math.max(generated, isCount(totalTokens) ? totalTokens - inputTokens : 0);
  return { inputTokens, outputTokens, costCents: backgroundApiCostCents(inputTokens, outputTokens) };
}
export function backgroundApiUpperBoundCents(prompt: string, outputTokens = BACKGROUND_API_MAX_OUTPUT_TOKENS, imageCount = 0): number {
  // UTF-8 bytes bound text tokenization conservatively. Add per-image capacity
  // and fixed provider framing overhead rather than relying on word counts.
  const inputBound = Buffer.byteLength(prompt, "utf8") + 2048 + imageCount * 16384;
  return backgroundApiCostCents(inputBound, outputTokens);
}
