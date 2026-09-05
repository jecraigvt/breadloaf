import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { safeWorkerOrigin } from "../../src/lib/bucky-codex-policy";

export const workerDirectory = path.resolve(process.env.BUCKY_WORKER_HOME || path.join(homedir(), ".breadloaf-worker"));
const schema = z.object({
  siteUrl: z.string().transform(safeWorkerOrigin), workerId: z.string().min(1),
  codexPath: z.string().min(1), repository: z.string().min(1),
  capabilities: z.array(z.enum(["document_analysis", "archive_review", "site_improvement"])).default(["document_analysis", "archive_review"]),
  pollSeconds: z.number().int().min(15).max(3600).default(60),
  maxJobMinutes: z.number().int().min(1).max(120).default(45),
  paused: z.boolean().default(false), mode: z.enum(["local", "api"]).default("local"),
});
export type WorkerConfig = z.infer<typeof schema>;

export async function loadConfig(): Promise<WorkerConfig> {
  if (process.env.BUCKY_WORKER_SITE_URL) return schema.parse({
    siteUrl: process.env.BUCKY_WORKER_SITE_URL, workerId: process.env.BUCKY_WORKER_ID,
    codexPath: process.env.BUCKY_CODEX_PATH || "codex", repository: process.cwd(),
    mode: process.env.BUCKY_WORKER_MODE || "local",
    capabilities: process.env.BUCKY_WORKER_CAPABILITIES?.split(","),
  });
  return schema.parse(JSON.parse((await readFile(path.join(workerDirectory, "config.json"), "utf8")).replace(/^\uFEFF/, "")));
}

export async function workerToken(): Promise<string> {
  const token = (process.env.BUCKY_WORKER_TOKEN || await readFile(path.join(workerDirectory, "token"), "utf8")).trim();
  if (token.length < 32 || /\s/.test(token)) throw new Error("Worker credential is missing or invalid");
  return token;
}

export async function saveState(value: Record<string, unknown>): Promise<void> {
  await mkdir(workerDirectory, { recursive: true, mode: 0o700 });
  const statePath = path.join(workerDirectory, "status.json");
  await writeFile(statePath, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export async function setPaused(paused: boolean): Promise<void> {
  const configPath = path.join(workerDirectory, "config.json");
  const raw = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
  await writeFile(configPath, JSON.stringify({ ...raw, paused }, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") await chmod(configPath, 0o600);
}
