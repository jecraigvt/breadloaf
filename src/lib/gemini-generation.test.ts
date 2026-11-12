import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as z from "zod";
import {
  createGeminiInteraction,
  generateGeminiStructured,
  generateGeminiText,
  getGeminiClient,
} from "./gemini-generation";
import { MODELS } from "./ai-models";

const TestResult = z.strictObject({ title: z.string(), count: z.number().int() });

function interaction(text: string, status = "completed") {
  return {
    id: "interaction_contract_test",
    status,
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  };
}

function mockTransport(t: TestContext, respond: (request: Request, body: Record<string, unknown>) => Response | Promise<Response>) {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "gemini-contract-test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
  });
  return t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.match(request.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/interactions$/);
    assert.equal(request.headers.get("x-goog-api-key"), "gemini-contract-test-key");
    return respond(request, await request.json() as Record<string, unknown>);
  });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("Gemini client fails closed when its credential is missing", () => {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try { assert.throws(getGeminiClient, /^Error: GOOGLE_AI_API_KEY is not configured$/); }
  finally {
    if (oldKey !== undefined) process.env.GOOGLE_AI_API_KEY = oldKey;
  }
});

test("Gemini test endpoint override cannot forward a credential to a remote host", (t) => {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  const oldBaseUrl = process.env.GOOGLE_AI_BASE_URL;
  process.env.GOOGLE_AI_API_KEY = "gemini-contract-test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
    if (oldBaseUrl === undefined) delete process.env.GOOGLE_AI_BASE_URL;
    else process.env.GOOGLE_AI_BASE_URL = oldBaseUrl;
  });
  for (const baseUrl of ["https://example.com", "http://127.0.0.1.example.com", "http://user:password@localhost", "http://localhost/path", "http://localhost?redirect=1"]) {
    process.env.GOOGLE_AI_BASE_URL = baseUrl;
    assert.throws(getGeminiClient, /must be a loopback HTTP origin/);
  }
});

test("structured generation sends native multimodal Interactions JSON and validates its result", async (t) => {
  const input = [
    { type: "text" as const, text: "Read the supplied originals." },
    { type: "image" as const, data: "aW1hZ2U=", mime_type: "image/jpeg" },
    { type: "document" as const, data: "cGRm", mime_type: "application/pdf" },
  ];
  const transport = mockTransport(t, (_request, body) => {
    assert.equal(body.model, MODELS.flash);
    assert.deepEqual(body.input, input);
    assert.equal(body.system_instruction, "Preserve names exactly.");
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.deepEqual(body.generation_config, { thinking_level: "low", max_output_tokens: 800 });
    assert.deepEqual(body.response_format, {
      type: "text", mime_type: "application/json", schema: z.toJSONSchema(TestResult),
    });
    assert.equal("previous_interaction_id" in body, false);
    return jsonResponse(interaction('{"title":"Breadloaf","count":2}'));
  });
  assert.deepEqual(await generateGeminiStructured({
    model: MODELS.flash, instructions: "Preserve names exactly.", input,
    schema: TestResult, maxOutputTokens: 800,
  }), { title: "Breadloaf", count: 2 });
  assert.equal(transport.mock.callCount(), 1);
});

test("text generation preserves explicit high thinking and excludes thought output", async (t) => {
  mockTransport(t, (_request, body) => {
    assert.deepEqual(body.generation_config, { thinking_level: "high" });
    assert.equal("response_format" in body, false);
    return jsonResponse({
      ...interaction("  The roof needs a spring inspection.  "),
      steps: [
        { type: "thought", summary: [{ type: "text", text: "Private planning" }] },
        ...interaction("  The roof needs a spring inspection.  ").steps,
      ],
    });
  });
  assert.equal(await generateGeminiText({
    model: MODELS.pro, input: "Review the maintenance record.", thinkingLevel: "high",
  }), "The roof needs a spring inspection.");
});

test("structured generation rejects malformed and schema-invalid JSON without repair or retries", async (t) => {
  for (const output of ["```json\n{}\n```", '{"title":"Cabin"}', '{"title":"Cabin","count":"2"}', '{"title":"Cabin","count":2,"invented":true}']) {
    await t.test(output, async (subtest) => {
      const transport = mockTransport(subtest, () => jsonResponse(interaction(output)));
      await assert.rejects(generateGeminiStructured({ model: MODELS.flash, input: "Classify", schema: TestResult }));
      assert.equal(transport.mock.callCount(), 1);
    });
  }
});

test("generation rejects partial, failed, and empty completions", async (t) => {
  for (const response of [interaction("partial", "incomplete"), interaction("failed", "failed"), interaction("   "), {
    ...interaction("apparently complete"), errors: [{ code: "INTERNAL", message: "provider fault" }],
  }]) {
    await t.test(JSON.stringify(response), async (subtest) => {
      const transport = mockTransport(subtest, () => jsonResponse(response));
      await assert.rejects(generateGeminiText({ model: MODELS.flash, input: "Summarize" }), /did not complete|empty response/);
      assert.equal(transport.mock.callCount(), 1);
    });
  }
});

test("raw creation returns tool calls and usage without enabling server storage", async (t) => {
  const transport = mockTransport(t, (_request, body) => {
    assert.equal(body.store, false);
    return jsonResponse({
      id: "interaction_tools", status: "requires_action",
      steps: [{ type: "function_call", id: "call_1", name: "get_stays", arguments: {} }],
      usage: { total_input_tokens: 20, total_output_tokens: 5, total_thought_tokens: 2 },
    });
  });
  const result = await createGeminiInteraction({ model: MODELS.pro, input: "Who is visiting?", store: true });
  assert.equal(result.status, "requires_action");
  assert.equal(result.steps[0].type, "function_call");
  assert.equal(result.usage?.total_thought_tokens, 2);
  assert.equal(transport.mock.callCount(), 1);
});

test("raw creation disables SDK retries for paid attempts", async (t) => {
  const transport = mockTransport(t, () => jsonResponse({ error: { code: 503, message: "unavailable", status: "UNAVAILABLE" } }, 503));
  await assert.rejects(createGeminiInteraction({ model: MODELS.pro, input: "Analyze" }), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 503);
    return true;
  });
  assert.equal(transport.mock.callCount(), 1);
});

test("routine generation retries transient errors through the shared Retry-After policy", async (t) => {
  let attempts = 0;
  const transport = mockTransport(t, () => ++attempts === 1
    ? jsonResponse({ error: { code: 429, message: "try again", status: "RESOURCE_EXHAUSTED" } }, 429, { "Retry-After": "0" })
    : jsonResponse(interaction("Recovered")));
  assert.equal(await generateGeminiText({ model: MODELS.flash, input: "Summarize" }), "Recovered");
  assert.equal(transport.mock.callCount(), 2);
});

test("an aborted raw request never reaches the provider", async (t) => {
  const transport = mockTransport(t, () => { throw new Error("Unexpected provider call"); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createGeminiInteraction({ model: MODELS.pro, input: "Analyze" }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(transport.mock.callCount(), 0);
});
