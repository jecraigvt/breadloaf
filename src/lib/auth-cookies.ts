import type { NextRequest, NextResponse } from "next/server";
import { getAuthCookieName, getLegacyAuthCookieName } from "@/lib/auth";
import { getIdentityCookieName, getIdentitySkipCookieName } from "@/lib/actor";
import { REMEMBERED_DEVICE_MS, REMEMBERED_TOKEN_PREFIX } from "@/lib/sign-in-policy";

export function authCookieDomain(request: NextRequest): string | undefined {
  const hostname = request.nextUrl.hostname.toLowerCase();
  const propertyHost = (value: string) => value === "breadloafhill.com" || value.endsWith(".breadloafhill.com");
  if (propertyHost(hostname)) return ".breadloafhill.com";
  // Railway can expose its internal loopback URL to Next. Use the configured
  // public origin so the new token replaces the older domain-scoped PIN token.
  // Caller-controlled Host/forwarded-host values never supply this fallback.
  if (process.env.NODE_ENV !== "production" || !["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname)) return undefined;
  try {
    const site = new URL(process.env.APP_URL || "");
    return site.protocol === "https:" && !site.username && !site.password && propertyHost(site.hostname)
      ? ".breadloafhill.com" : undefined;
  } catch { return undefined; }
}
const base = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });
const expiredHostOnlyCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export function rememberFamilyDevice(response: NextResponse, request: NextRequest, token: string) {
  const options = { ...base(), domain: authCookieDomain(request), maxAge: Math.floor(REMEMBERED_DEVICE_MS / 1000) };
  response.cookies.set(getAuthCookieName(), `${REMEMBERED_TOKEN_PREFIX}${token}`, options);
  response.cookies.set(getIdentityCookieName(), token, options);
  response.cookies.set(getIdentitySkipCookieName(), "", { ...options, maxAge: 0 });
  if (options.domain) {
    // A prior proxied login may already have created host-only cookies with the
    // same names. Expire those separately; Next's cookie map stores one per name.
    for (const name of [getAuthCookieName(), getIdentityCookieName(), getIdentitySkipCookieName()]) {
      response.headers.append("Set-Cookie", expiredHostOnlyCookie(name));
    }
  }
  clearLegacyDoorCookies(response, request);
}

export function clearLegacyDoorCookies(response: NextResponse, request: NextRequest) {
  const cookie = expiredHostOnlyCookie(getLegacyAuthCookieName());
  response.headers.append("Set-Cookie", cookie);
  const domain = authCookieDomain(request);
  if (domain) response.headers.append("Set-Cookie", `${cookie}; Domain=${domain}`);
}

export function clearFamilyDeviceCookies(response: NextResponse, request: NextRequest) {
  const domain = authCookieDomain(request);
  const names = [getAuthCookieName(), getIdentityCookieName(), getIdentitySkipCookieName()];
  for (const name of names) {
    response.cookies.set(name, "", { ...base(), domain, maxAge: 0 });
  }
  // Finish cookie-map writes before appending duplicates: another .set() would
  // rebuild Set-Cookie from the map and discard previous manual host expirations.
  if (domain) for (const name of names) response.headers.append("Set-Cookie", expiredHostOnlyCookie(name));
  clearLegacyDoorCookies(response, request);
}
