import assert from "node:assert/strict";
import test from "node:test";
import { requestSavedState } from "./saved-state";

test("HTTP failures and a redirected login page cannot be mistaken for a saved change", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [Response.json({ error: "Not saved" }, { status: 500 }), new Response("Unavailable", { status: 503 }), new Response("<html>Sign in</html>", { status: 200 })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(requestSavedState("https://test.invalid/item"));
    }
    globalThis.fetch = async () => Response.json({ id: "saved", checked: true });
    assert.deepEqual(await requestSavedState("https://test.invalid/item"), { id: "saved", checked: true });
  } finally { globalThis.fetch = original; }
});
