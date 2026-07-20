import { NextRequest, NextResponse } from "next/server";
import {
  createAuthToken,
  getAuthCookieName,
  getFamilyFromAuthToken,
  getFamilyPins,
} from "@/lib/auth";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function attemptState(request: NextRequest) {
  const key = clientKey(request);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(key, fresh);
    return { key, state: fresh };
  }
  return { key, state: current };
}

// Share the session across www.breadloafhill.com and the bare domain —
// they're separate hosts, so a host-only cookie set on one 401s the other.
function cookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get("host") || "";
  return host.endsWith("breadloafhill.com") ? ".breadloafhill.com" : undefined;
}

// POST — Login: validate PIN, set cookie
export async function POST(request: NextRequest) {
  try {
    const { key, state } = attemptState(request);
    if (state.count >= MAX_LOGIN_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((state.resetAt - Date.now()) / 1000)) } }
      );
    }
    const { pin } = await request.json();

    if (!pin) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 });
    }

    const pinMap = getFamilyPins();
    const family = pinMap[String(pin)];

    if (!family) {
      state.count += 1;
      loginAttempts.set(key, state);
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    const token = await createAuthToken(family);
    if (!token) return NextResponse.json({ error: "Login is not configured" }, { status: 500 });
    loginAttempts.delete(key);

    const response = NextResponse.json({ family });
    response.cookies.set(getAuthCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      domain: cookieDomain(request),
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

// GET — Check auth status
export async function GET(request: NextRequest) {
  const family = await getFamilyFromAuthToken(
    request.cookies.get(getAuthCookieName())?.value
  );

  if (family) {
    return NextResponse.json({ authenticated: true, family });
  }

  return NextResponse.json({ authenticated: false }, { status: 401 });
}

// DELETE — Logout
export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(getAuthCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
    domain: cookieDomain(request),
  });
  return response;
}
