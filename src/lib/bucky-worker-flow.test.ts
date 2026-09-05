import { test } from "node:test";
import assert from "node:assert/strict";
import { runDataJob } from "../../scripts/bucky-worker/data-jobs";
import type { Claim, SourceBundle, WorkerClient } from "../../scripts/bucky-worker/client";
import type { StructuredRunner } from "../../scripts/bucky-worker/codex";
import { backgroundResultJsonSchema } from "./bucky-background-contract";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { removeWorktreeRegistration, runDevelopmentJob } from "../../scripts/bucky-worker/development";
import type { WorkerConfig } from "../../scripts/bucky-worker/config";

const analysis = { kind: "document_analysis" as const, title: "Pump maintenance", summary: "Pump serviced.",
  extractedText: "", tags: ["pump"], suggestedCategory: "Maintenance", confidence: 0.9 };

test("document workers reuse central checkpoints and preserve original source text", async () => {
  const first = { ...analysis, extractedText: "Original first page." };
  const claim = { job: { id: "job", kind: "document_analysis", request: {}, checkpoint: { parts: { "doc:text:0": first } } } } as unknown as Claim;
  const metadata: SourceBundle = { jobId: "job", kind: "document_analysis", instructions: "Analyze source", categories: [],
    resultSchema: backgroundResultJsonSchema("document_analysis"), parts: [
      { id: "doc:text:0", sourceId: "doc", fileName: "record.txt", mimeType: "text/plain" },
      { id: "doc:text:1", sourceId: "doc", fileName: "record.txt", mimeType: "text/plain" },
    ] };
  const sourceRequests: (string | undefined)[] = [];
  const client = { source: async (_claim: Claim, id?: string) => {
    sourceRequests.push(id);
    return id ? { ...metadata, parts: [{ ...metadata.parts[1], text: "Second page: original spelling  1892." }] } : metadata;
  } } as unknown as WorkerClient;
  let turns = 0;
  const runner: StructuredRunner = { usage: { costCents: 0, inputTokens: 0, outputTokens: 0 },
    async run() { turns++; return { ...analysis, extractedText: "Invented rewrite that must not replace original" }; } };
  const checkpoints: unknown[] = [];
  const result = await runDataJob(client, claim, runner, ".", new AbortController().signal, async (state) => { checkpoints.push(state); });
  assert.equal(turns, 1);
  assert.deepEqual(sourceRequests, [undefined, "doc:text:1"]);
  assert.equal(result.kind, "document_analysis");
  if (result.kind !== "document_analysis") throw new Error("Wrong result");
  assert.match(result.extractedText, /Original first page/);
  assert.match(result.extractedText, /Second page: original spelling  1892\./);
  assert.doesNotMatch(result.extractedText, /Invented rewrite/);
  assert.equal(checkpoints.length, 1);
});

test("aborted worker does not start another model turn or overwrite checkpoints", async () => {
  const abort = new AbortController(); abort.abort();
  const metadata = { parts: [{ id: "part" }] };
  const client = { source: async () => metadata } as unknown as WorkerClient;
  let turns = 0;
  const runner = { run: async () => { turns++; return analysis; } } as unknown as StructuredRunner;
  const claim = { job: { kind: "document_analysis", checkpoint: null } } as unknown as Claim;
  await assert.rejects(runDataJob(client, claim, runner, ".", abort.signal, async () => { throw new Error("Unexpected checkpoint"); }));
  assert.equal(turns, 0);
});

test("development proposals leave the user's checkout untouched and produce a verifiable patch", async () => {
  const execute = promisify(execFile);
  const directory = await mkdtemp(path.join(tmpdir(), "bucky-development-test-"));
  const repository = path.join(directory, "repo");
  const attempt = path.join(directory, "attempt");
  const git = async (args: string[]) => (await execute("git", args, { windowsHide: true })).stdout;
  try {
    await git(["init", "-b", "main", repository]);
    await mkdir(path.join(repository, "src", "app"), { recursive: true });
    await mkdir(attempt);
    await writeFile(path.join(repository, "src", "app", "globals.css"), ".tile { color: blue; }\n");
    await git(["-C", repository, "add", "."]);
    await git(["-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=", "commit", "-m", "fixture"]);
    await git(["-C", repository, "remote", "add", "origin", repository]);
    const before = await git(["-C", repository, "rev-parse", "HEAD"]);
    const claim = { job: { id: "job", kind: "site_improvement", request: {} } } as unknown as Claim;
    const client = { source: async () => ({ instructions: "Make tile text red" }) } as unknown as WorkerClient;
    let turns = 0;
    const runner = { run: async () => ++turns === 1 ? { paths: ["src/app/globals.css"] }
      : { summary: "Make tile text red", changes: [{ path: "src/app/globals.css", before: "color: blue;", after: "color: red;" }] } } as unknown as StructuredRunner;
    const checkpoints: unknown[] = [];
    const result = await runDevelopmentJob(client, claim, runner, attempt, { repository } as WorkerConfig,
      new AbortController().signal, async (value) => { checkpoints.push(value); });
    assert.equal(await readFile(path.join(repository, "src", "app", "globals.css"), "utf8"), ".tile { color: blue; }\n");
    assert.equal(await git(["-C", repository, "rev-parse", "HEAD"]), before);
    assert.match(result.patch, /\+\.tile \{ color: red; \}/);
    assert.equal(result.requiresReview, false);
    assert.equal(result.tests[0].passed, true);
    assert.equal(checkpoints.length, 2);
  } finally {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("bucky-development-test-")) throw new Error("Unexpected test cleanup path");
    await removeWorktreeRegistration(repository, attempt);
    await rm(directory, { recursive: true, force: true });
  }
});
