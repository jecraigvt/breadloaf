import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { transcribeMediaBuffer, triageInlineDocument } from "./ai";
import { MODELS } from "./ai-models";

function interaction(text: string) {
  return {
    id: "synthetic-ai-hydrogen-interaction",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  };
}

function mockGemini(context: TestContext, respond: (body: Record<string, unknown>) => unknown) {
  const oldKey = process.env.GOOGLE_AI_API_KEY;
  const oldBaseUrl = process.env.GOOGLE_AI_BASE_URL;
  process.env.GOOGLE_AI_API_KEY = "synthetic-ai-hydrogen-test-key";
  delete process.env.GOOGLE_AI_BASE_URL;
  context.after(() => {
    if (oldKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldKey;
    if (oldBaseUrl === undefined) delete process.env.GOOGLE_AI_BASE_URL;
    else process.env.GOOGLE_AI_BASE_URL = oldBaseUrl;
  });
  return context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("x-goog-api-key"), "synthetic-ai-hydrogen-test-key");
    const body = await request.json() as Record<string, unknown>;
    assert.equal(body.store, false);
    return Response.json(respond(body));
  });
}

test("video transcription sends original bytes to Hydrogen and returns the spoken transcript", async (context) => {
  const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 0, 255]);
  const transcript = "Tom: Shut off line three.\nJim: Correction, line four — the washer supply.";
  const transport = mockGemini(context, (body) => {
    assert.equal(body.model, MODELS.videoTranscription);
    assert.equal(body.model, MODELS.flash);
    assert.deepEqual(body.input, [{ type: "video", data: bytes.toString("base64"), mime_type: "video/mp4" }]);
    assert.match(String(body.system_instruction), /verbatim/);
    assert.match(String(body.system_instruction), /Do not summarize/);
    assert.equal("response_format" in body, false);
    return interaction(transcript);
  });
  assert.equal(await transcribeMediaBuffer(bytes, "VIDEO/MP4; codecs=avc1", "walkthrough.mp4"), transcript);
  assert.equal(transport.mock.callCount(), 1);
});

test("video transcription rejects blank or provider-error output instead of retaining a false transcript", async (context) => {
  const responses = [
    interaction(" \n "),
    { ...interaction("Unreliable transcript"), errors: [{ code: "INTERNAL", message: "synthetic provider failure" }] },
    { ...interaction(""), steps: [{ type: "model_output", error: { code: "INTERNAL", message: "synthetic output failure" } }] },
  ];
  let requestIndex = 0;
  const transport = mockGemini(context, () => responses[requestIndex++]);
  for (let index = 0; index < responses.length; index++) {
    await assert.rejects(transcribeMediaBuffer(Buffer.from("synthetic video bytes"), "video/webm"), /empty response|did not complete/);
  }
  assert.equal(transport.mock.callCount(), responses.length, "semantic failures must not repeat provider calls");
});

test("inline intake sends PDFs and images as native Hydrogen inputs and validates triage fields", async (context) => {
  const data = Buffer.from("synthetic original source bytes").toString("base64");
  const result = { documentType: "receipt_invoice", voiceMemoDisposition: null, confidence: 0.9, reason: "A dated service receipt." };
  const requests: Record<string, unknown>[] = [];
  let invalid = false;
  const transport = mockGemini(context, (body) => {
    requests.push(body);
    assert.equal(body.model, MODELS.flash);
    assert.equal((body.response_format as { mime_type: string }).mime_type, "application/json");
    return interaction(JSON.stringify(invalid ? { ...result, documentType: "invented_type" } : result));
  });
  assert.deepEqual(await triageInlineDocument(data, "application/pdf", "service.pdf"), result);
  assert.deepEqual((requests[0].input as unknown[])[0], { type: "document", data, mime_type: "application/pdf" });
  assert.match(String(((requests[0].input as { text?: string }[])[1]).text), /service\.pdf/);
  assert.deepEqual(await triageInlineDocument(data, "image/jpeg", "receipt.jpg"), result);
  assert.deepEqual((requests[1].input as unknown[])[0], { type: "image", data, mime_type: "image/jpeg" });
  invalid = true;
  await assert.rejects(triageInlineDocument(data, "image/png", "receipt.png"));
  assert.equal(transport.mock.callCount(), 3);
});
