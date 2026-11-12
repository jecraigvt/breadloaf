import { GoogleGenAI, type Interactions } from "@google/genai";
import * as z from "zod";
import { withRetry } from "@/lib/openai-client";

export type GeminiInteractionParams = Interactions.CreateModelInteractionParamsNonStreaming & { stream?: false };
export type GeminiInput = GeminiInteractionParams["input"];
export type GeminiInteraction = Extract<Awaited<ReturnType<GoogleGenAI["interactions"]["get"]>>, { status: string }>;
export type GeminiThinkingLevel = "low" | "medium" | "high" | "xhigh";

export interface GeminiRequestOptions {
  timeout?: number;
  signal?: AbortSignal;
  /** Application retries; zero by default so metered background calls stay bounded. */
  retries?: number;
}

interface GeminiGenerationOptions {
  model: GeminiInteractionParams["model"];
  instructions?: string;
  input: GeminiInput;
  maxOutputTokens?: number;
  thinkingLevel?: GeminiThinkingLevel;
}

let client: GoogleGenAI | null = null;
const MAX_GEMINI_RETRY_DELAY_MS = 15_000;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");
  const baseUrl = loopbackTestBaseUrl(process.env.GOOGLE_AI_BASE_URL);
  if (!client) client = new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
  return client;
}

function loopbackTestBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("GOOGLE_AI_BASE_URL must be a loopback HTTP origin for local verification");
  }
  return url.origin;
}

/** Native Interactions requests, with one explicit retry policy and no server storage. */
export async function createGeminiInteraction(
  params: GeminiInteractionParams,
  options: GeminiRequestOptions = {}
): Promise<GeminiInteraction> {
  return withRetry(() => {
    options.signal?.throwIfAborted();
    return getGeminiClient().interactions.create(
      { ...params, store: false, stream: false },
      {
        timeout: options.timeout ?? 90_000,
        // The SDK otherwise has its own retry policy, invisible to cost reservations.
        retries: { strategy: "none" },
        ...(options.signal ? { signal: options.signal } : {}),
      }
    );
  }, options.retries ?? 0, { maxRetryDelayMs: MAX_GEMINI_RETRY_DELAY_MS });
}

function generationParams(options: GeminiGenerationOptions): GeminiInteractionParams {
  return {
    model: options.model,
    input: options.input,
    ...(options.instructions === undefined ? {} : { system_instruction: options.instructions }),
    generation_config: {
      thinking_level: options.thinkingLevel ?? "low",
      ...(options.maxOutputTokens === undefined ? {} : { max_output_tokens: options.maxOutputTokens }),
    },
  };
}

export function completedGeminiOutput(interaction: GeminiInteraction): string {
  if (interaction.status !== "completed" || interaction.errors?.length ||
      interaction.steps.some((step) => step.type === "model_output" && step.error)) {
    throw new Error(`Gemini generation did not complete successfully (${interaction.status})`);
  }
  const text = interaction.output_text?.trim();
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

export async function generateGeminiStructured<T extends z.ZodType>(
  options: GeminiGenerationOptions & { schema: T }
): Promise<z.infer<T>> {
  const interaction = await createGeminiInteraction({
    ...generationParams(options),
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: z.toJSONSchema(options.schema),
    },
  }, { retries: 2 });
  return options.schema.parse(JSON.parse(completedGeminiOutput(interaction)));
}

export async function generateGeminiText(options: GeminiGenerationOptions): Promise<string> {
  const interaction = await createGeminiInteraction(generationParams(options), { retries: 2 });
  return completedGeminiOutput(interaction);
}
