import assert from "node:assert/strict";
import test from "node:test";
import { createApiRunner } from "../../scripts/bucky-worker/api";
import { MODELS } from "./ai-models";
import { backgroundApiUpperBoundCents } from "./bucky-api-cost";

test("paid coding uses native Hydrogen, meters thinking, and preserves its reservation", async () => {
  const previousKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "mock-no-network";
  try {
    let calls = 0;
    const abort = new AbortController();
    const runner = createApiRunner(25, abort.signal, async (request, options) => {
      calls++;
      assert.equal(request.model, MODELS.pro);
      assert.equal(request.store, false);
      assert.equal(request.generation_config?.max_output_tokens, 4096);
      assert.equal(options?.retries, 0);
      assert.equal(options?.signal, abort.signal);
      return { id: "mock", status: "completed", steps: [], output_text: '{"result":"ok"}',
        usage: { total_input_tokens: 10_000, total_output_tokens: 1_000, total_thought_tokens: 3_000, total_tokens: 14_000 } };
    });
    assert.deepEqual(await runner.run("Create a small patch", { type: "object" }), { result: "ok" });
    assert.deepEqual(runner.usage, { inputTokens: 10_000, outputTokens: 4_000, costCents: 5, model: MODELS.pro });
    await assert.rejects(runner.run("x".repeat(200_000), {}), /reserved API budget/);
    assert.equal(calls, 1, "Over-budget requests never reach the provider");
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_AI_API_KEY; else process.env.GOOGLE_AI_API_KEY = previousKey;
  }
});

test("unmetered incomplete coding responses consume the conservative bound", async () => {
  const previousKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "mock-no-network";
  try {
    const runner = createApiRunner(25, new AbortController().signal, async () => ({ id: "mock", status: "incomplete", steps: [] }));
    await assert.rejects(runner.run("Read this", {}), /did not finish/);
    assert.equal(runner.usage.costCents, backgroundApiUpperBoundCents("Read this{}"));
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_AI_API_KEY; else process.env.GOOGLE_AI_API_KEY = previousKey;
  }
});

test("paid coding rejects completed responses that carry a native model error", async () => {
  const previousKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "mock-no-network";
  try {
    const runner = createApiRunner(25, new AbortController().signal, async () => ({ id: "mock", status: "completed",
      output_text: '{"result":"unusable"}', steps: [{ type: "model_output", content: [], error: { code: 400, message: "Blocked" } }],
      usage: { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 10, total_tokens: 130 } }));
    await assert.rejects(runner.run("Read this", {}), /did not complete successfully/);
    assert.equal(runner.usage.costCents, 1, "Failed generation is still metered");
  } finally {
    if (previousKey === undefined) delete process.env.GOOGLE_AI_API_KEY; else process.env.GOOGLE_AI_API_KEY = previousKey;
  }
});
