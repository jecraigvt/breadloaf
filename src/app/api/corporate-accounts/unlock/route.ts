import { NextRequest, NextResponse } from "next/server";
import {
  accountsVaultConfigured,
  accountsVaultEncryptionParameters,
  createAccountsVaultToken,
  getAccountsVaultCookieName,
  verifyAccountsVaultPassword,
} from "@/lib/accounts-vault-auth";
import { authClientKey, consumeAuthAttempt } from "@/lib/auth-rate-limit";
import { requestAccessContext, accessPolicyResponse } from "@/lib/access-policy";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function cookieDomain(request: NextRequest): string | undefined {
  const host = request.nextUrl.hostname.toLowerCase();
  return host.endsWith("breadloafhill.com") ? ".breadloafhill.com" : undefined;
}

export async function POST(request: NextRequest) {
 try {
  await requestAccessContext(request);
  if (!(await accountsVaultConfigured())) {
    return NextResponse.json({ error: "Accounts vault is not configured" }, { status: 503 });
  }

  if (!(await consumeAuthAttempt(`vault-unlock:${authClientKey(request)}`, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json();
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyAccountsVaultPassword(password))) {
    return NextResponse.json({ error: "Incorrect vault passphrase" }, { status: 401 });
  }

  const token = await createAccountsVaultToken();
  if (!token) return NextResponse.json({ error: "Vault session unavailable" }, { status: 503 });

  const response = NextResponse.json({
    success: true,
    encryption: accountsVaultEncryptionParameters(),
  });
  response.cookies.set(getAccountsVaultCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 60,
    path: "/",
    domain: cookieDomain(request),
  });
  return response;
 } catch (error) {
  return accessPolicyResponse(error) || NextResponse.json({ error: "Vault unlock is unavailable" }, { status: 503 });
 }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(getAccountsVaultCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
    domain: cookieDomain(request),
  });
  return response;
}
