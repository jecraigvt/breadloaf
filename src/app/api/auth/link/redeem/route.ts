import { NextRequest, NextResponse } from "next/server";
import { redeemFamilySignInLink, SignInLinkError } from "@/lib/family-access";
import { rememberFamilyDevice } from "@/lib/auth-cookies";
import { emailSignInEnabled } from "@/lib/sign-in-policy";
import { consumeAuthAttempt, authClientKey } from "@/lib/auth-rate-limit";

export async function POST(request: NextRequest) {
  if (!emailSignInEnabled()) return NextResponse.json({ error: "Email sign-in is not available yet." }, { status: 503 });
  try {
    if (!await consumeAuthAttempt(`redeem-ip:${authClientKey(request)}`, 30, 15 * 60 * 1000)) return NextResponse.json({ error: "Please wait a few minutes before trying again." }, { status: 429 });
    const body = await request.json().catch(() => null);
    const result = await redeemFamilySignInLink(body?.token, request.headers.get("user-agent"));
    const response = NextResponse.json({ family: result.family, displayName: result.displayName, destination: result.destination }, { headers: { "Cache-Control": "no-store" } });
    rememberFamilyDevice(response, request, result.token);
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof SignInLinkError ? error.message : "Sign-in is temporarily unavailable. Please try again shortly." }, { status: error instanceof SignInLinkError ? 400 : 503 }); }
}
