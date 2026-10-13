import { NextResponse, type NextRequest } from "next/server";
import { getDoorFamily, getIdentityCookieName, getVerifiedActor, type ActorContext } from "@/lib/actor";
import { getAccountsVaultCookieName, validateAccountsVaultToken } from "@/lib/accounts-vault-auth";
import { getAuthCookieName } from "@/lib/auth";
import { hashIdentityToken } from "@/lib/identity-token";
import { normalizeSignInEmail, REMEMBERED_TOKEN_PREFIX } from "@/lib/sign-in-policy";
import type { Prisma } from "@prisma/client";

export class AccessPolicyError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export interface AccessContext {
  actor: ActorContext | null;
  vaultUnlocked: boolean;
}

/** A face tap is attribution; only a verified session can exercise a role. */
export function isPrivilegedActor(actor?: ActorContext | null): boolean {
  return actor?.verified === true && (actor.isCurator || actor.isBoardMember);
}

export function accessibleDocumentScopes(context: AccessContext): string[] {
  return ["family", ...(isPrivilegedActor(context.actor) ? ["board", ...(context.vaultUnlocked ? ["vault"] : [])] : [])];
}

export function assertDocumentAccess(scope: string, context: AccessContext): void {
  if (!accessibleDocumentScopes(context).includes(scope)) {
    throw new AccessPolicyError("This document requires verified permission or an unlocked vault", 403);
  }
}

export async function requestAccessContext(request: NextRequest): Promise<AccessContext> {
  if (!(await getDoorFamily(request))) throw new AccessPolicyError("Unauthorized", 401);
  const actor = await getVerifiedActor(request);
  const vaultCookie = request.cookies.get(getAccountsVaultCookieName())?.value;
  return {
    actor,
    vaultUnlocked: isPrivilegedActor(actor) && Boolean(vaultCookie && await validateAccountsVaultToken(vaultCookie)),
  };
}

export async function requirePrivilegedActor(request: NextRequest): Promise<ActorContext> {
  const context = await requestAccessContext(request);
  if (!isPrivilegedActor(context.actor)) {
    throw new AccessPolicyError("A verified curator or board member is required", 403);
  }
  return context.actor!;
}

/** Serialize account changes and resolve authority again after any competing revocation. */
export async function lockVerifiedActorForAccessChange(tx: Prisma.TransactionClient, request: NextRequest, expectedActor: ActorContext): Promise<ActorContext> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('breadloaf-family-access'))`;
  await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${expectedActor.memberId} FOR UPDATE`;
  const doorToken = request.cookies.get(getAuthCookieName())?.value;
  const token = doorToken?.startsWith(REMEMBERED_TOKEN_PREFIX)
    ? doorToken.slice(REMEMBERED_TOKEN_PREFIX.length) : request.cookies.get(getIdentityCookieName())?.value;
  const session = token ? await tx.familySession.findUnique({ where: { tokenHash: await hashIdentityToken(token) }, include: { member: true } }) : null;
  const member = session?.member;
  const email = normalizeSignInEmail(member?.email);
  if (!session || session.memberId !== expectedActor.memberId || session.revokedAt || session.expiresAt <= new Date() ||
    !session.verifiedAt || !member?.accessApproved || !member.canClaim || member.isMinor || member.deceased ||
    !email || email !== session.verifiedEmail) {
    throw new AccessPolicyError("Your access has changed. Sign in again before making an access change.", 403);
  }
  return { memberId: member.id, displayName: member.displayName?.trim() || member.name.split(" ")[0], fullName: member.name,
    branch: member.branch, boardRole: member.boardRole, isBoardMember: member.isBoardMember, isCurator: member.isCurator, verified: true };
}

export function accessPolicyResponse(error: unknown): NextResponse | null {
  return error instanceof AccessPolicyError
    ? NextResponse.json({ error: error.message }, { status: error.status })
    : null;
}
