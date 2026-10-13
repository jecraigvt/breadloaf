import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const fixtureEnvironment: Record<string, string> = {
  APP_URL: "https://breadloaf.example.test", NODE_ENV: "production",
  FAMILY_EMAIL_SIGN_IN_ENABLED: "true", FAMILY_PINS: "", FAMILY_EMAIL_TEST_SMTP_PORT: "",
};
const previous = new Map<string, string | undefined>();
before(() => { for (const [key, value] of Object.entries(fixtureEnvironment)) { previous.set(key, process.env[key]); process.env[key] = value; } });
after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test("an unauthenticated private bookmark redirects to the public site behind an internal proxy origin", async () => {
  const response = await middleware(new NextRequest("http://localhost:3000/calendar?month=2026-11"));
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("Location")!);
  assert.equal(location.origin, "https://breadloaf.example.test");
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("from"), "/calendar?month=2026-11");
});

test("email sign-in accepts the canonical browser origin while foreign origins are rejected", async () => {
  const request = (origin: string, site = "same-origin") => new NextRequest("http://localhost:3000/api/auth/link", {
    method: "POST", headers: { origin, "sec-fetch-site": site },
  });
  assert.equal((await middleware(request("https://breadloaf.example.test"))).headers.get("x-middleware-next"), "1");
  assert.equal((await middleware(request("https://another.example.test"))).status, 403);
  assert.equal((await middleware(request("https://breadloaf.example.test", "cross-site"))).status, 403);
});

test("emergency contacts, guide, and weather remain reachable without remembered family access", async () => {
  for (const path of ["/emergency", "/guide", "/weather"]) {
    assert.equal((await middleware(new NextRequest(`http://localhost:3000${path}`))).headers.get("x-middleware-next"), "1");
  }
  assert.equal((await middleware(new NextRequest("http://localhost:3000/api/documents"))).status, 401);
});
