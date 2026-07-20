import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ACCOUNTS_VAULT_ID,
  createAccountsVaultToken,
  getAccountsVaultCookieName,
  hashAccountsVaultPassword,
  validateAccountsVaultToken,
} from "@/lib/accounts-vault-auth";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";

interface RotatedAccount {
  id: string;
  encryptedSecret: string;
  secretIv: string;
  encryptionVersion: 1;
}

function cookieDomain(request: NextRequest): string | undefined {
  return request.nextUrl.hostname.toLowerCase().endsWith("breadloafhill.com")
    ? ".breadloafhill.com"
    : undefined;
}

function validRotatedAccount(value: unknown): value is RotatedAccount {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.encryptedSecret === "string" &&
    item.encryptedSecret.length > 0 &&
    item.encryptedSecret.length <= 20_000 &&
    typeof item.secretIv === "string" &&
    item.secretIv.length > 0 &&
    item.secretIv.length <= 100 &&
    item.encryptionVersion === 1
  );
}

export async function POST(request: NextRequest) {
  if (!(await validateAccountsVaultToken(request.cookies.get(getAccountsVaultCookieName())?.value))) {
    return NextResponse.json({ error: "Vault unlock required" }, { status: 401 });
  }
  const body = await request.json();
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  const rotated: RotatedAccount[] = Array.isArray(body.accounts)
    ? body.accounts.filter(validRotatedAccount)
    : [];
  if (newPassword.length < 14) {
    return NextResponse.json({ error: "Use a passphrase of at least 14 characters" }, { status: 400 });
  }

  const current = await prisma.corporateAccount.findMany({
    where: { encryptedSecret: { not: null } },
    select: { id: true },
  });
  const rotatedIds = new Set(rotated.map((account: RotatedAccount) => account.id));
  if (
    rotated.length !== current.length ||
    rotatedIds.size !== rotated.length ||
    current.some((account: { id: string }) => !rotatedIds.has(account.id))
  ) {
    return NextResponse.json(
      { error: "Every encrypted credential must be re-encrypted before changing the passphrase" },
      { status: 400 }
    );
  }

  const changedBy =
    (await getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value)) ||
    "Family member";
  const passwordHash = await hashAccountsVaultPassword(newPassword);
  await prisma.$transaction([
    ...rotated.map((account: RotatedAccount) =>
      prisma.corporateAccount.update({
        where: { id: account.id },
        data: {
          encryptedSecret: account.encryptedSecret,
          secretIv: account.secretIv,
          encryptionVersion: 1,
          updatedBy: changedBy,
        },
      })
    ),
    prisma.vaultConfiguration.update({
      where: { id: ACCOUNTS_VAULT_ID },
      data: { passwordHash, updatedBy: changedBy },
    }),
  ]);

  await recordBuckyLedgerEntry({
    actionType: "rotate_corporation_vault_passphrase",
    summary: `Rotated the corporation vault passphrase and re-encrypted ${rotated.length} credential${rotated.length === 1 ? "" : "s"}`,
    initiatedBy: changedBy,
    entityType: "vault_configuration",
    entityId: ACCOUNTS_VAULT_ID,
  });

  const token = await createAccountsVaultToken();
  const response = NextResponse.json({ success: true });
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
