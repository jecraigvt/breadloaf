import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseSubscription, codexEnvironment, quotaRemainingPercent, safeWorkerOrigin } from "./bucky-codex-policy";

test("subscription reserve uses the tightest window across buckets", () => {
  const remaining = quotaRemainingPercent({ rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 30 }, secondary: { usedPercent: 76 } },
    other: { primary: { usedPercent: 10 } },
  } });
  assert.equal(remaining, 24);
  assert.equal(canUseSubscription({ account: { type: "chatgpt" } }, remaining), false);
  assert.equal(canUseSubscription({ account: { type: "chatgpt" } }, 25), false);
  assert.equal(canUseSubscription({ account: { type: "chatgpt" } }, 25.01), true);
  assert.equal(canUseSubscription({ account: { type: "apiKey" } }, 100), false);
});
test("unknown quota never means a free quota", () => {
  for (const response of [null, {}, { rateLimits: {} }, { rateLimits: { primary: { usedPercent: "0" } } },
    { rateLimits: { primary: { usedPercent: -1 } } }, { rateLimits: { primary: null } }])
    assert.equal(quotaRemainingPercent(response), null);
  assert.equal(quotaRemainingPercent({ rateLimits: { primary: { usedPercent: 0 }, secondary: null } }), 100);
  assert.equal(quotaRemainingPercent({ rateLimits: { rateLimitReachedType: "quota" } }), 0);
});
test("child processes never inherit site, database, or worker credentials", () => {
  assert.deepEqual(codexEnvironment({ PATH: "bin", USERPROFILE: "user", OPENAI_API_KEY: "secret", DATABASE_URL: "secret", BUCKY_WORKER_TOKEN: "secret" }),
    { PATH: "bin", USERPROFILE: "user", NODE_ENV: "production" });
});
test("worker connections require secure origins and never send credentials on redirects", () => {
  assert.equal(safeWorkerOrigin("https://breadloafhill.com"), "https://breadloafhill.com");
  assert.equal(safeWorkerOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const value of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=a"])
    assert.throws(() => safeWorkerOrigin(value));
});
