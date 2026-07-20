import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountsVaultCookieName, validateAccountsVaultToken } from "@/lib/accounts-vault-auth";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";

const SECRET_FIELD_PATTERN = /(password|passphrase|secret|recovery.?code|token|api.?key)/i;
const ENCRYPTED_FIELDS = new Set(["encryptedSecret", "secretIv", "encryptionVersion"]);

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function accountEnding(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(-4) : null;
}

function safeLoginUrl(value: unknown): string | null | undefined {
  const cleaned = optionalText(value, 500);
  if (cleaned === undefined || cleaned === null) return cleaned;
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function actor(request: NextRequest): Promise<string> {
  return (
    (await getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value)) ||
    "Family member"
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await validateAccountsVaultToken(request.cookies.get(getAccountsVaultCookieName())?.value))) {
    return NextResponse.json({ error: "Vault unlock required" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ENCRYPTED_FIELDS.has(key) && SECRET_FIELD_PATTERN.test(key))) {
    return NextResponse.json(
      { error: "Plaintext passwords, tokens, and recovery codes are not accepted" },
      { status: 400 }
    );
  }
  const includesEncryptedUpdate = ["encryptedSecret", "secretIv", "encryptionVersion"].some(
    (key) => key in body
  );
  if (
    includesEncryptedUpdate &&
    (!optionalText(body.encryptedSecret, 20_000) ||
      !optionalText(body.secretIv, 100) ||
      body.encryptionVersion !== 1)
  ) {
    return NextResponse.json({ error: "Encrypted credential update is incomplete" }, { status: 400 });
  }

  const changedBy = await actor(request);
  const existing = await prisma.corporateAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const serviceName = optionalText(body.serviceName, 120);
  const category = optionalText(body.category, 50);
  if (serviceName === null || category === null) {
    return NextResponse.json({ error: "Service name and category cannot be empty" }, { status: 400 });
  }

  const account = await prisma.corporateAccount.update({
    where: { id },
    data: {
      serviceName,
      category,
      loginUrl: safeLoginUrl(body.loginUrl),
      username: optionalText(body.username, 200),
      accountNumberLast4: accountEnding(body.accountNumberLast4),
      responsiblePerson: optionalText(body.responsiblePerson, 120),
      recoveryContact: optionalText(body.recoveryContact, 200),
      notes: optionalText(body.notes, 2000),
      encryptedSecret: optionalText(body.encryptedSecret, 20_000),
      secretIv: optionalText(body.secretIv, 100),
      encryptionVersion: body.encryptionVersion === 1 ? 1 : undefined,
      updatedBy: changedBy,
    },
  });

  await recordBuckyLedgerEntry({
    actionType: "update_corporate_account",
    summary: `Updated corporation account: ${account.serviceName}`,
    initiatedBy: changedBy,
    entityType: "corporate_account",
    entityId: account.id,
    reversible: true,
  });
  return NextResponse.json(account);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await validateAccountsVaultToken(request.cookies.get(getAccountsVaultCookieName())?.value))) {
    return NextResponse.json({ error: "Vault unlock required" }, { status: 401 });
  }
  const { id } = await params;
  const changedBy = await actor(request);
  const existing = await prisma.corporateAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const account = await prisma.corporateAccount.update({
    where: { id },
    data: { status: "archived", updatedBy: changedBy },
  });
  await recordBuckyLedgerEntry({
    actionType: "archive_corporate_account",
    summary: `Archived corporation account: ${account.serviceName}`,
    initiatedBy: changedBy,
    entityType: "corporate_account",
    entityId: account.id,
    reversible: true,
  });
  return NextResponse.json(account);
}
