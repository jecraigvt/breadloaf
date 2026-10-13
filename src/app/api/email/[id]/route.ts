import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMailCurator } from "@/lib/mail-room-access";
import { accessPolicyResponse } from "@/lib/access-policy";
import { parseInboundEmail } from "@/lib/email-inbox";
import { readEmailSource } from "@/lib/email-source";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMailCurator(request);
    const { id } = await params;
    const row = await prisma.emailLog.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let preview: { text: string; attachments: { name: string; size: number }[]; additionalAttachments: number } | null = null;
    if (row.sourceChecksum) {
      try {
        const email = await parseInboundEmail(await readEmailSource(row.sourceChecksum), { receivedAt: row.receivedAt });
        preview = { text: email.text.slice(0, 15000), attachments: email.attachments.map((attachment) => ({ name: attachment.filename, size: attachment.size })), additionalAttachments: email.additionalAttachmentCount };
      } catch { /* The exact source remains available as an attachment, even for malformed MIME. */ }
    }
    return NextResponse.json({ id: row.id, from: row.fromEmail, senderName: row.senderName, subject: row.subject,
      receivedAt: row.receivedAt, status: row.status, authenticationStatus: row.authenticationStatus,
      authenticationReason: row.authenticationReason, lastError: row.lastError, reviewedBy: row.reviewedBy,
      preview, sourceAvailable: Boolean(row.sourceChecksum) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "Email preview is unavailable" }, { status: 503 }); }
}
