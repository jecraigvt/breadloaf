import { NextRequest, NextResponse } from "next/server";
import { BuckyUndoError, undoBuckyLedgerEntry } from "@/lib/bucky-undo";
import { prisma } from "@/lib/prisma";
import { requestAccessContext, assertDocumentAccess, isPrivilegedActor, AccessPolicyError, accessPolicyResponse, lockVerifiedActorForAccessChange } from "@/lib/access-policy";
import { ledgerDocumentIds, ledgerRoleVisible } from "@/lib/ledger-access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requestAccessContext(request);
    const { id } = await params;
    const target = await prisma.buckyLedgerEntry.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!ledgerRoleVisible(target, access) || target.actionType === "update_position" && !isPrivilegedActor(access.actor)) throw new AccessPolicyError("Verified permission is required to undo this action", 403);
    for (const documentId of ledgerDocumentIds(target)) {
      const document = await prisma.document.findUnique({ where: { id: documentId }, select: { accessScope: true } });
      if (!document) return NextResponse.json({ error: "The source is no longer available" }, { status: 404 });
      assertDocumentAccess(document.accessScope, access);
    }
    const entry = await undoBuckyLedgerEntry(id, access.actor?.fullName || "Family member", access, async tx => {
      if (!access.actor) throw new AccessPolicyError("A verified identity is required", 403);
      const current = await lockVerifiedActorForAccessChange(tx, request, access.actor);
      if (!isPrivilegedActor(current)) throw new AccessPolicyError("Your permission to change family roles has changed", 403);
    });
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    const denied = accessPolicyResponse(error);
    if (denied) return denied;
    if (error instanceof BuckyUndoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Bucky ledger undo failed:", error);
    return NextResponse.json({ error: "The action could not be undone." }, { status: 500 });
  }
}
