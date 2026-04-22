import { NextRequest, NextResponse } from "next/server";
import {
  getAuthCookieName,
  getFamilyFromAuthToken,
  getFamilyFromCalendarFeedToken,
} from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // If no FAMILY_PINS configured, skip auth (local dev convenience)
  if (!process.env.FAMILY_PINS) {
    return NextResponse.next();
  }

  const authenticatedFamily = getFamilyFromAuthToken(
    request.cookies.get(getAuthCookieName())?.value
  );

  // The shared calendar feed accepts a scoped token so calendar apps can
  // subscribe without exposing the entire site anonymously.
  if (pathname === "/api/calendar") {
    if (authenticatedFamily) {
      return NextResponse.next();
    }

    const feedToken = request.nextUrl.searchParams.get("token");
    const tokenFamily = await getFamilyFromCalendarFeedToken(feedToken);
    if (tokenFamily) {
      return NextResponse.next();
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Public routes — no auth required
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/photos") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (!authenticatedFamily) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
