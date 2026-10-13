import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { createIdentityToken, hashIdentityToken } from "@/lib/identity-token";
import { rememberedFamilySession } from "@/lib/family-access";
import { REMEMBERED_TOKEN_PREFIX, emailSignInEnabled } from "@/lib/sign-in-policy";
export { createIdentityToken, hashIdentityToken } from "@/lib/identity-token";

/**
 * Who is acting, resolved server-side.
 *
 * Approved email links create a verified, revocable device session for both the
 * family door and personal identity. Legacy PIN access remains a rollout bridge;
 * a face tap supplies attribution only and never grants caretaker or board roles.
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
  verified?: boolean;
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
  const token = request.cookies.get(getAuthCookieName())?.value;
  if (token?.startsWith(REMEMBERED_TOKEN_PREFIX)) {
    const session = await rememberedFamilySession(token);
    return session?.member.branch || (session ? "Family" : null);
  }
  // Local dev runs without FAMILY_PINS; middleware already allows it through.
  if (!process.env.FAMILY_PINS && !emailSignInEnabled() && process.env.NODE_ENV !== "production") return "local-dev";
  return getFamilyFromAuthToken(token);
}

/**
 * Resolve the acting member. Returns null when the device has not claimed an
 * identity yet — callers decide whether that is fatal.
 */
export async function getCurrentActor(request: NextRequest): Promise<ActorContext | null> {
  const doorToken = request.cookies.get(getAuthCookieName())?.value;
  const token = doorToken?.startsWith(REMEMBERED_TOKEN_PREFIX)
    ? doorToken.slice(REMEMBERED_TOKEN_PREFIX.length) : request.cookies.get(IDENTITY_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = await hashIdentityToken(token);
  const session = await prisma.familySession.findUnique({
    where: { tokenHash },
    include: { member: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const member = session.member;
  const verified = Boolean(session.verifiedAt && member.accessApproved && session.verifiedEmail &&
    session.verifiedEmail.trim().toLowerCase() === member.email?.trim().toLowerCase() &&
    member.canClaim && !member.isMinor && !member.deceased);
  if (doorToken?.startsWith(REMEMBERED_TOKEN_PREFIX) && !verified) return null;

  // Touched at most once an hour so an ordinary page load is not a write.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (session.lastUsedAt < hourAgo) {
    await prisma.familySession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
  }

  return {
    memberId: member.id,
    displayName: member.displayName?.trim() || member.name.split(" ")[0],
    fullName: member.name,
    branch: member.branch,
    boardRole: member.boardRole,
    isBoardMember: verified && member.isBoardMember,
    isCurator: verified && member.isCurator,
    verified,
  };
}

/** Administrative authority comes from verified email enrollment, never a face tap. */
export async function getVerifiedActor(request: NextRequest): Promise<ActorContext | null> {
  const actor = await getCurrentActor(request);
  return actor?.verified ? actor : null;
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
