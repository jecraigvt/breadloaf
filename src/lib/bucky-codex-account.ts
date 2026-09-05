import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { canUseSubscription, codexEnvironment, quotaRemainingPercent } from "./bucky-codex-policy";

export interface CodexAvailability {
  ready: boolean;
  remaining: number | null;
  reason: "ready" | "reserve" | "sign-in-required" | "quota-unavailable";
}

/** Read-only app-server adapter. Never calls login, token export, reset, or purchase APIs. */
export async function readCodexAvailability(executable: string, timeoutMs = 20_000): Promise<CodexAvailability> {
  const unavailable: CodexAvailability = { ready: false, remaining: null, reason: "quota-unavailable" };
  const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: codexEnvironment(),
  });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let id = 0;
  const stop = () => {
    for (const item of Array.from(pending.values())) item.reject(new Error("Codex account reader closed"));
    pending.clear();
  };
  child.on("error", stop);
  child.on("close", stop);
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    // Do not print account responses: they contain identity data.
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error("Codex account request failed"));
      else request.resolve(message.result);
    } catch { /* Ignore non-protocol startup messages. */ }
  });
  const request = (method: string, params: unknown = {}) => new Promise<unknown>((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id: next, method, params })}\n`, (error) => {
      if (error) { pending.delete(next); reject(error); }
    });
  });
  const timeout = setTimeout(() => { stop(); child.kill(); }, timeoutMs);
  try {
    await request("initialize", { clientInfo: { name: "breadloaf_worker", title: "Breadloaf worker", version: "1.0.0" } });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    const auth = await request("account/read", { refreshToken: false }) as { account?: { type?: string } };
    if (auth?.account?.type !== "chatgpt") return { ...unavailable, reason: "sign-in-required" };
    const remaining = quotaRemainingPercent(await request("account/rateLimits/read"));
    const ready = canUseSubscription(auth, remaining);
    return { ready, remaining, reason: ready ? "ready" : remaining === null ? "quota-unavailable" : "reserve" };
  } catch { return unavailable; }
  finally { clearTimeout(timeout); lines.close(); child.kill(); stop(); }
}
