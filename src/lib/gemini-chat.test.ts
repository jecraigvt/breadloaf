import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Interactions } from "@google/genai";
import { runGeminiChat } from "./gemini-chat";
import { MODELS } from "./ai-models";

const instructions = "You are the family property assistant. Save only confirmed changes.";
const initialInput: Interactions.Step[] = [
  { type: "user_input", content: [{ type: "text", text: "Save the note and check our visit." }] },
];
const tools = [{ type: "function" as const, name: "save_memory", parameters: {
  type: "object", properties: { topic: { type: "string" } }, required: ["topic"],
} }];

function response(steps: Interactions.Step[], status = "completed") {
  return { id: "interaction_chat_contract", status, steps };
}

function output(text: string): Interactions.ModelOutputStep {
  return { type: "model_output", content: [{ type: "text", text }] };
}

function transport(t: TestContext, respond: (body: Record<string, unknown>, call: number) => unknown) {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  const oldBaseUrl = process.env.GOOGLE_AI_BASE_URL;
  process.env.GOOGLE_AI_API_KEY = "gemini-chat-contract-test-key";
  delete process.env.GOOGLE_AI_BASE_URL;
  t.after(() => {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
    if (oldBaseUrl === undefined) delete process.env.GOOGLE_AI_BASE_URL;
    else process.env.GOOGLE_AI_BASE_URL = oldBaseUrl;
  });
  let count = 0;
  return t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.match(request.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/interactions$/);
    assert.equal(request.headers.get("x-goog-api-key"), "gemini-chat-contract-test-key");
    const body = await request.json() as Record<string, unknown>;
    assert.equal(body.model, MODELS.flash);
    assert.equal(body.system_instruction, instructions);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    assert.equal("previous_interaction_id" in body, false);
    return new Response(JSON.stringify(respond(body, ++count)), { headers: { "Content-Type": "application/json" } });
  });
}

test("chat replays native thought signatures, function calls, and previous history unchanged", async (t) => {
  const previous: Interactions.Step[] = [
    { type: "user_input", content: [{ type: "text", text: "Previous question" }] },
    output("Previous answer"),
    ...initialInput,
  ];
  const originalInput = structuredClone(previous);
  const nativeSteps: Interactions.Step[] = [
    { type: "thought", signature: "opaque-native-signature+/=", summary: [{ type: "text", text: "Check the note before saving." }] },
    output("I’ll save the confirmed note."),
    { type: "function_call", id: "native_call_7", name: "save_memory", arguments: { topic: "Roof inspection" } },
  ];
  const executed: unknown[] = [];
  const fetch = transport(t, (body, call) => {
    assert.deepEqual(body.tools, tools);
    assert.deepEqual(body.generation_config, { thinking_level: "high" });
    if (call === 1) {
      assert.deepEqual(body.input, originalInput);
      return response(nativeSteps, "requires_action");
    }
    assert.equal(call, 2);
    assert.deepEqual(body.input, [...originalInput, ...nativeSteps, {
      type: "function_result", name: "save_memory", call_id: "native_call_7",
      result: [{ type: "text", text: '{"saved":true,"id":"memory_1"}' }],
    }]);
    return response([output("  Saved the roof inspection note.  ")]);
  });
  const answer = await runGeminiChat({
    model: MODELS.flash, instructions, input: previous, tools, thinkingLevel: "high",
    executeTool: async (name, args) => { executed.push({ name, args }); return { saved: true, id: "memory_1" }; },
  });
  assert.equal(answer, "Saved the roof inspection note.");
  assert.deepEqual(executed, [{ name: "save_memory", args: { topic: "Roof inspection" } }]);
  assert.deepEqual(previous, originalInput);
  assert.equal(fetch.mock.callCount(), 2);
});

