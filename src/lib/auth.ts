const AUTH_COOKIE_NAME = "breadloaf_auth";
const CALENDAR_FEED_TOKEN_PREFIX = "calendar-feed:v1";

function getFamilyPinsRaw(): string {
  return process.env.FAMILY_PINS || "";
}

export function getFamilyPins(): Record<string, string> {
  const raw = getFamilyPinsRaw();
  const pins: Record<string, string> = {};

  for (const entry of raw.split(",")) {
    const [name, pin] = entry.split(":").map((s) => s.trim());
    if (name && pin) {
      pins[pin] = name;
    }
  }

  return pins;
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

export function createAuthToken(family: string, pin: string): string {
  return btoa(`${family}:${pin}`);
}

export function getFamilyFromAuthToken(token?: string | null): string | null {
  if (!token) return null;

  try {
    const decoded = atob(token);
    const [family, pin] = decoded.split(":");
    const pinMap = getFamilyPins();
    return pinMap[pin] === family ? family : null;
  } catch {
    return null;
  }
}

function getCalendarFeedSecret(): string | null {
  const secret = getFamilyPinsRaw();
  return secret ? secret : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signCalendarFeedValue(value: string): Promise<string | null> {
  const secret = getCalendarFeedSecret();
  if (!secret) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return toBase64Url(new Uint8Array(signature));
}

export async function createCalendarFeedToken(
  family: string
): Promise<string | null> {
  if (!family) return null;

  const payload = `${CALENDAR_FEED_TOKEN_PREFIX}:${family}`;
  const signature = await signCalendarFeedValue(payload);
  if (!signature) return null;

  return `${encodeURIComponent(family)}.${signature}`;
}

export async function getFamilyFromCalendarFeedToken(
  token?: string | null
): Promise<string | null> {
  if (!token) return null;

  const [encodedFamily, providedSignature] = token.split(".", 2);
  if (!encodedFamily || !providedSignature) return null;

  let family: string;
  try {
    family = decodeURIComponent(encodedFamily);
  } catch {
    return null;
  }

  const expectedSignature = await signCalendarFeedValue(
    `${CALENDAR_FEED_TOKEN_PREFIX}:${family}`
  );

  if (!expectedSignature || expectedSignature !== providedSignature) {
    return null;
  }

  return family;
}
