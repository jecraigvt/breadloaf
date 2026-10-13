import { prisma } from "@/lib/prisma";
import { hashIdentityToken, createIdentityToken } from "@/lib/identity-token";
import { normalizeSignInEmail, safeSignInDestination, createSignInSecret, hashSignInSecret, validSignInSecret,
  REMEMBERED_DEVICE_MS, REMEMBERED_TOKEN_PREFIX, SIGN_IN_LINK_MS } from "@/lib/sign-in-policy";

export class SignInLinkError extends Error {}

/** These are explicit caretaker-approved directory rows, not a self-registration lookup. */
export async function approvedSignInMember(email: string) {
  const normalized = normalizeSignInEmail(email);
  if (!normalized) return null;
  const members = await prisma.familyMember.findMany({ where: {
    email: { equals: normalized, mode: "insensitive" }, accessApproved: true, canClaim: true, isMinor: false, deceased: false,
  }, take: 2 });
  return members.length === 1 ? members[0] : null;
}

export async function issueFamilySignInLink(email: string, destination: unknown) {
  const normalized = normalizeSignInEmail(email);
  if (!normalized) return null;
  const token = createSignInSecret();
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.familyMember.findMany({ where: { email: { equals: normalized, mode: "insensitive" }, accessApproved: true, canClaim: true, isMinor: false, deceased: false }, take: 2 });
    if (candidates.length !== 1) return null;
    await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${candidates[0].id} FOR UPDATE`;
    const member = await tx.familyMember.findUnique({ where: { id: candidates[0].id } });
    if (!member?.accessApproved || !member.canClaim || member.isMinor || member.deceased || normalizeSignInEmail(member.email) !== normalized) return null;
    const link = await tx.familySignInLink.create({ data: {
      memberId: member.id, email: normalized, tokenHash: hashSignInSecret(token), destination: safeSignInDestination(destination),
      expiresAt: new Date(Date.now() + SIGN_IN_LINK_MS),
    } });
    return { token, id: link.id, memberName: member.displayName || member.name.split(" ")[0] };
  });
}

/** POST redemption is atomic; merely visiting the email link never consumes it. */
export async function redeemFamilySignInLink(value: unknown, userAgent: string | null) {
  if (!validSignInSecret(value)) throw new SignInLinkError("This sign-in link is invalid. Request a new one.");
  const tokenHash = hashSignInSecret(value);
  const sessionToken = createIdentityToken();
  const sessionHash = await hashIdentityToken(sessionToken);
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.familySignInLink.findUnique({ where: { tokenHash }, select: { memberId: true } });
    if (!candidate) throw new SignInLinkError("This sign-in link has expired or was already used. Request a new one.");
    // Same order as caretaker access changes: member, then links/sessions.
    await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${candidate.memberId} FOR UPDATE`;
    const link = await tx.familySignInLink.findUnique({ where: { tokenHash } });
    const member = await tx.familyMember.findUnique({ where: { id: candidate.memberId } });
    const now = new Date();
    if (!link || !member || link.usedAt || link.expiresAt <= now || !member.accessApproved || !member.canClaim ||
      member.isMinor || member.deceased || normalizeSignInEmail(member.email) !== link.email) {
      throw new SignInLinkError("This sign-in link has expired or was already used. Request a new one.");
    }
    const claimed = await tx.familySignInLink.updateMany({ where: { id: link.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new SignInLinkError("This sign-in link was already used. Request a new one.");
    await tx.familySession.create({ data: { memberId: member.id, tokenHash: sessionHash, claimedVia: "email",
      verifiedAt: now, verifiedEmail: link.email, userAgent: userAgent?.slice(0, 300) || null,
      expiresAt: new Date(now.getTime() + REMEMBERED_DEVICE_MS) } });
    await tx.familyMember.update({ where: { id: member.id }, data: { claimedAt: now, lastSeenAt: now } });
    return { token: sessionToken, family: member.branch || "Family", displayName: member.displayName || member.name.split(" ")[0],
      destination: safeSignInDestination(link.destination) };
  });
}

export async function rememberedFamilySession(value: string | null | undefined) {
  if (!value?.startsWith(REMEMBERED_TOKEN_PREFIX)) return null;
  const token = value.slice(REMEMBERED_TOKEN_PREFIX.length);
  if (!validSignInSecret(token)) return null;
  const tokenHash = await hashIdentityToken(token);
  const session = await prisma.familySession.findUnique({ where: { tokenHash }, include: { member: true } });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now || !session.verifiedAt || !session.member.accessApproved ||
    !session.member.canClaim || session.member.isMinor || session.member.deceased ||
    normalizeSignInEmail(session.member.email) !== session.verifiedEmail) return null;
  if (session.expiresAt.getTime() - now.getTime() < REMEMBERED_DEVICE_MS - 24 * 60 * 60 * 1000) {
    const expiresAt = new Date(now.getTime() + REMEMBERED_DEVICE_MS);
    await prisma.familySession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastUsedAt: now, expiresAt } });
    session.expiresAt = expiresAt;
  }
  return session;
}
