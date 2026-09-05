import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readCodexAvailability } from "../src/lib/bucky-codex-account";
import { loadConfig, saveState, setPaused, workerDirectory, workerToken, type WorkerConfig } from "./bucky-worker/config";
import { WorkerClient, WorkerHttpError, type Claim } from "./bucky-worker/client";
import { createCodexRunner, SubscriptionUnavailableError } from "./bucky-worker/codex";
import { createApiRunner } from "./bucky-worker/api";
import { runDataJob } from "./bucky-worker/data-jobs";
import { removeWorktreeRegistration, runDevelopmentJob } from "./bucky-worker/development";

const shutdown = new AbortController();
process.on("SIGINT", () => shutdown.abort());
process.on("SIGTERM", () => shutdown.abort());

async function lockWorker() {
  await mkdir(workerDirectory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(workerDirectory, "worker.lock");
  try {
    const file = await open(lockPath, "wx", 0o600);
    await file.writeFile(String(process.pid));
    return async () => { await file.close(); await rm(lockPath, { force: true }); };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Worker lock is invalid; inspect it before removing");
    try { process.kill(pid, 0); }
    catch (processError) {
      if ((processError as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("Another worker may still be running");
      await rm(lockPath);
      return lockWorker();
    }
    throw new Error("A worker is already running");
  }
}

function checkedJobDirectory(directory: string) {
  const root = path.resolve(workerDirectory, "jobs");
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith("attempt-"))
    throw new Error("Refusing cleanup outside the worker job directory");
  return resolved;
}

async function processClaim(client: WorkerClient, claim: Claim, config: WorkerConfig) {
  const jobsDirectory = path.join(workerDirectory, "jobs");
  await mkdir(jobsDirectory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(jobsDirectory, "attempt-"));
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, shutdown.signal, AbortSignal.timeout(config.maxJobMinutes * 60_000)]);
  let expires = Date.parse(claim.leaseExpiresAt);
  let renewing = false;
  let savedCheckpoint: unknown = claim.job.checkpoint || {};
  if (!Number.isFinite(expires)) throw new Error("Invalid job lease");
  const renew = async (checkpoint?: unknown) => {
    const response = await client.heartbeat(claim, checkpoint);
    if (checkpoint !== undefined) savedCheckpoint = checkpoint;
    if (response.leaseExpiresAt) expires = Date.parse(response.leaseExpiresAt);
  };
  const timer = setInterval(() => {
    if (Date.now() >= expires) abort.abort(new Error("Lease expired"));
    if (renewing || signal.aborted) return;
    renewing = true;
    void loadConfig().then((current) => {
      if (current.paused) { abort.abort(new Error("Worker paused")); return; }
      return renew();
    }).catch((error) => {
      if (error instanceof WorkerHttpError && [401, 403, 409, 410].includes(error.status)) abort.abort();
      // Network failure is tolerated only until the last confirmed lease expires.
    }).finally(() => { renewing = false; });
  }, 15_000);
  try {
    await saveState({ state: "working", pid: process.pid, jobId: claim.job.id, kind: claim.job.kind, mode: config.mode });
    const runner = config.mode === "local" ? await createCodexRunner(config, directory, signal)
      : createApiRunner(claim.reservedCents || 0, signal);
    const result = claim.job.kind === "site_improvement"
      ? await runDevelopmentJob(client, claim, runner, directory, config, signal, renew)
      : await runDataJob(client, claim, runner, directory, signal, renew);
    signal.throwIfAborted();
    await renew();
    await client.request("complete", { ...client.credentials(claim), result, usage: runner.usage }, signal);
    if (claim.job.kind === "site_improvement" && process.env.BUCKY_RESULT_PATH) {
      await writeFile(path.resolve(process.env.BUCKY_RESULT_PATH), JSON.stringify({ jobId: claim.job.id, result }, null, 2), { mode: 0o600 });
    }
    await saveState({ state: "completed", pid: process.pid, jobId: claim.job.id, mode: config.mode });
  } catch (error) {
    // The server already retained checkpoints. Never submit late results after
    // losing a lease; a retry/fallback can reuse those durable parts.
    const reason = signal.aborted ? "Worker interrupted or lease expired" : error instanceof WorkerHttpError
      ? `Worker endpoint returned ${error.status}` : "Worker could not complete this attempt";
    if (error instanceof SubscriptionUnavailableError) {
      await client.request("yield", { ...client.credentials(claim), checkpoint: savedCheckpoint,
        usage: { costCents: 0 } }).catch(() => undefined);
    } else if (!signal.aborted) await client.request("fail", { ...client.credentials(claim), error: reason, retryable: true }).catch(() => undefined);
    await saveState({ state: "waiting", pid: process.pid, reason, mode: config.mode });
    if (process.argv.includes("--once") && !signal.aborted) throw new Error(reason);
  } finally {
    clearInterval(timer);
    abort.abort();
    const safeDirectory = checkedJobDirectory(directory);
    await removeWorktreeRegistration(config.repository, safeDirectory);
    await rm(safeDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const action = process.argv.find((argument) => argument.startsWith("--")) || "--run";
  if (action === "--pause" || action === "--resume") {
    await setPaused(action === "--pause"); console.log(action === "--pause" ? "Bucky worker paused." : "Bucky worker resumed."); return;
  }
  if (action === "--status") {
    const state = await readFile(path.join(workerDirectory, "status.json"), "utf8").catch(() => '{"state":"not started"}');
    console.log(state); return;
  }
  let config = await loadConfig();
  if (action === "--doctor") {
    const availability = await readCodexAvailability(config.codexPath);
    console.log(JSON.stringify({ siteUrl: config.siteUrl, workerId: config.workerId, mode: config.mode,
      capabilities: config.capabilities, paused: config.paused, codex: availability }, null, 2));
    if (!availability.ready) process.exitCode = 1;
    return;
  }
  if (!["--run", "--once"].includes(action)) throw new Error("Use --run, --once, --doctor, --status, --pause, or --resume");
  const unlock = await lockWorker();
  try {
    // The exclusive process lock proves no previous worker owns these attempt
    // directories. Clean leftovers from hard kills before accepting new work.
    const abandoned = await readdir(path.join(workerDirectory, "jobs"), { withFileTypes: true }).catch(() => []);
    for (const entry of abandoned) {
      if (!entry.isDirectory() || !entry.name.startsWith("attempt-")) continue;
      const stale = checkedJobDirectory(path.join(workerDirectory, "jobs", entry.name));
      await removeWorktreeRegistration(config.repository, stale);
      await rm(stale, { recursive: true, force: true });
    }
    do {
      config = await loadConfig();
      const client = new WorkerClient(config, await workerToken());
      try {
        if (config.paused) await saveState({ state: "paused", pid: process.pid });
        else if (config.mode === "api") {
          // Hosted data processing has its own lease and token-budget guard.
          if (config.capabilities.some((c) => c !== "site_improvement")) {
            for (let tick = 0; tick < 8; tick++) {
              const result = await client.request<{ state: string }>("run-api", { workerId: config.workerId });
              if (!["continued", "completed"].includes(result.state)) break;
            }
          }
          if (config.capabilities.includes("site_improvement")) {
            const claim = await client.claim(null, ["site_improvement"]);
            if (claim) await processClaim(client, claim, config);
          }
        } else {
          const quota = await readCodexAvailability(config.codexPath);
          await client.heartbeat(undefined, undefined, quota.remaining);
          if (quota.ready) {
            const claim = await client.claim(quota.remaining);
            if (claim) await processClaim(client, claim, config);
            else await saveState({ state: "idle", pid: process.pid, remaining: quota.remaining });
          } else await saveState({ state: "waiting", pid: process.pid, reason: quota.reason, remaining: quota.remaining });
        }
      } catch (error) {
        await saveState({ state: "waiting", pid: process.pid, reason: error instanceof WorkerHttpError
          ? `Website connection failed (${error.status})` : "Worker unavailable; retrying later" });
        if (action === "--once") throw error;
      }
      if (action === "--once" || shutdown.signal.aborted) break;
      await delay(config.pollSeconds * 1000, undefined, { signal: shutdown.signal }).catch(() => undefined);
    } while (!shutdown.signal.aborted);
  } finally { await unlock(); }
}

void main().catch(() => { console.error("Bucky worker stopped. Check worker status/configuration and run --doctor; credentials and source content are omitted from logs."); process.exitCode = 1; });
