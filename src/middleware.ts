import { NextRequest, NextResponse } from "next/server";
import {
  getAuthCookieName,
  getFamilyFromAuthToken,
  getFamilyFromCalendarFeedToken,
} from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // These exact routes use per-worker bearer credentials in their Node handlers.
  // Never make the family job management routes public through this exception.
  if (/^\/api\/bucky\/worker\/(claim|heartbeat|complete|fail|source|yield|run-api|artifact)$/.test(pathname)) {
    return NextResponse.next();
  }

  // Local development may run without family auth. Production must fail closed.
  if (!process.env.FAMILY_PINS) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Site authentication is not configured" },
        { status: 503 }
      );
    }
    return new NextResponse("Site authentication is not configured.", { status: 503 });
  }

  const authenticatedFamily = await getFamilyFromAuthToken(
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

  // Public routes — no auth required.
  //
  // The family tree is deliberately open so a first-time relative can find
  // themselves and claim a profile before they have been given a PIN. The tree API
  // withholds contact details, notes, and minors' surnames from unauthenticated
  // callers; the rest of /api/family (create, edit, delete) stays gated below.
  if (
    pathname === "/login" ||
    pathname === "/family" ||
    pathname === "/api/family/tree" ||
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
