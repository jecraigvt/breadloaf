import { NextRequest, NextResponse } from "next/server";

function getFamilyPins(): Record<string, string> {
  const raw = process.env.FAMILY_PINS || "";
  const pins: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [name, pin] = entry.split(":").map((s) => s.trim());
    if (name && pin) pins[pin] = name;
  }
  return pins;
}

function isAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get("breadloaf_auth")?.value;
  if (!token) return false;

  try {
    const decoded = atob(token);
    const [family, pin] = decoded.split(":");
    const pinMap = getFamilyPins();
    return pinMap[pin] === family;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth required
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/calendar") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/photos") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // If no FAMILY_PINS configured, skip auth (local dev convenience)
  if (!process.env.FAMILY_PINS) {
    return NextResponse.next();
  }

  // Check auth
  if (!isAuthenticated(request)) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
