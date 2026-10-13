import { NextRequest, NextResponse } from "next/server";
import { authorizedOperationsRequest } from "@/lib/operations-auth";
import { processInbox } from "@/lib/email-processor";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Narrow scheduler credential: mail intake and calendar reconciliation only. */
export async function POST(request: NextRequest) {
  if (!authorizedOperationsRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await Promise.allSettled([
    processInbox({ maxEmails: 2 }), syncFromGoogleCalendar(),
    prisma.authRateLimit.deleteMany({ where: { windowEndsAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    prisma.familySignInLink.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);
  const mail = results[0]; const calendar = results[1];
  const mailFailed = mail.status === "rejected" || mail.value.errors.length > 0;
  const calendarFailed = calendar.status === "rejected" || Boolean(calendar.value.error);
  // The scheduler gets counts only; private message bodies and family names stay here.
  return NextResponse.json({
    mail: mail.status === "fulfilled" ? { received: mail.value.received, processed: mail.value.processed.length, waiting: mail.value.skipped.length, errors: mail.value.errors.length } : { errors: 1 },
    calendar: calendar.status === "fulfilled" ? { created: calendar.value.created, updated: calendar.value.updated, deleted: calendar.value.deleted, unavailable: Boolean(calendar.value.error) } : { unavailable: true },
    cleanupFailed: results.slice(2).some(result => result.status === "rejected"),
  }, { status: mailFailed || calendarFailed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
