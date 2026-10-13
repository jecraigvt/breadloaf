import type { NextRequest, NextResponse } from "next/server";
import { getAuthCookieName, getLegacyAuthCookieName } from "@/lib/auth";
import { getIdentityCookieName, getIdentitySkipCookieName } from "@/lib/actor";
import { REMEMBERED_DEVICE_MS, REMEMBERED_TOKEN_PREFIX } from "@/lib/sign-in-policy";

export function authCookieDomain(request: NextRequest): string | undefined {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return hostname === "breadloafhill.com" || hostname.endsWith(".breadloafhill.com") ? ".breadloafhill.com" : undefined;
}
const base = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });

export function rememberFamilyDevice(response: NextResponse, request: NextRequest, token: string) {
  const options = { ...base(), domain: authCookieDomain(request), maxAge: Math.floor(REMEMBERED_DEVICE_MS / 1000) };
  response.cookies.set(getAuthCookieName(), `${REMEMBERED_TOKEN_PREFIX}${token}`, options);
  response.cookies.set(getIdentityCookieName(), token, options);
  response.cookies.set(getIdentitySkipCookieName(), "", { ...options, maxAge: 0 });
  clearLegacyDoorCookies(response, request);
}

export function clearLegacyDoorCookies(response: NextResponse, request: NextRequest) {
  const secure = process.env.NODE_ENV === "production";
  const cookie = `${getLegacyAuthCookieName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  response.headers.append("Set-Cookie", cookie);
  const domain = authCookieDomain(request);
  if (domain) response.headers.append("Set-Cookie", `${cookie}; Domain=${domain}`);
}

export function clearFamilyDeviceCookies(response: NextResponse, request: NextRequest) {
  for (const name of [getAuthCookieName(), getIdentityCookieName(), getIdentitySkipCookieName()]) {
    response.cookies.set(name, "", { ...base(), domain: authCookieDomain(request), maxAge: 0 });
    if (authCookieDomain(request)) response.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  clearLegacyDoorCookies(response, request);
}
