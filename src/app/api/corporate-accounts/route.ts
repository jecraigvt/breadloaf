import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  accountsVaultConfigured,
  getAccountsVaultCookieName,
  validateAccountsVaultToken,
} from "@/lib/accounts-vault-auth";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";

const SECRET_FIELD_PATTERN = /(password|passphrase|secret|recovery.?code|token|api.?key)/i;
const ENCRYPTED_FIELDS = new Set(["encryptedSecret", "secretIv", "encryptionVersion"]);

async function authorized(request: NextRequest): Promise<boolean> {
  return validateAccountsVaultToken(request.cookies.get(getAccountsVaultCookieName())?.value);
}

async function actor(request: NextRequest): Promise<string> {
  return (
    (await getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value)) ||
    "Family member"
  );
}

function containsSecretFields(body: Record<string, unknown>): boolean {
  return Object.keys(body).some(
    (key) => !ENCRYPTED_FIELDS.has(key) && SECRET_FIELD_PATTERN.test(key)
  );
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function accountEnding(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(-4) : null;
}

function safeLoginUrl(value: unknown): string | null {
  const cleaned = optionalText(value, 500);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "true") {
    return NextResponse.json({ configured: await accountsVaultConfigured() });
  }
  if (!(await accountsVaultConfigured())) {
    return NextResponse.json({ error: "Accounts vault is not configured" }, { status: 503 });
  }
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Vault unlock required" }, { status: 401 });
  }

  const includeForRotation = request.nextUrl.searchParams.get("rotation") === "true";
  const showArchived = request.nextUrl.searchParams.get("archived") === "true";
  const accounts = await prisma.corporateAccount.findMany({
    where: includeForRotation
      ? { encryptedSecret: { not: null } }
      : { status: showArchived ? "archived" : "active" },
    orderBy: [{ category: "asc" }, { serviceName: "asc" }],
  });

  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  if (!(await accountsVaultConfigured())) {
    return NextResponse.json({ error: "Accounts vault is not configured" }, { status: 503 });
  }
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Vault unlock required" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  if (containsSecretFields(body)) {
    return NextResponse.json(
      { error: "Plaintext passwords, tokens, and recovery codes are not accepted" },
      { status: 400 }
    );
  }

  const serviceName = optionalText(body.serviceName, 120);
  if (!serviceName) return NextResponse.json({ error: "Service name is required" }, { status: 400 });
  const encryptedSecret = optionalText(body.encryptedSecret, 20_000);
  const secretIv = optionalText(body.secretIv, 100);
  if (!encryptedSecret || !secretIv || body.encryptionVersion !== 1) {
    return NextResponse.json({ error: "An encrypted credential is required" }, { status: 400 });
  }
  const changedBy = await actor(request);
  const account = await prisma.corporateAccount.create({
    data: {
      serviceName,
      category: optionalText(body.category, 50) || "utility",
      loginUrl: safeLoginUrl(body.loginUrl),
      username: optionalText(body.username, 200),
      accountNumberLast4: accountEnding(body.accountNumberLast4),
      responsiblePerson: optionalText(body.responsiblePerson, 120),
      recoveryContact: optionalText(body.recoveryContact, 200),
      notes: optionalText(body.notes, 2000),
      encryptedSecret,
      secretIv,
      encryptionVersion: 1,
      createdBy: changedBy,
      updatedBy: changedBy,
    },
  });

  await recordBuckyLedgerEntry({
    actionType: "add_corporate_account",
    summary: `Added ${account.serviceName} to the corporation account directory`,
    initiatedBy: changedBy,
    entityType: "corporate_account",
    entityId: account.id,
    reversible: false,
  });

  return NextResponse.json(account, { status: 201 });
}
