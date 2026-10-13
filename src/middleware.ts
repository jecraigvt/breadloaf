import { NextRequest, NextResponse } from "next/server";
import { getAuthCookieName, getFamilyFromCalendarFeedToken } from "@/lib/auth";
import { getDoorFamily } from "@/lib/actor";
import { canonicalSiteUrl, emailSignInEnabled, REMEMBERED_TOKEN_PREFIX } from "@/lib/sign-in-policy";
import { rememberFamilyDevice } from "@/lib/auth-cookies";

const workerRoute = /^\/api\/bucky\/worker\/(claim|heartbeat|complete|fail|source|yield|run-api|artifact)$/;
function publicSiteOrigin(request: NextRequest): string {
  return !process.env.APP_URL && process.env.NODE_ENV !== "production" ? request.nextUrl.origin : canonicalSiteUrl();
}
function publicPath(path: string) {
  return ["/login", "/login/confirm", "/login/request-access", "/emergency", "/guide", "/weather", "/manifest.json", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.ico", "/smoothproof", "/smoothproof/index.html"].includes(path) ||
    /^\/smoothproof-assets\/(style\.css|new-york-sour\.webp|wine-float\.webp)$/.test(path) ||
    path === "/api/auth" || path.startsWith("/api/auth/") || path.startsWith("/photos/") || path.startsWith("/_next/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Scoped service credentials are verified by these exact Node handlers.
  if (workerRoute.test(pathname) || pathname === "/api/operations/run" || pathname === "/api/archive/backup") return NextResponse.next();

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    // Next's internal origin may be localhost behind Railway's reverse proxy.
    // Validate against the configured public site, never a forwarded caller host.
    let siteOrigin: string;
    try { siteOrigin = publicSiteOrigin(request); }
    catch { return NextResponse.json({ error: "Site address is not configured correctly." }, { status: 503 }); }
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== siteOrigin)) {
      return NextResponse.json({ error: "Open Breadloaf Hill before making this change." }, { status: 403 });
    }
  }
  if (publicPath(pathname)) return NextResponse.next();

  const local = process.env.NODE_ENV !== "production" && !process.env.FAMILY_PINS && !emailSignInEnabled();
  if (!local && !process.env.FAMILY_PINS && !emailSignInEnabled()) {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Site authentication is not configured" }, { status: 503 })
      : new NextResponse("Family access is temporarily unavailable.", { status: 503 });
  }
  let family: string | null = local ? "local-dev" : null;
  try { if (!local) family = await getDoorFamily(request); }
  catch { return NextResponse.json({ error: "Family access is temporarily unavailable" }, { status: 503 }); }

  if (!family && pathname === "/api/calendar" && ["GET", "HEAD"].includes(request.method)) {
    if (await getFamilyFromCalendarFeedToken(request.nextUrl.searchParams.get("token"))) return NextResponse.next();
  }
  if (!family) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let login: URL;
    try { login = new URL("/login", publicSiteOrigin(request)); }
    catch { return new NextResponse("Family access is temporarily unavailable.", { status: 503 }); }
    login.searchParams.set("from", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  let response: NextResponse;
  if (pathname.startsWith("/uploads/")) {
    const protectedUrl = request.nextUrl.clone();
    protectedUrl.pathname = `/api/retained-files/${pathname.slice("/uploads/".length)}`;
    response = NextResponse.rewrite(protectedUrl);
  } else response = NextResponse.next();
  const token = request.cookies.get(getAuthCookieName())?.value;
  if (token?.startsWith(REMEMBERED_TOKEN_PREFIX)) rememberFamilyDevice(response, request, token.slice(REMEMBERED_TOKEN_PREFIX.length));
  return response;
}

export const config = { runtime: "nodejs", matcher: ["/((?!_next/static|favicon.ico).*)"] };