test("parallel model tool calls each receive the matching native result ID", async (t) => {
  const calls: Interactions.FunctionCallStep[] = [
    { type: "function_call", id: "save_1", name: "save_memory", arguments: { topic: "Pump" } },
    { type: "function_call", id: "visit_2", name: "get_stays", arguments: { date: "2026-11-12" } },
  ];
  const executed: unknown[] = [];
  const fetch = transport(t, (body, call) => {
    assert.deepEqual(body.generation_config, { thinking_level: "low" });
    if (call === 1) return response(calls, "requires_action");
    assert.equal(call, 2);
    assert.deepEqual(body.input, [...initialInput, ...calls,
      { type: "function_result", name: "save_memory", call_id: "save_1", result: [{ type: "text", text: '{"saved":"Pump"}' }] },
      { type: "function_result", name: "get_stays", call_id: "visit_2", result: [{ type: "text", text: '[{"family":"Craig"}]' }] },
    ]);
    return response([output("Saved. The Craigs are visiting.")]);
  });
  const answer = await runGeminiChat({
    model: MODELS.flash, instructions, input: initialInput, tools, thinkingLevel: "low",
    executeTool: async (name, args) => {
      executed.push({ name, args });
      return name === "save_memory" ? { saved: args.topic } : [{ family: "Craig" }];
    },
  });
  assert.equal(answer, "Saved. The Craigs are visiting.");
  assert.deepEqual(executed, [
    { name: "save_memory", args: { topic: "Pump" } },
    { name: "get_stays", args: { date: "2026-11-12" } },
  ]);
  assert.equal(fetch.mock.callCount(), 2);
});

test("tool errors become native is_error results and remaining calls still finish", async (t) => {
  const calls: Interactions.FunctionCallStep[] = [
    { type: "function_call", id: "failed_save", name: "save_memory", arguments: { topic: "Pump" } },
    { type: "function_call", id: "successful_read", name: "get_stays", arguments: {} },
  ];
  let executed = 0;
  transport(t, (body, call) => {
    if (call === 1) return response(calls, "requires_action");
    assert.equal(call, 2);
    assert.deepEqual((body.input as Interactions.Step[]).slice(-2), [
      { type: "function_result", name: "save_memory", call_id: "failed_save", is_error: true,
        result: [{ type: "text", text: '{"error":"Failed: Database unavailable"}' }] },
      { type: "function_result", name: "get_stays", call_id: "successful_read", result: [{ type: "text", text: "[]" }] },
    ]);
    return response([output("The note could not be saved. There are no visits.")]);
  });
  assert.equal(await runGeminiChat({
    model: MODELS.flash, instructions, input: initialInput, tools, thinkingLevel: "low",
    executeTool: async (name) => {
      executed++;
      if (name === "save_memory") throw new Error("Database unavailable");
      return [];
    },
  }), "The note could not be saved. There are no visits.");
  assert.equal(executed, 2);
});

test("the eight-round action cap prevents a ninth mutation", async (t) => {
  let mutations = 0;
  const fetch = transport(t, (body, call) => {
    assert.equal((body.input as Interactions.Step[]).length, initialInput.length + 2 * (call - 1));
    return response([{ type: "function_call", id: `call_${call}`, name: "save_memory", arguments: { topic: `Note ${call}` } }], "requires_action");
  });
  const answer = await runGeminiChat({
    model: MODELS.flash, instructions, input: initialInput, tools, thinkingLevel: "low",
    executeTool: async () => ({ id: `memory_${++mutations}` }),
  });
  assert.match(answer, /action limit/);
  assert.match(answer, /Completed actions have been saved/);
  assert.equal(mutations, 8);
  assert.equal(fetch.mock.callCount(), 9);
});

test("chat can deliver the final answer after eight completed tool rounds", async (t) => {
  let mutations = 0;
  const fetch = transport(t, (_body, call) => call === 9
    ? response([output("All eight notes are saved.")])
    : response([{ type: "function_call", id: `call_${call}`, name: "save_memory", arguments: { topic: `Note ${call}` } }], "requires_action"));
  const answer = await runGeminiChat({
    model: MODELS.flash, instructions, input: initialInput, tools, thinkingLevel: "low",
    executeTool: async () => ({ id: `memory_${++mutations}` }),
  });
  assert.equal(answer, "All eight notes are saved.");
  assert.equal(mutations, 8);
  assert.equal(fetch.mock.callCount(), 9);
});

test("chat rejects incomplete responses before running any tool", async (t) => {
  for (const steps of [
    [output("A partial answer")],
    [{ type: "function_call" as const, id: "partial_call", name: "save_memory", arguments: { topic: "Unsafe partial" } }],
  ]) {
    await t.test(steps[0].type, async (subtest) => {
      let mutations = 0;
      const fetch = transport(subtest, () => response(steps, "incomplete"));
      await assert.rejects(runGeminiChat({
        model: MODELS.flash, instructions, input: initialInput, tools, thinkingLevel: "low",
        executeTool: async () => { mutations++; return {}; },
      }), /incomplete|did not complete/);
      assert.equal(mutations, 0);
      assert.equal(fetch.mock.callCount(), 1);
    });
  }
});
