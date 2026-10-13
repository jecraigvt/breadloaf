import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { authCookieDomain, clearFamilyDeviceCookies, rememberFamilyDevice } from "./auth-cookies";

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
  try { run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const request = (url: string, headers?: HeadersInit) => new NextRequest(url, { headers });
const cookieHeaders = (response: NextResponse) => response.headers.getSetCookie();
const scoped = (cookies: string[], name: string, domain: boolean) => cookies.filter(cookie => cookie.startsWith(`${name}=`) && /; Domain=/i.test(cookie) === domain);

test("internal production URLs use only the trusted HTTPS property origin for cookie scope", () => {
  withEnvironment({ NODE_ENV: "production", APP_URL: "https://breadloafhill.com" }, () => {
    for (const hostname of ["breadloafhill.com", "www.breadloafhill.com", "localhost", "127.0.0.1", "[::1]", "0.0.0.0"]) {
      assert.equal(authCookieDomain(request(`http://${hostname}:3000/api/auth/link/redeem`)), ".breadloafhill.com");
    }
    assert.equal(authCookieDomain(request("https://other.example.test/api/auth", { "x-forwarded-host": "breadloafhill.com" })), undefined);
  });
  for (const site of [undefined, "not-a-url", "http://breadloafhill.com", "https://breadloafhill.com.attacker.example", "https://user:pass@breadloafhill.com", "http://127.0.0.1:3000"]) {
    withEnvironment({ NODE_ENV: "production", APP_URL: site }, () => {
      assert.equal(authCookieDomain(request("http://localhost:3000/api/auth", { "x-forwarded-host": "breadloafhill.com" })), undefined);
    });
  }
  withEnvironment({ NODE_ENV: "development", APP_URL: "https://breadloafhill.com" }, () => {
    assert.equal(authCookieDomain(request("http://localhost:3000/api/auth")), undefined);
  });
});

test("remembering a proxied device replaces domain tokens and expires duplicate host-only identities", () => {
  withEnvironment({ NODE_ENV: "production", APP_URL: "https://breadloafhill.com" }, () => {
    const response = NextResponse.json({ success: true });
    rememberFamilyDevice(response, request("http://localhost:3000/api/auth/link/redeem"), "synthetic-remembered-token");
    const cookies = cookieHeaders(response);
    assert.equal(scoped(cookies, "breadloaf_session", true).length, 1);
    assert.match(scoped(cookies, "breadloaf_session", true)[0], /^breadloaf_session=v3\.synthetic-remembered-token;/);
    assert.match(scoped(cookies, "breadloaf_session", true)[0], /Domain=\.breadloafhill\.com/);
    assert.match(scoped(cookies, "breadloaf_session", true)[0], /Max-Age=31536000/);
    for (const attribute of [/; HttpOnly/i, /; Secure/i, /; SameSite=lax/i]) assert.match(scoped(cookies, "breadloaf_session", true)[0], attribute);
    assert.match(scoped(cookies, "breadloaf_identity", true)[0], /^breadloaf_identity=synthetic-remembered-token;/);
    for (const name of ["breadloaf_session", "breadloaf_identity", "breadloaf_identity_skipped", "breadloaf_auth"]) {
      assert.equal(scoped(cookies, name, false).length, 1);
      assert.match(scoped(cookies, name, false)[0], /Max-Age=0/);
    }
    assert.match(scoped(cookies, "breadloaf_auth", true)[0], /Max-Age=0/);
  });
});

test("logout expires current and legacy cookies at both scopes behind the proxy", () => {
  withEnvironment({ NODE_ENV: "production", APP_URL: "https://breadloafhill.com" }, () => {
    const response = NextResponse.json({ success: true });
    clearFamilyDeviceCookies(response, request("http://localhost:3000/api/auth"));
    const cookies = cookieHeaders(response);
    for (const name of ["breadloaf_session", "breadloaf_identity", "breadloaf_identity_skipped", "breadloaf_auth"]) {
      for (const domain of [false, true]) {
        assert.equal(scoped(cookies, name, domain).length, 1);
        assert.match(scoped(cookies, name, domain)[0], /Max-Age=0/);
      }
    }
  });
});

test("local fake-mail deployments continue to issue host-only remembered cookies", () => {
  withEnvironment({ NODE_ENV: "production", APP_URL: "http://127.0.0.1:3000" }, () => {
    const response = NextResponse.json({ success: true });
    rememberFamilyDevice(response, request("http://127.0.0.1:3000/api/auth/link/redeem"), "synthetic-local-token");
    const cookies = cookieHeaders(response);
    assert.ok(cookies.every(cookie => !/; Domain=/i.test(cookie)));
    assert.equal(scoped(cookies, "breadloaf_session", false).length, 1);
    assert.match(scoped(cookies, "breadloaf_session", false)[0], /^breadloaf_session=v3\.synthetic-local-token;/);
  });
});
