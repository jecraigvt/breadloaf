import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMailCurator } from "@/lib/mail-room-access";
import { accessPolicyResponse } from "@/lib/access-policy";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMailCurator(request);
    const { id } = await params;
    const body = await request.json();
    if (!["approve", "dismiss", "retry"].includes(body.action)) return NextResponse.json({ error: "Choose approve, dismiss or retry" }, { status: 400 });
    const row = await prisma.emailLog.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!["quarantined", "retry", "dismissed"].includes(row.status)) return NextResponse.json({ error: "This message does not need review" }, { status: 409 });
    if (!row.sourceChecksum && body.action !== "dismiss") return NextResponse.json({ error: "This historical message has no retained source; review it in Gmail" }, { status: 409 });
    if (body.action === "retry" && (row.authenticationStatus !== "verified" || row.status === "quarantined" || row.status === "dismissed") && !row.reviewedBy) {
      return NextResponse.json({ error: "Approve this sender's message explicitly before processing it" }, { status: 409 });
    }
    const approved = body.action === "approve";
    const dismissed = body.action === "dismiss";
    const changed = await prisma.emailLog.updateMany({ where: { id, status: row.status }, data: {
      status: dismissed ? "dismissed" : "received", attempts: 0, nextAttemptAt: new Date(), lastError: null, leaseToken: null, leaseExpiresAt: null,
      ...(approved ? { reviewedBy: actor.memberId, reviewedAt: new Date() } : {}),
      ...(dismissed ? { reviewedBy: null, reviewedAt: new Date() } : {}),
    } });
    if (changed.count !== 1) return NextResponse.json({ error: "Another reviewer changed this message; refresh its status" }, { status: 409 });
    await recordBuckyLedgerEntry({ actionType: "review_incoming_email", summary: `${dismissed ? "Dismissed" : approved ? "Approved" : "Retried"} incoming email: ${row.subject || "(no subject)"}`,
      initiatedBy: actor.fullName, entityType: "email", entityId: id, reversible: false });
    return NextResponse.json({ status: dismissed ? "dismissed" : "received", message: dismissed ? "Message retained without filing" : "Message approved for the next scheduled Mail Room run" });
  } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Email review is unavailable" }, { status: 503 }); }
}
