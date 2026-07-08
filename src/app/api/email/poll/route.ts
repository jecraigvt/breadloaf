import { NextResponse } from "next/server";
import { processInbox } from "@/lib/email-processor";
import { emailConfigured } from "@/lib/email-inbox";

// Manual Mail Room trigger: visit /api/email/poll (PIN-authed like every
// route) to run an inbox check immediately, bypassing the 10-minute
// rate limit, and see exactly what it found and did.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "GMAIL_APP_PASSWORD is not configured" },
      { status: 503 }
    );
  }
  try {
    const summary = await processInbox();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[Mail Room] manual poll failed:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
