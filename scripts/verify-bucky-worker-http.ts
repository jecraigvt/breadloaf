/** Real production-build HTTP smoke, confined to an explicitly supplied local test DB. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { codexEnvironment } from "../src/lib/bucky-codex-policy";

async function main() {
  const databaseUrl = process.env.BUCKY_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("Set BUCKY_TEST_DATABASE_URL to a disposable local Postgres database");
  const database = new URL(databaseUrl);
  if (!['postgresql:', 'postgres:'].includes(database.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
    || !/test/i.test(database.pathname)) throw new Error("HTTP smoke only runs against a loopback database whose name contains test");
  const port = Number(process.env.BUCKY_SMOKE_PORT || 3033);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid smoke port");
  const freePort = createNetServer();
  await new Promise<void>((resolve, reject) => { freePort.once("error", reject); freePort.listen(port, "127.0.0.1", resolve); });
  await new Promise<void>((resolve) => freePort.close(() => resolve()));
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const marker = `http-smoke-${randomUUID()}`;
  const token = randomBytes(32).toString("base64url");
  const month = new Date().toISOString().slice(0, 7);
  const jobIds: string[] = [];
  const docIds: string[] = [];
  let categoryId: string | undefined;
  let originalPath: string | undefined;
  let child: ChildProcess | undefined;
  let childLogs = "";
  let requests = 0;
  let imageSeen = false;
  let embeddings = 0;
  const result = { kind: "document_analysis", title: `Pump service ${marker}`,
    summary: "The original receipt records pump service at the property.", extractedText: `Pump service original ${marker}`,
    tags: ["pump", "service"], suggestedCategory: marker, confidence: 0.99 };
  const provider = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/v1/responses") {
        requests++;
        assert.equal(body.store, false);
        imageSeen = body.input.some((message: { content: { type: string; image_url?: string }[] }) => message.content.some((part) => part.type === "input_image" && part.image_url?.startsWith("data:image/png;base64,")));
        response.end(JSON.stringify({ id: `resp_${marker}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed",
          model: body.model, output: [{ id: `msg_${marker}`, type: "message", role: "assistant", status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(result), annotations: [] }] }],
          usage: { input_tokens: 1200, output_tokens: 120, total_tokens: 1320,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
        }));
      } else if (request.url === "/v1/embeddings") {
        embeddings++;
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        response.end(JSON.stringify({ object: "list", model: body.model,
          data: inputs.map((_: unknown, index: number) => ({ object: "embedding", index, embedding: Array(1536).fill(0) })),
          usage: { prompt_tokens: 10, total_tokens: 10 } }));
      } else { response.statusCode = 404; response.end(JSON.stringify({ error: "Unexpected mock endpoint" })); }
    } catch { response.statusCode = 500; response.end(JSON.stringify({ error: "Mock request validation failed" })); }
  });
  try {
    assert.equal(await db.buckyJob.count({ where: { status: { in: ["queued", "running"] } } }), 0,
      "Run the HTTP smoke after other queue fixtures have finished");
    await db.buckyWorker.create({ data: { id: marker, label: marker, provider: "api", tokenHash: createHash("sha256").update(token).digest("hex"), capabilities: ["document_analysis"] } });
    categoryId = (await db.category.create({ data: { name: marker, slug: marker } })).id;
    const budgetBefore = (await db.buckyApiBudget.findUnique({ where: { month } }))?.spentCents || 0;
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const providerAddress = provider.address();
    if (!providerAddress || typeof providerAddress === "string") throw new Error("Mock server did not start");
    const environment: NodeJS.ProcessEnv = { ...codexEnvironment(), NODE_ENV: "production" };
    // Next loads local .env files even for next start. Blank every declared key
    // before supplying test values, so no saved production connector can run.
    const envFiles = (await readdir(process.cwd())).filter((name) => /^\.env(?:\.|$)/.test(name));
    for (const file of envFiles) {
      for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
        const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
        if (key) environment[key] = "";
      }
    }
    Object.assign(environment, {
      NODE_ENV: "production", DATABASE_URL: databaseUrl, FAMILY_PINS: "Test:2468", AUTH_SECRET: `${marker}-auth`,
      OPENAI_API_KEY: "mock-key-no-real-provider", OPENAI_BASE_URL: `http://127.0.0.1:${providerAddress.port}/v1`,
      GOOGLE_SERVICE_ACCOUNT_KEY: "", GOOGLE_CALENDAR_ID: "", GOOGLE_AI_API_KEY: "", GMAIL_APP_PASSWORD: "",
      BUCKY_BACKGROUND_API_BUDGET_CENTS: "100000", BUCKY_API_MAX_ATTEMPT_CENTS: "50", NEXT_TELEMETRY_DISABLED: "1",
    });
    child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { childLogs = (childLogs + String(chunk)).slice(-12000); });
    child.stderr?.on("data", (chunk) => { childLogs = (childLogs + String(chunk)).slice(-12000); });
    const base = `http://127.0.0.1:${port}`;
    let started = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Built Next server exited before becoming ready");
      try { if ((await fetch(`${base}/login`)).status === 200) { started = true; break; } } catch { /* Startup. */ }
      await delay(500);
    }
    assert.ok(started, "Built server is ready");
    assert.equal((await fetch(`${base}/api/bucky/worker/run-api`, { method: "POST" })).status, 401, "Worker routes reject unauthenticated requests");
    assert.equal((await fetch(`${base}/api/bucky/jobs`)).status, 401, "Family job state requires authentication");
    const login = await fetch(`${base}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find((value) => value.startsWith("breadloaf_session="))?.split(";")[0];
    assert.ok(cookie);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([612, 792]).drawText(`Pump service original ${marker}`, { x: 40, y: 700, font, size: 16, color: rgb(0, 0, 0) });
    const bytes = new Uint8Array(await pdf.save());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    originalPath = path.resolve(process.cwd(), "public", "uploads", `${checksum}.pdf`);
    const form = new FormData(); form.set("kind", "document_analysis");
    form.append("files", new Blob([bytes], { type: "application/pdf" }), `${marker}.pdf`);
    const uploaded = await fetch(`${base}/api/bucky/jobs`, { method: "POST", headers: { Cookie: cookie }, body: form });
    assert.equal(uploaded.status, 202, await uploaded.clone().text());
    const job = (await uploaded.json()).jobs[0];
    jobIds.push(job.id); docIds.push(job.sourceDocumentId);
    assert.equal(job.status, "queued");
    const duplicate = await fetch(`${base}/api/bucky/jobs`, { method: "POST", headers: { Cookie: cookie }, body: form });
    assert.equal(duplicate.status, 202, await duplicate.clone().text());
    const repeated = (await duplicate.json()).jobs[0];
    assert.equal(repeated.id, job.id, "Retrying the same upload returns the original job");
    assert.equal(repeated.sourceDocumentId, job.sourceDocumentId, "Retrying the same upload keeps one archive document");
    assert.equal(requests, 0, "Upload does not invoke a model");
    const original = await db.document.findUniqueOrThrow({ where: { id: job.sourceDocumentId } });
    assert.equal(original.analysisState, "pending"); assert.equal(original.checksum, checksum);
    assert.equal(createHash("sha256").update(await readFile(originalPath)).digest("hex"), checksum);
    const listed = await fetch(`${base}/api/bucky/jobs`, { headers: { Cookie: cookie } });
    const visible = (await listed.json()).jobs.find((candidate: { id: string }) => candidate.id === job.id);
    assert.equal(visible.status, "queued"); assert.equal(visible.checkpoint, undefined);
    const promoted = await fetch(`${base}/api/bucky/jobs/${job.id}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "expedite" }) });
    assert.equal(promoted.status, 200, await promoted.clone().text());
    const completed = await fetch(`${base}/api/bucky/worker/run-api`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    assert.equal(completed.status, 200, await completed.clone().text());
    const progress = await completed.json();
    assert.equal(progress.state, "completed", JSON.stringify(progress));
    assert.equal(requests, 1); assert.equal(imageSeen, true, "PDF route supplies its rendered original page to the mock");
    assert.ok(embeddings > 0, "Completed analysis is indexed through the mock provider");
    const final = await db.document.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(final.analysisState, "ok"); assert.equal(final.aiSummary, result.summary); assert.equal(final.filePath, original.filePath);
    assert.equal(createHash("sha256").update(await readFile(originalPath)).digest("hex"), checksum);
    assert.equal(await db.buckyLedgerEntry.count({ where: { sourceType: "background_job", sourceId: job.id, reversible: true } }), 1);
    const attempts = await db.buckyJobAttempt.findMany({ where: { jobId: job.id } });
    assert.equal(attempts.length, 1); assert.equal(attempts[0].status, "succeeded"); assert.ok((attempts[0].costCents || 0) > 0);
    const budget = await db.buckyApiBudget.findUniqueOrThrow({ where: { month } });
    assert.equal(budget.spentCents, budgetBefore + (attempts[0].costCents || 0)); assert.equal(budget.reservedCents, 0);
    console.log("Built HTTP smoke passed: authentication, retained PDF, idempotent pending upload, expedited API completion, rendered page input, mock indexing, ledger, and budget settlement.");
  } catch (error) {
    console.error(childLogs);
    throw error;
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill(); await Promise.race([stopped, delay(5000)]);
    }
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    const ownedAttempts = await db.buckyJobAttempt.findMany({ where: { workerId: marker } });
    const charged = ownedAttempts.reduce((sum, attempt) => sum + (attempt.costCents || 0), 0);
    const reserved = ownedAttempts.filter((attempt) => attempt.status === "running").reduce((sum, attempt) => sum + attempt.reservedCents, 0);
    if (charged || reserved) await db.buckyApiBudget.updateMany({ where: { month }, data: { spentCents: { decrement: charged }, reservedCents: { decrement: reserved } } });
    await db.buckyLedgerEntry.deleteMany({ where: { sourceType: "background_job", sourceId: { in: jobIds } } });
    await db.embedding.deleteMany({ where: { sourceType: "document", sourceId: { in: docIds } } });
    await db.buckyQuestion.deleteMany({ where: { sourceType: "document", sourceId: { in: docIds } } });
    await db.buckyJob.deleteMany({ where: { id: { in: jobIds } } });
    await db.document.deleteMany({ where: { id: { in: docIds } } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.buckyWorker.deleteMany({ where: { id: marker } });
    await db.$disconnect();
    if (originalPath) {
      const uploads = path.resolve(process.cwd(), "public", "uploads");
      if (path.dirname(originalPath) !== uploads || !/^[a-f0-9]{64}\.pdf$/.test(path.basename(originalPath))) throw new Error("Unexpected smoke cleanup path");
      await rm(originalPath, { force: true });
    }
  }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "HTTP smoke failed"); process.exitCode = 1; });
