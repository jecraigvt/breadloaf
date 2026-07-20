import { prisma } from "@/lib/prisma";

const VAULT_COOKIE_NAME = "breadloaf_accounts_vault";
export const ACCOUNTS_VAULT_ID = "corporate-accounts";
const TOKEN_PREFIX = "breadloaf-accounts-vault:v1";
const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const HASH_ITERATIONS = 310_000;
const ENCRYPTION_ITERATIONS = 600_000;
const ENCRYPTION_SALT = "breadloaf-hill-corporation-vault-encryption-v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function valuesMatch(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))
  );
}

async function configuredHash(): Promise<string | null> {
  const configuration = await prisma.vaultConfiguration.findUnique({
    where: { id: ACCOUNTS_VAULT_ID },
    select: { passwordHash: true },
  });
  return configuration?.passwordHash || null;
}

async function sessionSecret(): Promise<string | null> {
  return process.env.AUTH_SECRET?.trim() || configuredHash();
}

export function getAccountsVaultCookieName(): string {
  return VAULT_COOKIE_NAME;
}

export async function accountsVaultConfigured(): Promise<boolean> {
  return Boolean(await configuredHash());
}

export function accountsVaultEncryptionParameters() {
  return {
    salt: toBase64Url(new TextEncoder().encode(ENCRYPTION_SALT)),
    iterations: ENCRYPTION_ITERATIONS,
    version: 1,
  };
}

export async function hashAccountsVaultPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, HASH_ITERATIONS);
  return `pbkdf2-sha256$${HASH_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyAccountsVaultPassword(password: string): Promise<boolean> {
  const encoded = await configuredHash();
  if (!encoded || !password) return false;

  try {
    const [algorithm, rawIterations, rawSalt, rawHash] = encoded.split("$");
    if (algorithm !== "pbkdf2-sha256") return false;
    const iterations = Number(rawIterations);
    if (!Number.isInteger(iterations) || iterations < 100_000 || !rawSalt || !rawHash) return false;
    const actual = await derivePasswordHash(password, fromBase64Url(rawSalt), iterations);
    return valuesMatch(actual, fromBase64Url(rawHash));
  } catch {
    return false;
  }
}

export async function createAccountsVaultToken(): Promise<string | null> {
  const secret = await sessionSecret();
  if (!secret) return null;
  const payload = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ version: 1, expiresAt: Date.now() + SESSION_LIFETIME_MS }))
  );
  return `${payload}.${await sign(`${TOKEN_PREFIX}:${payload}`, secret)}`;
}

export async function validateAccountsVaultToken(token?: string | null): Promise<boolean> {
  const secret = await sessionSecret();
  if (!secret || !token) return false;

  try {
    const [payload, providedSignature] = token.split(".", 2);
    if (!payload || !providedSignature) return false;
    const expectedSignature = await sign(`${TOKEN_PREFIX}:${payload}`, secret);
    if (!valuesMatch(new TextEncoder().encode(providedSignature), new TextEncoder().encode(expectedSignature))) {
      return false;
    }
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      version?: number;
      expiresAt?: number;
    };
    return parsed.version === 1 && Boolean(parsed.expiresAt && parsed.expiresAt > Date.now());
  } catch {
    return false;
  }
}
