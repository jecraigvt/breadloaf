import assert from "node:assert/strict";
import test from "node:test";
import { retryAfterMs, withRetry } from "./openai-client";

test("reads Retry-After seconds from OpenAI errors", () => {
  assert.equal(retryAfterMs({ headers: { "retry-after": "2.5" } }), 2500);
});

test("reads Retry-After dates from OpenAI errors", () => {
  const now = Date.parse("2026-08-05T12:00:00Z");
  assert.equal(
    retryAfterMs({ headers: { "retry-after": "Wed, 05 Aug 2026 12:00:03 GMT" } }, now),
    3000
  );
});

test("retries transient OpenAI failures", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts === 1) throw { status: 429, headers: { "retry-after": "0" } };
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});
