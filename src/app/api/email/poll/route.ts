import { NextResponse } from "next/server";
import { processInbox } from "@/lib/email-processor";
import { emailConfigured } from "@/lib/email-inbox";
import { prisma } from "@/lib/prisma";

// Manual Mail Room trigger: visit /api/email/poll (PIN-authed like every
// route) to run an inbox check immediately, bypassing the 10-minute
// rate limit, and see exactly what it found and did.

export const dynamic = "force-dynamic";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

export async function GET() {
  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "GMAIL_APP_PASSWORD is not configured" },
      { status: 503 }
    );
  }
  try {
    const summary = await processInbox();
    // Ledger of every email the Mail Room has ever seen and what it
    // decided — makes "why didn't X get processed?" self-diagnosable.
    const recentLog = (
      await prisma.emailLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    ).map((l) => ({
      from: l.fromEmail,
      subject: l.subject,
      receivedAt: l.receivedAt,
      outcome: safeParse(l.actions),
    }));
    return NextResponse.json({ ...summary, recentLog });
  } catch (error) {
    console.error("[Mail Room] manual poll failed:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
