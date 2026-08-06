import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";

/**
 * Who is acting, resolved server-side.
 *
 * Two independent layers, deliberately:
 *
 *  1. The DOOR — the existing shared FAMILY_PINS cookie. This is the security
 *     boundary; it is what keeps strangers out, and it is unchanged.
 *  2. IDENTITY — which family member this device belongs to, claimed by tapping a
 *     face in the tree. Inside the family this is a convenience claim, not a secret,
 *     so v1 has no per-person credential at all.
 *
 * Because the door already stops outsiders, identity can be frictionless now and
 * hardened later per person: setting a FamilyCredential locks that one profile so
 * re-tapping it requires the PIN, while everyone else keeps tapping. No flag day.
 *
 * Attribution must come from here — never from a name in a request body or from
 * localStorage["breadloaf-username"].
 */

const IDENTITY_COOKIE_NAME = "breadloaf_identity";
const IDENTITY_SKIP_COOKIE_NAME = "breadloaf_identity_skipped";
const IDENTITY_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface ActorContext {
  memberId: string;
  displayName: string;
  fullName: string;
  branch: string | null;
  boardRole: string | null;
  isBoardMember: boolean;
  isCurator: boolean;
}

export function getIdentityCookieName(): string {
  return IDENTITY_COOKIE_NAME;
}

export function getIdentitySkipCookieName(): string {
  return IDENTITY_SKIP_COOKIE_NAME;
}

export function getIdentityLifetimeMs(): number {
  return IDENTITY_LIFETIME_MS;
}

/** Has this device been through the shared-PIN door? Returns the branch label. */
export async function getDoorFamily(request: NextRequest): Promise<string | null> {
  // Local dev runs without FAMILY_PINS; middleware already allows it through.
  if (!process.env.FAMILY_PINS) return "local-dev";
  return getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createIdentityToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Tokens are stored hashed so a database read cannot resurrect a live session. */
export async function hashIdentityToken(token: string): Promise<string> {
  const secret = process.env.AUTH_SECRET || process.env.FAMILY_PINS || "breadloaf";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Resolve the acting member. Returns null when the device has not claimed an
 * identity yet — callers decide whether that is fatal.
 */
export async function getCurrentActor(request: NextRequest): Promise<ActorContext | null> {
  const token = request.cookies.get(IDENTITY_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = await hashIdentityToken(token);
  const session = await prisma.familySession.findUnique({
    where: { tokenHash },
    include: { member: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  // Touched at most once an hour so an ordinary page load is not a write.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (session.lastUsedAt < hourAgo) {
    await prisma.familySession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  }

  const member = session.member;
  return {
    memberId: member.id,
    displayName: member.displayName?.trim() || member.name.split(" ")[0],
    fullName: member.name,
    branch: member.branch,
    boardRole: member.boardRole,
    isBoardMember: member.isBoardMember,
    isCurator: member.isCurator,
  };
}

/** Issue a long-lived identity session. Returns the raw token for the cookie. */
export async function createIdentitySession(
  memberId: string,
  options: { userAgent?: string | null; claimedVia?: "tap" | "pin" } = {}
): Promise<string> {
  const token = createIdentityToken();
  const tokenHash = await hashIdentityToken(token);

  await prisma.familySession.create({
    data: {
      memberId,
      tokenHash,
      userAgent: options.userAgent?.slice(0, 300) ?? null,
      claimedVia: options.claimedVia ?? "tap",
      expiresAt: new Date(Date.now() + IDENTITY_LIFETIME_MS),
    },
  });

  await prisma.familyMember.update({
    where: { id: memberId },
    data: { claimedAt: new Date(), lastSeenAt: new Date() },
  });

  return token;
}

/** Revoke rather than delete, so the row stays as an audit record of the claim. */
export async function revokeIdentitySession(token: string): Promise<void> {
  const tokenHash = await hashIdentityToken(token);
  await prisma.familySession
    .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}
