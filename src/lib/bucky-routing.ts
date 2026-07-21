export type AssistantModelTier = "flash" | "pro";

const HEAVY_ANALYSIS_PATTERNS = [
  /\b(deep|detailed|comprehensive|thorough)\s+(analysis|review|comparison)\b/i,
  /\b(analyze|compare|review)\b.{0,80}\b(all|multiple|several|entire|full)\b.{0,40}\b(documents?|records?|years?|options?|scenarios?)\b/i,
  /\b(across|over)\s+(all|multiple|several|the last)\s+(documents?|records?|years?)\b/i,
  /\b(strategic plan|scenario analysis|options analysis|financial model)\b/i,
];

export function selectAssistantModelTier(message: string): AssistantModelTier {
  return HEAVY_ANALYSIS_PATTERNS.some((pattern) => pattern.test(message))
    ? "pro"
    : "flash";
}
