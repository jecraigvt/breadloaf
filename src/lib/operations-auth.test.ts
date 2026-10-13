import assert from "node:assert/strict";
import test from "node:test";
import { authorizedOperationsRequest } from "./operations-auth";

test("scheduled operations require their exact, strong credential", () => {
  const previous = process.env.SITE_MAINTENANCE_TOKEN;
  try {
    process.env.SITE_MAINTENANCE_TOKEN = "a".repeat(43);
    const request = (token?: string) => new Request("https://breadloafhill.com/api/operations/run", { headers: token ? { authorization: `Bearer ${token}` } : {} });
    assert.equal(authorizedOperationsRequest(request()), false);
    assert.equal(authorizedOperationsRequest(request("3333")), false);
    assert.equal(authorizedOperationsRequest(request("b".repeat(43))), false);
    assert.equal(authorizedOperationsRequest(request("a".repeat(44))), false);
    assert.equal(authorizedOperationsRequest(request("a".repeat(43))), true);
    process.env.SITE_MAINTENANCE_TOKEN = "weak";
    assert.equal(authorizedOperationsRequest(request("weak")), false);
  } finally { if (previous === undefined) delete process.env.SITE_MAINTENANCE_TOKEN; else process.env.SITE_MAINTENANCE_TOKEN = previous; }
});
