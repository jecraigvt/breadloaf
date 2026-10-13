import { createHash, randomBytes } from "node:crypto";
import { localFamilyEmailTestTransport } from "./family-email-test-transport";
export { safeSignInDestination } from "./sign-in-destination";

export const REMEMBERED_DEVICE_MS = 365 * 24 * 60 * 60 * 1000;
export const SIGN_IN_LINK_MS = 20 * 60 * 1000;
export const REMEMBERED_TOKEN_PREFIX = "v3.";

export function normalizeSignInEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

export function createSignInSecret(): string { return randomBytes(32).toString("base64url"); }
export function validSignInSecret(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function hashSignInSecret(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function emailSignInEnabled(): boolean { return process.env.FAMILY_EMAIL_SIGN_IN_ENABLED === "true"; }

export function canonicalSiteUrl(): string {
  const candidate = process.env.APP_URL || "https://breadloafhill.com";
  const parsed = new URL(candidate);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const localTest = loopback && parsed.protocol === "http:" && Boolean(localFamilyEmailTestTransport());
  if (parsed.protocol !== "https:" && !((process.env.NODE_ENV !== "production" || localTest) && loopback && parsed.protocol === "http:")) throw new Error("APP_URL must use HTTPS");
  if (parsed.username || parsed.password) throw new Error("APP_URL must not contain credentials");
  return parsed.origin;
}
