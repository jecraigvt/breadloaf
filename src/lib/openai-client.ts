import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!client) client = new OpenAI({ apiKey, maxRetries: 0 });
  return client;
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (!headers || typeof headers !== "object") return null;
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return typeof value === "string" ? value : null;
}

export function retryAfterMs(error: unknown, now = Date.now()): number | null {
  const value = headerValue((error as { headers?: unknown })?.headers, "retry-after");
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      if ((status !== 429 && status !== 503) || attempt === retries) throw error;

      const delay = retryAfterMs(error) ?? 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
