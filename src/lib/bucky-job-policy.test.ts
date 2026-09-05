import assert from "node:assert/strict";
import test from "node:test";
import { apiFallbackEligible, authorizedJobSource, budgetCanReserve, configuredCents, leaseIsCurrent, quotaAllowsLocalWork, settlementCents } from "./bucky-job-policy";

test("local quota reserve fails closed and uses strictly more than 25 percent", () => {
  for (const value of [undefined, null, NaN, Infinity, -1, 0, 25, 101, "50"]) assert.equal(quotaAllowsLocalWork(value), false);
  assert.equal(quotaAllowsLocalWork(25.1), true);
  assert.equal(quotaAllowsLocalWork(100), true);
});
test("paid fallback waits for its deadline unless explicitly expedited", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  assert.equal(apiFallbackEligible({ priority: 0, fallbackAfter: new Date(now.getTime() + 1) }, now), false);
  assert.equal(apiFallbackEligible({ priority: 0, fallbackAfter: now }, now), true);
  assert.equal(apiFallbackEligible({ priority: 100, fallbackAfter: new Date(now.getTime() + 86_400_000) }, now), true);
});
test("budget includes concurrent reservations and invalid limits disable spending", () => {
  assert.equal(budgetCanReserve({ spentCents: 250, reservedCents: 25 }, 25, 300), true);
  assert.equal(budgetCanReserve({ spentCents: 251, reservedCents: 25 }, 25, 300), false);
  assert.equal(budgetCanReserve({ spentCents: 0, reservedCents: 0 }, 0, 300), false);
  for (const value of ["-1", "abc", "1.5"]) assert.equal(configuredCents(value, 300), 0);
  assert.equal(configuredCents("0", 300), 0);
  assert.equal(configuredCents(undefined, 300), 300);
});
test("lease expiry, replacement, and terminal status revoke write authority", () => {
  const now = new Date();
  const job = { generation: 2, status: "running" };
  const attempt = { generation: 2, status: "running", leaseExpiresAt: new Date(now.getTime() + 1000) };
  assert.equal(leaseIsCurrent(job, attempt, now), true);
  assert.equal(leaseIsCurrent(job, { ...attempt, generation: 1 }, now), false);
  assert.equal(leaseIsCurrent(job, { ...attempt, leaseExpiresAt: now }, now), false);
  assert.equal(leaseIsCurrent({ ...job, status: "cancelled" }, attempt, now), false);
  assert.equal(leaseIsCurrent(job, { ...attempt, status: "succeeded" }, now), false);
});
test("unmetered paid attempts spend their reservation; reported overages are recorded", () => {
  assert.equal(settlementCents(25), 25);
  assert.equal(settlementCents(25, 4), 4);
  assert.equal(settlementCents(25, 30), 30);
  assert.equal(settlementCents(25, -1), 25);
  assert.equal(settlementCents(0, 25), 0);
});
test("source access is limited to explicit job references", () => {
  const job = { sourceDocumentId: "doc-a", request: { sourceDocumentIds: ["doc-b"] } };
  assert.equal(authorizedJobSource(job), undefined);
  assert.equal(authorizedJobSource(job, "doc-b"), "doc-b");
  assert.equal(authorizedJobSource(job, "doc-b:page:0"), "doc-b:page:0");
  assert.equal(authorizedJobSource(job, "doc-a:text:12"), "doc-a:text:12");
  assert.throws(() => authorizedJobSource(job, "doc-a:../private"));
  assert.throws(() => authorizedJobSource(job, "private-doc"));
  assert.equal(authorizedJobSource({ sourceDocumentId: null, request: {} }), undefined);
});
