/** Pure worker policy: no server imports or credentials belong in this module. */
export const CODEX_RESERVE_PERCENT = 25;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Unknown or malformed quota is deliberately different from zero usage. */
export function quotaRemainingPercent(payload: unknown): number | null {
  const response = object(payload);
  if (!response) return null;
  const byId = object(response.rateLimitsByLimitId);
  const buckets = byId && Object.keys(byId).length ? Object.values(byId) : [response.rateLimits];
  const windows: number[] = [];
  for (const raw of buckets) {
    const bucket = object(raw);
    if (!bucket) return null;
    if (bucket.rateLimitReachedType) return 0;
    let known = false;
    for (const key of ["primary", "secondary"]) {
      if (bucket[key] === null || bucket[key] === undefined) continue;
      const window = object(bucket[key]);
      if (!window || typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent)
        || window.usedPercent < 0 || window.usedPercent > 100) return null;
      windows.push(100 - window.usedPercent);
      known = true;
    }
    if (!known) return null;
  }
  return windows.length ? Math.min(...windows) : null;
}

export function canUseSubscription(auth: unknown, remaining: number | null): boolean {
  return object(object(auth)?.account)?.type === "chatgpt"
    && remaining !== null && Number.isFinite(remaining)
    && remaining > CODEX_RESERVE_PERCENT && remaining <= 100;
}

/** Give Codex only its runtime environment, never the website/worker secrets. */
export function codexEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string> & { NODE_ENV: "production" } {
  const allowed = new Set([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "LANG", "LC_ALL", "CODEX_HOME",
  ]);
  return { ...Object.fromEntries(Object.entries(env).filter(
    (entry): entry is [string, string] => allowed.has(entry[0].toUpperCase()) && typeof entry[1] === "string",
  )), NODE_ENV: "production" };
}

export function safeWorkerOrigin(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Worker site must be an origin without credentials, paths, or query parameters");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("Worker site requires HTTPS (except localhost development)");
  return url.origin;
}
