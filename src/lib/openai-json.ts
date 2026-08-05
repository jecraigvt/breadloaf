export function parseToolArguments(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenAI returned invalid tool arguments");
  }
  return parsed as Record<string, unknown>;
}
