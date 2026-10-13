import { NextRequest, NextResponse } from "next/server";
import { processInbox } from "@/lib/email-processor";
import { emailConfigured } from "@/lib/email-inbox";
import { requireMailCurator } from "@/lib/mail-room-access";
import { accessPolicyResponse } from "@/lib/access-policy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const statusFields = { id: true, fromEmail: true, senderName: true, subject: true, receivedAt: true, status: true, attempts: true,
  authenticationStatus: true, authenticationReason: true, lastError: true, nextAttemptAt: true, reviewedAt: true } as const;

/** Reading status never consumes or processes email. */
export async function GET(request: NextRequest) {
  try {
    await requireMailCurator(request);
    const [mailbox, groups, recent, review, legacyUnretainedCount] = await Promise.all([
      prisma.emailMailboxState.findUnique({ where: { id: "gmail-inbox" }, select: { updatedAt: true } }),
      prisma.emailLog.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: statusFields }),
      prisma.emailLog.findMany({ where: { status: { in: ["quarantined", "retry", "dismissed"] } }, orderBy: { createdAt: "asc" }, take: 100, select: statusFields }),
      prisma.emailLog.count({ where: { sourceChecksum: null, status: "completed" } }),
    ]);
    return NextResponse.json({ configured: emailConfigured(), checkedAt: mailbox?.updatedAt || null,
      counts: Object.fromEntries(groups.map((group) => [group.status, group._count._all])), recent, review, legacyUnretainedCount },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Mail Room status is unavailable" }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  try {
    await requireMailCurator(request);
    return NextResponse.json(await processInbox({ maxEmails: 6 }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Mail Room check failed; saved messages remain available" }, { status: 503 }); }
}
