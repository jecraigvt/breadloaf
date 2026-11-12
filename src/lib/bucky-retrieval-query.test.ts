import assert from "node:assert/strict";
import test from "node:test";
import { distillRetrievalQueries, normalizeRetrievalQueries } from "./bucky-retrieval-query";
import { MODELS } from "./ai-models";

test("normalizes and deduplicates up to four retrieval queries", () => {
  assert.deepEqual(
    normalizeRetrievalQueries("raw fallback", [
      "  ancestry   photos ",
      "Ancestry photos",
      "succession rules",
      "annual assessment",
      "water pressure",
      "ignored fifth query",
    ]),
    ["ancestry photos", "succession rules", "annual assessment", "water pressure"]
  );
});

test("falls back to the raw message only when no distilled query survives", () => {
  assert.deepEqual(
    normalizeRetrievalQueries("  Where is the generator?  ", ["", "   "]),
    ["Where is the generator?"]
  );
});

test("retrieval distillation uses native Gemini structured output and preserves fallback on invalid results", async (context) => {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "synthetic-gemini-test-key";
  let output = { queries: ["  ancestry   photos ", "Ancestry photos", "pump repairs"] };
  const requests: Record<string, unknown>[] = [];
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(await new Request(url, init).json());
    return Response.json({
      id: "synthetic-retrieval-interaction",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }],
    });
  });
  context.mock.method(console, "error", () => undefined);
  try {
    assert.deepEqual(await distillRetrievalQueries("Please find our ancestors and pump repairs"), ["ancestry photos", "pump repairs"]);
    assert.equal(requests[0].model, MODELS.flash);
    assert.equal(requests[0].store, false);
    assert.match(String(requests[0].input), /<user_message>Please find our ancestors and pump repairs<\/user_message>/);
    assert.equal((requests[0].response_format as { mime_type: string }).mime_type, "application/json");

    output = { queries: [] };
    assert.deepEqual(await distillRetrievalQueries("  original   fallback question  "), ["original fallback question"]);
    assert.equal(requests.length, 2);
  } finally {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
  }
});
