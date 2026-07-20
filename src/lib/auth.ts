const AUTH_COOKIE_NAME = "breadloaf_auth";
const AUTH_TOKEN_PREFIX = "breadloaf-session:v2";
const CALENDAR_FEED_TOKEN_PREFIX = "calendar-feed:v1";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function getFamilyPinsRaw(): string {
  return process.env.FAMILY_PINS || "";
}

function getAuthSecret(): string | null {
  return process.env.AUTH_SECRET || getFamilyPinsRaw() || null;
}

export function getFamilyPins(): Record<string, string> {
  const raw = getFamilyPinsRaw();
  const pins: Record<string, string> = {};

  for (const entry of raw.split(",")) {
    const [name, pin] = entry.split(":").map((value) => value.trim());
    if (name && pin) pins[pin] = name;
  }

  return pins;
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function signaturesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function createAuthToken(family: string): Promise<string | null> {
  const secret = getAuthSecret();
  if (!secret || !family) return null;

  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ version: 2, family, expiresAt: Date.now() + SESSION_LIFETIME_MS })
    )
  );
  const signature = await signValue(`${AUTH_TOKEN_PREFIX}:${payload}`, secret);
  return `${payload}.${signature}`;
}

export async function getFamilyFromAuthToken(token?: string | null): Promise<string | null> {
  if (!token) return null;
  const secret = getAuthSecret();
  if (!secret) return null;

  try {
    const [payload, providedSignature] = token.split(".", 2);
    if (!payload || !providedSignature) return null;
    const expectedSignature = await signValue(`${AUTH_TOKEN_PREFIX}:${payload}`, secret);
    if (!signaturesMatch(providedSignature, expectedSignature)) return null;

    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      version?: number;
      family?: string;
      expiresAt?: number;
    };
    if (parsed.version !== 2 || !parsed.family || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      return null;
    }

    return Object.values(getFamilyPins()).includes(parsed.family) ? parsed.family : null;
  } catch {
    return null;
  }
}

function getCalendarFeedSecret(): string | null {
  return process.env.CALENDAR_FEED_SECRET || getFamilyPinsRaw() || null;
}

async function signCalendarFeedValue(value: string): Promise<string | null> {
  const secret = getCalendarFeedSecret();
  return secret ? signValue(value, secret) : null;
}

export async function createCalendarFeedToken(family: string): Promise<string | null> {
  if (!family) return null;
  const payload = `${CALENDAR_FEED_TOKEN_PREFIX}:${family}`;
  const signature = await signCalendarFeedValue(payload);
  return signature ? `${encodeURIComponent(family)}.${signature}` : null;
}

export async function getFamilyFromCalendarFeedToken(token?: string | null): Promise<string | null> {
  if (!token) return null;
  const [encodedFamily, providedSignature] = token.split(".", 2);
  if (!encodedFamily || !providedSignature) return null;

  try {
    const family = decodeURIComponent(encodedFamily);
    const expectedSignature = await signCalendarFeedValue(`${CALENDAR_FEED_TOKEN_PREFIX}:${family}`);
    if (!expectedSignature || !signaturesMatch(providedSignature, expectedSignature)) return null;
    return family;
  } catch {
    return null;
  }
}
