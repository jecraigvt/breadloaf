import { NextRequest, NextResponse } from "next/server";
import { createAuthToken, getAuthCookieName, getFamilyPins } from "@/lib/auth";
import { getCurrentActor, getDoorFamily, getIdentityCookieName, revokeIdentitySession } from "@/lib/actor";
import { clearFamilyDeviceCookies, clearLegacyDoorCookies, authCookieDomain } from "@/lib/auth-cookies";
import { emailSignInEnabled, REMEMBERED_TOKEN_PREFIX } from "@/lib/sign-in-policy";
import { consumeAuthAttempt, authClientKey } from "@/lib/auth-rate-limit";
import { familyEmailConfigured } from "@/lib/family-sign-in-email";

function pinAvailable() { return Boolean(process.env.FAMILY_PINS) && (!emailSignInEnabled() || process.env.FAMILY_PIN_FALLBACK === "true"); }
export async function POST(request: NextRequest) {
  if (!pinAvailable()) return NextResponse.json({ error: "Use Send sign-in link to open Breadloaf Hill." }, { status: 410 });
  try {
    if (!await consumeAuthAttempt(`pin:${authClientKey(request)}`, 8, 15 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": "900" } });
    const { pin } = await request.json();
    const family = getFamilyPins()[String(pin)];
    if (!family) return NextResponse.json({ error: "That PIN was not recognized." }, { status: 401 });
    const token = await createAuthToken(family);
    if (!token) return NextResponse.json({ error: "Sign-in is not configured." }, { status: 503 });
    const response = NextResponse.json({ family });
    response.cookies.set(getAuthCookieName(), token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/", domain: authCookieDomain(request) });
    clearLegacyDoorCookies(response, request);
    return response;
  } catch { return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 }); }
}
export async function GET(request: NextRequest) {
  const family = await getDoorFamily(request);
  const actor = family ? await getCurrentActor(request) : null;
  return NextResponse.json({ authenticated: Boolean(family), family, actor, emailEnabled: emailSignInEnabled(), emailConfigured: familyEmailConfigured(), pinAvailable: pinAvailable() }, { status: family ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(request: NextRequest) {
  const door = request.cookies.get(getAuthCookieName())?.value;
  const identity = request.cookies.get(getIdentityCookieName())?.value;
  const tokens = new Set([door?.startsWith(REMEMBERED_TOKEN_PREFIX) ? door.slice(REMEMBERED_TOKEN_PREFIX.length) : null, identity].filter((token): token is string => Boolean(token)));
  for (const token of Array.from(tokens)) await revokeIdentitySession(token);
  const response = NextResponse.json({ success: true });
  clearFamilyDeviceCookies(response, request);
  return response;
}
