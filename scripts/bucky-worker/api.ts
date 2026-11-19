import OpenAI from "openai";
import { MODELS } from "../../src/lib/ai-models";
import { BACKGROUND_API_MAX_OUTPUT_TOKENS, backgroundApiCostCents, backgroundApiUpperBoundCents } from "../../src/lib/bucky-api-cost";
import type { StructuredRunner } from "./codex";

/** Bounded paid code generation uses the same validated edit contract as Codex. */
export function createApiRunner(reservedCents: number, signal: AbortSignal): StructuredRunner {
  if (!process.env.OPENAI_API_KEY) throw new Error("Paid worker API key is missing");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const usage = { inputTokens: 0, outputTokens: 0, costCents: 0, model: MODELS.pro };
  return { usage, async run(prompt, schema, images = []) {
    if (images.length) throw new Error("Paid image jobs run through the hosted document handler");
    const bound = backgroundApiUpperBoundCents(prompt + JSON.stringify(schema));
    if (usage.costCents + bound > reservedCents) throw new Error("This coding step exceeds the reserved API budget");
    const result = await client.responses.create({ model: MODELS.pro, input: prompt, store: false,
      service_tier: "default", prompt_cache_options: { mode: "explicit" },
      max_output_tokens: BACKGROUND_API_MAX_OUTPUT_TOKENS,
      text: { format: { type: "json_schema", name: "bucky_worker_output", schema, strict: true } },
    }, { signal });
    usage.inputTokens += result.usage?.input_tokens || 0;
    usage.outputTokens += result.usage?.output_tokens || 0;
    // Missing usage is charged at its full conservative bound.
    usage.costCents += result.usage ? backgroundApiCostCents(result.usage.input_tokens, result.usage.output_tokens, result.usage.input_tokens_details.cache_write_tokens ?? 0) : bound;
    if (result.status !== "completed") throw new Error("Paid coding response did not finish within its token allowance");
    return JSON.parse(result.output_text);
  } };
}
