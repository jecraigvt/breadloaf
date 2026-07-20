import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ACCOUNTS_VAULT_ID,
  accountsVaultConfigured,
  accountsVaultEncryptionParameters,
  createAccountsVaultToken,
  getAccountsVaultCookieName,
  hashAccountsVaultPassword,
} from "@/lib/accounts-vault-auth";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";

function cookieDomain(request: NextRequest): string | undefined {
  return request.nextUrl.hostname.toLowerCase().endsWith("breadloafhill.com")
    ? ".breadloafhill.com"
    : undefined;
}

export async function POST(request: NextRequest) {
  if (await accountsVaultConfigured()) {
    return NextResponse.json({ error: "Corporation vault is already configured" }, { status: 409 });
  }

  const body = await request.json();
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 14) {
    return NextResponse.json({ error: "Use a passphrase of at least 14 characters" }, { status: 400 });
  }
  const changedBy =
    (await getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value)) ||
    "Family member";

  try {
    await prisma.vaultConfiguration.create({
      data: {
        id: ACCOUNTS_VAULT_ID,
        passwordHash: await hashAccountsVaultPassword(password),
        createdBy: changedBy,
        updatedBy: changedBy,
      },
    });
  } catch {
    return NextResponse.json({ error: "Corporation vault is already configured" }, { status: 409 });
  }

  await recordBuckyLedgerEntry({
    actionType: "configure_corporation_vault",
    summary: "Configured the encrypted corporation vault",
    initiatedBy: changedBy,
    entityType: "vault_configuration",
    entityId: ACCOUNTS_VAULT_ID,
  });

  const token = await createAccountsVaultToken();
  const response = NextResponse.json({
    success: true,
    encryption: accountsVaultEncryptionParameters(),
  });
  if (token) {
    response.cookies.set(getAccountsVaultCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 60,
      path: "/",
      domain: cookieDomain(request),
    });
  }
  return response;
}
