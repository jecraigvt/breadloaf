import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AccessPolicyError, requirePrivilegedActor, accessPolicyResponse, isPrivilegedActor, lockVerifiedActorForAccessChange } from "@/lib/access-policy";
import { FamilyProfilePatchSchema } from "@/lib/family-profile-input";
import { ZodError } from "zod";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePrivilegedActor(request);
    const { id } = await params;
    const body = FamilyProfilePatchSchema.parse(await request.json());
    if ("isCurator" in body && !actor.isCurator) {
      return NextResponse.json({ error: "Only a verified curator can assign curator access" }, { status: 403 });
    }
    if (body.isMinor === true || body.deceased === true) body.canClaim = false;

    const member = await prisma.$transaction(async (tx) => {
      const currentActor = await lockVerifiedActorForAccessChange(tx, request, actor);
      if (!isPrivilegedActor(currentActor)) throw new AccessPolicyError("A verified curator or board member is required", 403);
      if (id !== actor.memberId) await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.familyMember.findUnique({ where: { id }, select: { email: true, accessApproved: true, isCurator: true } });
      if (!existing) throw new AccessPolicyError("Not found", 404);
      const emailChanged = "email" in body && (body.email || "").trim().toLowerCase() !== (existing.email || "").trim().toLowerCase();
      if (emailChanged && existing.accessApproved) throw new AccessPolicyError("Change an approved sign-in address in Access settings", 403);
      if ("isCurator" in body && !currentActor.isCurator) throw new AccessPolicyError("Only a verified curator can assign curator access", 403);
      if (existing.accessApproved && (("isCurator" in body && body.isCurator !== existing.isCurator) || body.canClaim === false || body.deceased === true || body.isMinor === true)) {
        throw new AccessPolicyError("Change or revoke approved access in Access settings before disabling this profile", 403);
      }
      if (existing.isCurator && !currentActor.isCurator && ["canClaim", "deceased", "isMinor", "isBoardMember"].some((key) => key in body)) {
        throw new AccessPolicyError("Only a verified curator can change curator eligibility", 403);
      }
      if (currentActor.memberId === id && currentActor.isCurator && (body.isCurator === false || body.canClaim === false || body.deceased === true || body.isMinor === true)) {
        throw new AccessPolicyError("A curator cannot disable their own active account", 409);
      }
      const updated = await tx.familyMember.update({ where: { id }, data: { ...body, ...(emailChanged ? { accessApproved: false } : {}) } });
      if (emailChanged) {
        await tx.familySession.updateMany({ where: { memberId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.familySignInLink.updateMany({ where: { memberId: id, usedAt: null }, data: { usedAt: new Date() } });
      }
      return updated;
    });

    return NextResponse.json(member);
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    if (error instanceof ZodError) return NextResponse.json({ error: "Invalid family profile fields" }, { status: 400 });
    console.error("Family member update error:", error);
    return NextResponse.json(
      { error: "Failed to update family member" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePrivilegedActor(request);
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      const currentActor = await lockVerifiedActorForAccessChange(tx, request, actor);
      if (!isPrivilegedActor(currentActor)) throw new AccessPolicyError("A verified curator or board member is required", 403);
      if (id !== actor.memberId) await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${id} FOR UPDATE`;
      const existing = await tx.familyMember.findUnique({ where: { id }, select: { isCurator: true, accessApproved: true } });
      if (!existing) throw new AccessPolicyError("Not found", 404);
      if (existing.accessApproved) throw new AccessPolicyError("Revoke this person's access in Access settings before removing their profile", 409);
      if (existing.isCurator && !currentActor.isCurator) throw new AccessPolicyError("Only a verified curator can remove curator profiles", 403);
      if (currentActor.memberId === id && currentActor.isCurator) throw new AccessPolicyError("A curator cannot remove their own active account", 409);
      await tx.familyMember.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    console.error("Family member delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete family member" },
      { status: 500 }
    );
  }
}
