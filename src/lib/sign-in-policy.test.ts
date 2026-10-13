import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSignInEmail, safeSignInDestination, createSignInSecret, hashSignInSecret, validSignInSecret } from "./sign-in-policy";

test("sign-in destinations cannot send an authenticated relative to another origin", () => {
  for (const target of ["https://evil.example", "//evil.example", "/\\evil.example", "/login?from=//evil.example", "/api/auth", "/\n/evil.example"]) assert.equal(safeSignInDestination(target), "/");
  assert.equal(safeSignInDestination("/documents?q=roof#search"), "/documents?q=roof#search");
});
test("sign-in addresses reject header injection and normalize directory lookup", () => {
  assert.equal(normalizeSignInEmail("  Family@Example.com "), "family@example.com");
  for (const value of ["a@example.com\nBcc:other@example.com", "a@b", {}, "<a@example.com>"]) assert.equal(normalizeSignInEmail(value), null);
});
test("only one-way verifiers are stored for random sign-in secrets", () => {
  const one = createSignInSecret(), two = createSignInSecret();
  assert.notEqual(one, two); assert.ok(validSignInSecret(one)); assert.equal(validSignInSecret(one + "."), false);
  assert.equal(hashSignInSecret(one).length, 64); assert.notEqual(hashSignInSecret(one), one);
});
