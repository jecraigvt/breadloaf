import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { createHousekeepingHandler } from "./site-housekeeping";

const token = "synthetic-housekeeping-token-" + "x".repeat(32);
const previous = process.env.SITE_MAINTENANCE_TOKEN;
before(() => { process.env.SITE_MAINTENANCE_TOKEN = token; });
after(() => { if (previous === undefined) delete process.env.SITE_MAINTENANCE_TOKEN; else process.env.SITE_MAINTENANCE_TOKEN = previous; });
const request = (authorized = true) => new NextRequest("https://breadloaf.example.test/api/operations/run", {
  method: "POST", headers: authorized ? { Authorization: `Bearer ${token}` } : {},
});
function tasks() {
  return {
    emailConfigured: () => true,
    inbox: async () => ({ received: 0, processed: [], skipped: [], errors: [] }),
    calendar: async () => ({ created: 0, updated: 0, deleted: 0, pushAttempted: 0, pushSynced: 0, pushFailed: 0 }),
    cleanupAuthAttempts: async () => ({ count: 0 }), cleanupSignInLinks: async () => ({ count: 0 }),
  };
}

test("a configured idle housekeeping pass is successful, but unauthorized callers cannot start work", async () => {
  let calls = 0;
  const handler = createHousekeepingHandler({ ...tasks(), inbox: async () => { calls++; return tasks().inbox(); } });
  assert.equal((await handler(request(false))).status, 401); assert.equal(calls, 0);
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.equal(result.mail.configured, true); assert.equal(result.mail.errors, 0);
  assert.equal(result.calendar.unavailable, false); assert.equal(result.cleanupFailed, false);
});

test("absent IMAP credentials cannot report a successful idle mailbox", async () => {
  const response = await createHousekeepingHandler({ ...tasks(), emailConfigured: () => false })(request());
  assert.equal(response.status, 503);
  const result = await response.json(); assert.equal(result.mail.configured, false); assert.equal(result.mail.errors, 1);
});

test("failed cleanup returns failure even when mail and calendar finish normally", async () => {
  for (const name of ["cleanupAuthAttempts", "cleanupSignInLinks"] as const) {
    const response = await createHousekeepingHandler({ ...tasks(), [name]: async () => { throw new Error("PRIVATE database details"); } })(request());
    assert.equal(response.status, 503);
    const text = await response.text(); assert.equal(JSON.parse(text).cleanupFailed, true); assert.equal(text.includes("PRIVATE"), false);
  }
});

test("a failed outbound calendar write remains a failure alongside successful inbound changes", async () => {
  const response = await createHousekeepingHandler({ ...tasks(), calendar: async () => ({ created: 2, updated: 1, deleted: 0,
    pushAttempted: 1, pushSynced: 0, pushFailed: 1, error: "PRIVATE provider response" }) })(request());
  assert.equal(response.status, 503);
  const text = await response.text(), result = JSON.parse(text);
  assert.equal(result.calendar.created, 2); assert.equal(result.calendar.pushFailed, 1); assert.equal(result.calendar.unavailable, true);
  assert.equal(text.includes("PRIVATE"), false);
});

test("mail processing and rejected calendar tasks are scrubbed failures without suppressing cleanup", async () => {
  let cleaned = 0;
  const response = await createHousekeepingHandler({ ...tasks(),
    inbox: async () => ({ received: 1, processed: [], skipped: [], errors: [{ subject: "PRIVATE subject", error: "PRIVATE content" }] }),
    calendar: async () => { throw new Error("PRIVATE credentials"); },
    cleanupSignInLinks: async () => { cleaned++; },
  })(request());
  assert.equal(response.status, 503); assert.equal(cleaned, 1);
  const text = await response.text(), result = JSON.parse(text);
  assert.equal(result.mail.received, 1); assert.equal(result.mail.errors, 1); assert.equal(result.calendar.unavailable, true);
  assert.equal(text.includes("PRIVATE"), false);
});
