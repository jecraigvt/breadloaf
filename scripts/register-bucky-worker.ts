import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { hashBuckyWorkerToken } from "../src/lib/bucky-worker-auth";
import { BUCKY_JOB_KINDS } from "../src/lib/bucky-job-policy";

async function main() {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1]) throw new Error("Options require a value");
    options.set(args[i].slice(2), args[i + 1]);
  }
  const id = options.get("id");
  const provider = options.get("provider") ?? "local";
  const label = options.get("name") ?? id;
  const baseUrl = options.get("base-url");
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !label || !baseUrl || !["local", "api"].includes(provider)) {
    throw new Error("Usage: tsx scripts/register-bucky-worker.ts --id jeremy-pc --name Jeremy --provider local --base-url https://breadloafhill.com [--config path]");
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Worker URLs require HTTPS outside localhost");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to the intended Breadloaf database");
  const configPath = resolve(options.get("config") ?? join(homedir(), ".breadloaf-worker", provider === "api" ? "api-config.json" : "config.json"));
  const pathFromRepo = relative(resolve(__dirname, ".."), configPath);
  if (pathFromRepo !== ".." && !pathFromRepo.startsWith(`..${sep}`) && !isAbsolute(pathFromRepo)) throw new Error("Worker credentials must be stored outside the repository");
  const tokenPath = join(dirname(configPath), provider === "api" ? "api-token" : "token");
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, "")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const token = randomBytes(32).toString("base64url");
  const capabilities = [...BUCKY_JOB_KINDS];
  const db = new PrismaClient();
  try {
    await db.buckyWorker.upsert({ where: { id }, create: {
      id, label, provider, tokenHash: hashBuckyWorkerToken(token), capabilities,
    }, update: { label, provider, tokenHash: hashBuckyWorkerToken(token), capabilities, paused: false } });
    await mkdir(dirname(configPath), { recursive: true });
    const { token: _oldToken, baseUrl: _oldUrl, provider: _oldProvider, ...preserved } = existing;
    await writeFile(tokenPath, token + "\n", { mode: 0o600 });
    await writeFile(configPath, JSON.stringify({ ...preserved, siteUrl: url.origin, workerId: id, mode: provider, capabilities }, null, 2) + "\n", { mode: 0o600 });
    console.log(`Registered ${provider} worker ${id}. Configuration saved to ${configPath}; private credential saved to ${tokenPath}. Registration rotates this worker's credential.`);
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Worker registration failed"); process.exitCode = 1; });
