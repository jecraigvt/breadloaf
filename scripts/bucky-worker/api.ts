import { MODELS } from "../../src/lib/ai-models";
import { completedGeminiOutput, createGeminiInteraction } from "../../src/lib/gemini-generation";
import { BACKGROUND_API_MAX_OUTPUT_TOKENS, backgroundApiUsage, backgroundApiUpperBoundCents } from "../../src/lib/bucky-api-cost";
import type { StructuredRunner } from "./codex";

/** Bounded paid code generation uses the same validated edit contract as Codex. */
export function createApiRunner(reservedCents: number, signal: AbortSignal, generate = createGeminiInteraction): StructuredRunner {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error("Paid worker Gemini API key is missing");
  const usage = { inputTokens: 0, outputTokens: 0, costCents: 0, model: MODELS.pro };
  return { usage, async run(prompt, schema, images = []) {
    if (images.length) throw new Error("Paid image jobs run through the hosted document handler");
    const bound = backgroundApiUpperBoundCents(prompt + JSON.stringify(schema));
    if (usage.costCents + bound > reservedCents) throw new Error("This coding step exceeds the reserved API budget");
    const result = await generate({ model: MODELS.pro, input: prompt, store: false,
      generation_config: { max_output_tokens: BACKGROUND_API_MAX_OUTPUT_TOKENS, thinking_level: "low" },
      response_format: { type: "text", mime_type: "application/json", schema },
    }, { signal, timeout: 90_000, retries: 0 });
    let measured: ReturnType<typeof backgroundApiUsage> | undefined;
    try { measured = backgroundApiUsage(result.usage); } catch { /* Charge the full bound below. */ }
    usage.inputTokens += measured?.inputTokens || 0;
    usage.outputTokens += measured?.outputTokens || 0;
    // Missing usage is charged at its full conservative bound.
    usage.costCents += measured?.costCents ?? bound;
    if (result.status !== "completed") throw new Error("Paid coding response did not finish within its token allowance");
    return JSON.parse(completedGeminiOutput(result));
  } };
}
