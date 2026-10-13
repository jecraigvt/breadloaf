import { NextRequest, NextResponse } from "next/server";
import { authorizedOperationsRequest } from "./operations-auth";
import type { InboxRunSummary } from "./email-processor";
import type { CalendarSyncSummary } from "./google-calendar";

interface HousekeepingTasks {
  emailConfigured(): boolean;
  inbox(): Promise<InboxRunSummary>;
  calendar(): Promise<CalendarSyncSummary>;
  cleanupAuthAttempts(): Promise<unknown>;
  cleanupSignInLinks(): Promise<unknown>;
}

/** The scheduler receives counts only, including partial failures. */
export function createHousekeepingHandler(tasks: HousekeepingTasks) {
  return async function POST(request: NextRequest) {
    if (!authorizedOperationsRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const configured = tasks.emailConfigured();
    const results = await Promise.allSettled([
      Promise.resolve().then(tasks.inbox), Promise.resolve().then(tasks.calendar),
      Promise.resolve().then(tasks.cleanupAuthAttempts), Promise.resolve().then(tasks.cleanupSignInLinks),
    ]);
    const mail = results[0], calendar = results[1];
    const errors = (mail.status === "fulfilled" ? mail.value.errors.length : 1) + Number(!configured);
    const calendarFailed = calendar.status === "rejected" || Boolean(calendar.value.error) || calendar.value.pushFailed > 0;
    const cleanupFailed = results.slice(2).some(result => result.status === "rejected");
    return NextResponse.json({
      mail: { configured, received: mail.status === "fulfilled" ? mail.value.received : 0,
        processed: mail.status === "fulfilled" ? mail.value.processed.length : 0,
        waiting: mail.status === "fulfilled" ? mail.value.skipped.length : 0, errors },
      calendar: calendar.status === "fulfilled" ? { created: calendar.value.created, updated: calendar.value.updated,
        deleted: calendar.value.deleted, pushAttempted: calendar.value.pushAttempted, pushSynced: calendar.value.pushSynced,
        pushFailed: calendar.value.pushFailed, unavailable: calendarFailed } : { unavailable: true },
      cleanupFailed,
    }, { status: errors || calendarFailed || cleanupFailed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  };
}
