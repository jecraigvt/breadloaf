import { execFile } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { BackgroundDevelopmentResultSchema } from "../src/lib/bucky-background-contract";
import { publishingDecision } from "../src/lib/bucky-publish-policy";
import { safeWorkerOrigin } from "../src/lib/bucky-codex-policy";

const execute = promisify(execFile);
const artifactPath = path.resolve(process.env.BUCKY_RESULT_PATH || "bucky-result.json");
async function command(args: string[]) { return (await execute("git", ["-c", "core.hooksPath=", ...args], { maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim(); }
async function worker(route: string, body?: unknown) {
  const origin = safeWorkerOrigin(process.env.BUCKY_WORKER_SITE_URL || "");
  const response = await fetch(`${origin}/api/bucky/worker/${route}`, {
    method: body ? "POST" : "GET", redirect: "error", headers: { Authorization: `Bearer ${process.env.BUCKY_WORKER_TOKEN || ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Artifact endpoint returned ${response.status}`);
  return response.json();
}
async function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
async function artifact() {
  const raw = JSON.parse(await readFile(artifactPath, "utf8"));
  if (typeof raw.jobId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.jobId)) throw new Error("Invalid artifact job id");
  return { jobId: raw.jobId as string, result: BackgroundDevelopmentResultSchema.parse(raw.result) };
}
async function github(route: string, body?: unknown, method = body ? "POST" : "GET") {
  const repository = process.env.GITHUB_REPOSITORY || "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid workflow repository");
  const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, { method,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN || ""}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub operation returned ${response.status}`);
  return response.json();
}
async function mergedProposal(jobId: string): Promise<{ html_url: string } | undefined> {
  if (!process.env.GH_TOKEN || !process.env.GITHUB_REPOSITORY) return undefined;
  const repository = process.env.GITHUB_REPOSITORY;
  const head = `${repository.split("/")[0]}:bucky/job-${jobId}`;
  const proposals = await github(`pulls?state=closed&head=${encodeURIComponent(head)}`) as { merged_at?: string | null; html_url: string }[];
  return proposals.find((proposal) => proposal.merged_at);
}
async function main() {
  const action = process.argv[2];
  if (action === "fetch") {
    const jobId = process.env.BUCKY_JOB_ID;
    const data = await worker(`artifact${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ""}`);
    if (!data) { await output("found", "false"); return; }
    await writeFile(artifactPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    const parsed = await artifact();
    let blocked = "";
    try {
      if (!publishingDecision(parsed.result.patch).paths.length) blocked = "No code changes were proposed; review the worker's findings.";
      else if (await command(["rev-parse", "HEAD"]) !== parsed.result.baseCommit)
        blocked = "The site changed since this proposal was prepared. Requeue it against the current main commit.";
    } catch { blocked = "The proposed patch touches protected paths or has unsupported patch metadata."; }
    if (blocked) {
      // A merge can succeed even if reporting back to Railway was interrupted.
      // Reconcile that deterministic PR before treating the older base as stale.
      const merged = await mergedProposal(parsed.jobId);
      if (merged) {
        await worker("artifact", { jobId: parsed.jobId, baseCommit: parsed.result.baseCommit, proposalUrl: merged.html_url, publishStatus: "published" });
        await output("found", "false");
        return;
      }
      await worker("artifact", { jobId: parsed.jobId, baseCommit: parsed.result.baseCommit, publishStatus: "blocked", reason: blocked });
      await output("found", "false");
      return;
    }
    await output("found", "true");
    return;
  }
  const data = await artifact();
  if (action === "record-failure") {
    const merged = await mergedProposal(data.jobId);
    if (merged) {
      await worker("artifact", { jobId: data.jobId, baseCommit: data.result.baseCommit, proposalUrl: merged.html_url, publishStatus: "published" });
      return;
    }
    await worker("artifact", { jobId: data.jobId, baseCommit: data.result.baseCommit, publishStatus: "blocked",
      reason: "Independent verification or publication did not complete. Inspect the GitHub Actions run before requeueing this proposal." });
    return;
  }
  const decision = publishingDecision(data.result.patch);
  if (!decision.paths.length) throw new Error("No patch to verify or publish");
  if (await command(["rev-parse", "HEAD"]) !== data.result.baseCommit)
    throw new Error("The site changed since this proposal was prepared; requeue it against the current main commit");
  const patchFile = path.resolve(process.env.RUNNER_TEMP || process.cwd(), `bucky-${data.jobId}.patch`);
  await writeFile(patchFile, data.result.patch);
  await command(["apply", "--check", "--", patchFile]);
  if (action === "prepare") {
    await command(["apply", "--", patchFile]);
    await output("automatic", String(decision.automatic));
    await output("job_id", data.jobId);
    return;
  }
  if (action !== "publish") throw new Error("Use fetch, prepare, or publish");
  // This command runs only after an independent check job succeeds. Recompute
  // the policy here instead of trusting any model-supplied review/test flags.
  const branch = `bucky/job-${data.jobId}`;
  await command(["checkout", "-b", branch]);
  await command(["apply", "--", patchFile]);
  await command(["add", "--", ...decision.paths]);
  const commitDate = await command(["show", "-s", "--format=%cI", data.result.baseCommit]);
  await execute("git", ["-c", "core.hooksPath=", "-c", "user.name=Bucky", "-c", "user.email=bucky@users.noreply.github.com", "commit", "-m", `Bucky: improve website (${data.jobId})`], {
    env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, windowsHide: true,
  });
  // Idempotent retries reuse a deterministic branch; never force push a branch.
  const repository = process.env.GITHUB_REPOSITORY!;
  const existing = await github(`pulls?state=all&head=${encodeURIComponent(`${repository.split("/")[0]}:${branch}`)}`) as { number: number; html_url: string; merged_at?: string | null; state: string; head?: { sha: string } }[];
  let proposal = existing.find((pr) => pr.state === "open") || existing.find((pr) => pr.merged_at);
  if (!proposal) {
    await command(["push", "origin", `${branch}:${branch}`]);
    proposal = await github("pulls", { title: "Bucky: website improvement", head: branch, base: "main",
      body: `${data.result.summary}\n\nValidation: independent unit tests, TypeScript, production build, and mobile/desktop browser smoke checks.\n\nPublishing policy: ${decision.reason}.\n\nBackground job: ${data.jobId}.`,
    });
  }
  if (!proposal) throw new Error("GitHub did not return a proposal");
  const commit = await command(["rev-parse", "HEAD"]);
  if (proposal.head?.sha && proposal.head.sha !== commit) throw new Error("The proposal branch was edited after generation; maintainer review is required");
  let publishStatus = proposal.merged_at ? "published" : "review";
  if (decision.automatic && process.env.BUCKY_AUTO_PUBLISH === "true" && !proposal.merged_at) {
    const merged = await github(`pulls/${proposal.number}/merge`, { merge_method: "squash", sha: commit }, "PUT");
    if (!merged.merged) throw new Error("GitHub did not merge the verified presentation fix");
    publishStatus = "published";
  }
  await worker("artifact", { jobId: data.jobId, baseCommit: data.result.baseCommit, proposalUrl: proposal.html_url, publishStatus });
  console.log(`${publishStatus === "published" ? "Published" : "Prepared for review"}: ${proposal.html_url}`);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "Publishing step failed"); process.exitCode = 1; });
