import { NextRequest, NextResponse } from "next/server";
import {
  createAuthToken,
  getAuthCookieName,
  getFamilyFromAuthToken,
  getFamilyPins,
} from "@/lib/auth";

// Share the session across www.breadloafhill.com and the bare domain —
// they're separate hosts, so a host-only cookie set on one 401s the other.
function cookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get("host") || "";
  return host.endsWith("breadloafhill.com") ? ".breadloafhill.com" : undefined;
}

// POST — Login: validate PIN, set cookie
export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json();

    if (!pin) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 });
    }

    const pinMap = getFamilyPins();
    const family = pinMap[String(pin)];

    if (!family) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // Create a token: base64(family:pin)
    const token = createAuthToken(family, String(pin));

    const response = NextResponse.json({ family });
    response.cookies.set(getAuthCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
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
  const family = getFamilyFromAuthToken(
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
