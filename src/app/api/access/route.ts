import { NextRequest, NextResponse } from "next/server";
import { getVerifiedActor } from "@/lib/actor";
import { accessPolicyResponse, lockVerifiedActorForAccessChange } from "@/lib/access-policy";
import { prisma } from "@/lib/prisma";
import { normalizeSignInEmail } from "@/lib/sign-in-policy";
import { z } from "zod";
import { accessProfileLabels } from "@/lib/access-profile-label";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), memberId: z.string().min(1).max(128), email: z.string().max(254), caretaker: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("revoke"), memberId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("revoke-device"), sessionId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("dismiss-request"), requestId: z.string().min(1).max(128) }).strict(),
]);
class AccessChangeError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function GET(request: NextRequest) {
  const actor = await getVerifiedActor(request);
  if (!actor?.isCurator) return NextResponse.json({ error: "A verified family caretaker is required." }, { status: 403 });
  const [members, requests] = await Promise.all([
    prisma.familyMember.findMany({ where: { canClaim: true, isMinor: false, deceased: false }, orderBy: [{ name: "asc" }, { id: "asc" }], select: {
      id: true, name: true, email: true, branch: true, accessApproved: true, isCurator: true, birthday: true,
      relTo: { where: { type: "parent" }, select: { from: { select: { name: true } } } },
    } }),
    prisma.familyAccessRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const labels = accessProfileLabels(members);
  const choices = members.map(member => ({
    id: member.id, name: member.name, email: member.email, branch: member.branch,
    accessApproved: member.accessApproved, isCurator: member.isCurator, profileLabel: labels.get(member.id)!,
  }));
  return NextResponse.json({ members: choices, requests, actorId: actor.memberId }, { headers: { "Cache-Control": "no-store" } });
}
export async function PATCH(request: NextRequest) {
  const actor = await getVerifiedActor(request);
  if (!actor?.isCurator) return NextResponse.json({ error: "A verified family caretaker is required." }, { status: 403 });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid access change." }, { status: 400 });
  const input = parsed.data;
  try {
    await prisma.$transaction(async tx => {
      // Serialize access changes before reading authority. Two caretakers cannot
      // revoke one another using permissions captured before either revocation.
      const currentActor = await lockVerifiedActorForAccessChange(tx, request, actor);
      const now = new Date();
      if (!currentActor.isCurator) {
        throw new AccessChangeError("Your caretaker access has changed. Sign in again before making an access change.", 403);
      }
      if (input.action === "dismiss-request") {
        await tx.familyAccessRequest.update({ where: { id: input.requestId }, data: { status: "dismissed" } });
      } else if (input.action === "revoke-device") {
        await tx.familySession.update({ where: { id: input.sessionId }, data: { revokedAt: now } });
      } else {
        if (input.memberId !== actor.memberId) await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${input.memberId} FOR UPDATE`;
        const member = await tx.familyMember.findUnique({ where: { id: input.memberId } });
        if (!member || !member.canClaim || member.isMinor || member.deceased) throw new AccessChangeError("Choose an adult family profile that can use the site.", 400);
        if (member.id === actor.memberId && (input.action === "revoke" || input.caretaker === false)) throw new AccessChangeError("Another caretaker must change your own caretaker access.", 400);
        const email = input.action === "approve" ? normalizeSignInEmail(input.email) : null;
        if (input.action === "approve" && !email) throw new AccessChangeError("Enter a valid individual email address.", 400);
        if (member.id === actor.memberId && email && normalizeSignInEmail(member.email) !== email) throw new AccessChangeError("Another caretaker must change your own sign-in address.", 409);
        if (email && await tx.familyMember.findFirst({ where: { id: { not: member.id }, accessApproved: true, email: { equals: email, mode: "insensitive" } }, select: { id: true } })) throw new AccessChangeError("This email is already approved for another person. Each person needs their own address.", 409);
        const removesCaretaker = member.accessApproved && member.isCurator && (input.action === "revoke" || input.caretaker === false);
        if (removesCaretaker) {
          const otherCaretakers = await tx.familyMember.findMany({ where: {
            id: { not: member.id }, accessApproved: true, isCurator: true, canClaim: true, isMinor: false, deceased: false,
          }, select: { email: true } });
          if (!otherCaretakers.some(candidate => normalizeSignInEmail(candidate.email))) throw new AccessChangeError("Keep at least one approved family caretaker before removing this access.", 409);
        }
        await tx.familyMember.update({ where: { id: member.id }, data: input.action === "revoke" ? { accessApproved: false } : { email: email!, accessApproved: true, ...(input.caretaker === undefined ? {} : { isCurator: input.caretaker }) } });
        const changedEmail = email && normalizeSignInEmail(member.email) !== email;
        const changedRole = input.action === "approve" && input.caretaker !== undefined && input.caretaker !== member.isCurator;
        if (input.action === "revoke" || changedEmail || changedRole) {
          await tx.familySession.updateMany({ where: { memberId: member.id, revokedAt: null }, data: { revokedAt: now } });
          await tx.familySignInLink.updateMany({ where: { memberId: member.id, usedAt: null }, data: { usedAt: now } });
        }
        if (email) await tx.familyAccessRequest.updateMany({ where: { email, status: "pending" }, data: { status: "approved" } });
      }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    if (error instanceof AccessChangeError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The access change could not be saved. Please try again." }, { status: 409 });
  }
}
