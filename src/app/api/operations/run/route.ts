import { processInbox } from "@/lib/email-processor";
import { emailConfigured } from "@/lib/email-inbox";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";
import { createHousekeepingHandler } from "@/lib/site-housekeeping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Narrow scheduler credential: mail intake and calendar reconciliation only. */
export const POST = createHousekeepingHandler({
  emailConfigured, inbox: () => processInbox({ maxEmails: 2 }), calendar: syncFromGoogleCalendar,
  cleanupAuthAttempts: () => prisma.authRateLimit.deleteMany({ where: { windowEndsAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  cleanupSignInLinks: () => prisma.familySignInLink.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
});
