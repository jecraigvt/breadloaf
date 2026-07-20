import { NextRequest, NextResponse } from "next/server";
import {
  accountsVaultConfigured,
  accountsVaultEncryptionParameters,
  createAccountsVaultToken,
  getAccountsVaultCookieName,
  verifyAccountsVaultPassword,
} from "@/lib/accounts-vault-auth";

const attempts = new Map<string, { count: number; resetAt: number }>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function clientAddress(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function cookieDomain(request: NextRequest): string | undefined {
  const host = request.nextUrl.hostname.toLowerCase();
  return host.endsWith("breadloafhill.com") ? ".breadloafhill.com" : undefined;
}

export async function POST(request: NextRequest) {
  if (!(await accountsVaultConfigured())) {
    return NextResponse.json({ error: "Accounts vault is not configured" }, { status: 503 });
  }

  const address = clientAddress(request);
  const now = Date.now();
  const current = attempts.get(address);
  const attempt = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + ATTEMPT_WINDOW_MS }
    : current;

  if (attempt.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json();
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyAccountsVaultPassword(password))) {
    attempt.count += 1;
    attempts.set(address, attempt);
    return NextResponse.json({ error: "Incorrect vault passphrase" }, { status: 401 });
  }

  attempts.delete(address);
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
