import assert from "node:assert/strict";
import test from "node:test";
import { deriveArchiveQuestion, questionShapeProblem } from "./archive-roundtrip-question";
import { MODELS } from "./ai-models";

test("round-trip questions reject structured or multilingual output debris", () => {
  assert.equal(questionShapeProblem("Which numbered line supplies the washer?"), null);
  assert.match(
    questionShapeProblem("Which line supplies the washer?} final only JSON.?") || "",
    /complete question|structured-output debris/
  );
  assert.match(
    questionShapeProblem("Which line supplies the washer 中国文?") || "",
    /non-Latin output debris/
  );
});

test("Gemini question generation rejects title leakage before accepting a grounded question", async (context) => {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = "synthetic-gemini-test-key";
  const requests: Record<string, unknown>[] = [];
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(await new Request(url, init).json());
    const question = requests.length === 1
      ? "What does the winterization checklist recommend?"
      : "Which numbered line supplies the washer?";
    return Response.json({
      id: "synthetic-question-interaction",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ question }) }] }],
    });
  });
  try {
    const question = await deriveArchiveQuestion({ title: "Winterization Checklist" }, "Numbered line 3 supplies the washer.");
    assert.equal(question, "Which numbered line supplies the washer?");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, MODELS.flash);
    assert.equal(requests[0].store, false);
    assert.match(String(requests[1].input), /prior attempt was rejected.*winterization/);
  } finally {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
  }
});
