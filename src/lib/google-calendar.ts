import { google, calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { parseStayDate, propertyToday, stayDateKey } from "@/lib/stay-dates";
import { calendarEventChanged, missingEventCanDelete, normalizeCalendarEvent } from "@/lib/calendar-reconciliation";
import { CalendarSyncProvider, CalendarSyncStore, syncCalendarStay } from "@/lib/calendar-sync-engine";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getCalendarClient(): calendar_v3.Calendar | null {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.GOOGLE_CALENDAR_ID) return null;
  try {
    const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes: SCOPES });
    return google.calendar({ version: "v3", auth: auth as unknown as string });
  } catch {
    console.error("Google Calendar credentials could not be initialized");
    return null;
  }
}

function errorStatus(error: unknown): number | undefined {
  const value = error as { code?: number; response?: { status?: number } };
  return value?.response?.status || value?.code;
}

function calendarProvider(calendar: calendar_v3.Calendar): CalendarSyncProvider {
  const calendarId = process.env.GOOGLE_CALENDAR_ID!;
  return {
    async upsert(stay, eventId, isNew) {
      const requestBody = {
        summary: `${stay.guestName} at Breadloaf Hill`,
        description: [stay.room ? `Room: ${stay.room.name}` : "No room assigned", stay.notes || ""].filter(Boolean).join("\n"),
        location: "Breadloaf Hill, Vermont",
        start: { date: stayDateKey(stay.checkIn) }, end: { date: stayDateKey(stay.checkOut) },
        transparency: "transparent",
        status: stay.status === "confirmed" ? "confirmed" : "tentative",
        extendedProperties: { private: { breadloafStayId: stay.id, breadloafRoomId: stay.roomId || "", breadloafRevision: String(stay.calendarSyncRevision), breadloafStatus: stay.status } },
      };
      if (isNew) {
        try {
          await calendar.events.insert({ calendarId, requestBody: { ...requestBody, id: eventId } }, { timeout: 20000 });
          return;
        } catch (error) {
          if (errorStatus(error) !== 409) throw error;
          // A retry after a lost response addresses the same deterministic event.
        }
      }
      try {
        const remote = await calendar.events.get({ calendarId, eventId }, { timeout: 20000 });
        const remoteRevision = Number(remote.data.extendedProperties?.private?.breadloafRevision ?? -1);
        if (remoteRevision > stay.calendarSyncRevision) return;
        await calendar.events.patch({ calendarId, eventId, requestBody }, { timeout: 20000,
          ...(remote.data.etag ? { headers: { "If-Match": remote.data.etag } } : {}) });
      } catch (error) {
        if (errorStatus(error) !== 404) throw error;
        // The link was saved before an insert that failed before reaching Google.
        await calendar.events.insert({ calendarId, requestBody: { ...requestBody, id: eventId } }, { timeout: 20000 });
      }
    },
    async remove(eventId) {
      try { await calendar.events.delete({ calendarId, eventId }, { timeout: 20000 }); }
      catch (error) { if (![404, 410].includes(errorStatus(error) || 0)) throw error; }
    },
  };
}

const syncStore: CalendarSyncStore = {
  async claim(id, now, leaseUntil) {
    const claimed = await prisma.stay.updateMany({
      where: { id, calendarSyncState: { not: "synced" }, OR: [{ calendarSyncLeaseUntil: null }, { calendarSyncLeaseUntil: { lte: now } }] },
      data: { calendarSyncLeaseUntil: leaseUntil, calendarSyncAttemptedAt: now },
    });
    return claimed.count ? prisma.stay.findUnique({ where: { id }, include: { room: true } }) : null;
  },
  async rememberEventId(id, eventId, leaseUntil) {
    await prisma.stay.updateMany({ where: { id, googleEventId: null, calendarSyncLeaseUntil: leaseUntil }, data: { googleEventId: eventId } });
  },
  async settle(id, revision, leaseUntil, error) {
    const result = await prisma.stay.updateMany({
      where: { id, calendarSyncRevision: revision, calendarSyncLeaseUntil: leaseUntil },
      data: { calendarSyncState: error ? "error" : "synced", calendarSyncError: error },
    });
    return result.count === 1;
  },
  async release(id, leaseUntil) {
    await prisma.stay.updateMany({ where: { id, calendarSyncLeaseUntil: leaseUntil }, data: { calendarSyncLeaseUntil: null } });
  },
};

export async function syncPendingCalendarStay(id: string) {
  const calendar = getCalendarClient();
  if (!calendar) return { attempted: false, synced: false, error: null };
  return syncCalendarStay(syncStore, calendarProvider(calendar), id);
}

export async function retryPendingCalendarSync(limit = 20): Promise<{ attempted: number; synced: number; failed: number; error?: string }> {
  const calendar = getCalendarClient();
  if (!calendar) return { attempted: 0, synced: 0, failed: 0, error: "Google Calendar is unavailable" };
  const now = new Date();
  // A database outage during release must not strand an otherwise synced row.
  await prisma.stay.updateMany({ where: { calendarSyncLeaseUntil: { lte: now } }, data: { calendarSyncLeaseUntil: null } });
  const rows = await prisma.stay.findMany({
    where: { calendarSyncState: { not: "synced" }, OR: [{ calendarSyncLeaseUntil: null }, { calendarSyncLeaseUntil: { lte: now } }] },
    orderBy: { calendarSyncAttemptedAt: { sort: "asc", nulls: "first" } }, take: limit,
    select: { id: true },
  });
  let attempted = 0, synced = 0, failed = 0;
  const provider = calendarProvider(calendar);
  for (const row of rows) {
    const result = await syncCalendarStay(syncStore, provider, row.id);
    attempted += Number(result.attempted); synced += Number(result.synced);
    if (result.error) { failed++; break; } // An unavailable provider should not hold a page through every retry.
  }
  return { attempted, synced, failed, ...(failed ? { error: "Saved visit changes could not be sent to Google Calendar; synchronization will retry." } : {}) };
}

// Compatibility for older callers; all operations first persist desired state.
export async function createCalendarEvent(stay: { id: string }): Promise<string | null> {
  await syncPendingCalendarStay(stay.id);
  const row = await prisma.stay.findUnique({ where: { id: stay.id } });
  return row?.calendarSyncState === "synced" ? row.googleEventId : null;
}

export async function updateCalendarEvent(googleEventId: string, _stay?: unknown): Promise<boolean> {
  const row = await prisma.stay.update({ where: { googleEventId }, data: {
    calendarSyncState: "pending", calendarSyncError: null, calendarSyncRevision: { increment: 1 },
  } });
  return (await syncPendingCalendarStay(row.id)).synced;
}

export async function deleteCalendarEvent(googleEventId: string): Promise<boolean> {
  const row = await prisma.stay.findUnique({ where: { googleEventId } });
  if (!row) return false;
  await prisma.stay.update({ where: { id: row.id }, data: {
    deletedAt: new Date(), calendarSyncState: "pending", calendarSyncError: null, calendarSyncRevision: { increment: 1 },
  } });
  return (await syncPendingCalendarStay(row.id)).synced;
}

export interface CalendarSyncSummary {
  created: number; updated: number; deleted: number;
  pushAttempted: number; pushSynced: number; pushFailed: number;
  error?: string;
}

export async function syncFromGoogleCalendar(): Promise<CalendarSyncSummary> {
  const calendar = getCalendarClient();
  const stats = { created: 0, updated: 0, deleted: 0, pushAttempted: 0, pushSynced: 0, pushFailed: 0 };
  if (!calendar) return { ...stats, error: "Google Calendar is unavailable. Visits are saved here; synchronization will resume when it is connected." };
  try {
    const pushed = await retryPendingCalendarSync();
    stats.pushAttempted = pushed.attempted; stats.pushSynced = pushed.synced; stats.pushFailed = pushed.failed;
    const now = new Date();
    const windowStart = parseStayDate(propertyToday(now));
    windowStart.setUTCMonth(windowStart.getUTCMonth() - 3);
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const response = await calendar.events.list({ calendarId: process.env.GOOGLE_CALENDAR_ID!,
        timeMin: windowStart.toISOString(), maxResults: 250, pageToken, singleEvents: true, orderBy: "startTime", showDeleted: true,
      }, { timeout: 20000 });
      events.push(...(response.data.items || []));
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    const rooms = await prisma.room.findMany({ select: { id: true, name: true } });
    const eventIds = new Set(events.filter((event) => event.id && event.status !== "cancelled").map((event) => event.id!));
    for (const event of events) {
      if (!event.id) continue;
      const existing = await prisma.stay.findUnique({ where: { googleEventId: event.id } });
      // Tombstones are permanent evidence that the family removed this visit.
      if (existing?.deletedAt || (existing && existing.calendarSyncState !== "synced")) continue;
      if (existing?.calendarSyncAttemptedAt && now.getTime() - existing.calendarSyncAttemptedAt.getTime() < 300000) continue;
      if (event.status === "cancelled") continue;
      const normalized = normalizeCalendarEvent(event);
      if (!normalized) continue;
      const namedRoom = normalized.roomName ? rooms.find((room) => room.name.toLowerCase() === normalized.roomName!.toLowerCase()) : null;
      if (normalized.roomName && !namedRoom) normalized.notes = [`Room preference: ${normalized.roomName}`, normalized.notes].filter(Boolean).join("\n");
      const roomId = normalized.roomName ? namedRoom?.id || existing?.roomId || null
        : normalized.hasRoomAssignment && /^No room assigned(?:\r?\n|$)/m.test(event.description || "") ? null
        : rooms.find((room) => room.id === normalized.roomId)?.id || null;
      if (existing) {
        if (!calendarEventChanged(existing, normalized, roomId)) continue;
        const updated = await prisma.stay.updateMany({ where: { id: existing.id, deletedAt: null,
          calendarSyncState: "synced", calendarSyncRevision: existing.calendarSyncRevision, calendarSyncLeaseUntil: null },
          data: { guestName: normalized.guestName, checkIn: normalized.checkIn, checkOut: normalized.checkOut,
            notes: normalized.notes, ...(normalized.hasRoomAssignment ? { roomId } : {}), ...(normalized.status ? { status: normalized.status } : {}), calendarSyncRevision: { increment: 1 } },
        });
        stats.updated += updated.count;
      } else {
        try {
          await prisma.stay.create({ data: { guestName: normalized.guestName, checkIn: normalized.checkIn,
            checkOut: normalized.checkOut, notes: normalized.notes, roomId, status: normalized.status || "confirmed",
            googleEventId: event.id, calendarSyncState: "synced" } });
          stats.created++;
        } catch (error) { if ((error as { code?: string })?.code !== "P2002") throw error; }
      }
    }

    const linked = await prisma.stay.findMany({ where: { googleEventId: { not: null }, deletedAt: null,
      calendarSyncState: "synced", checkOut: { gt: windowStart } } });
    for (const stay of linked) {
      if (!missingEventCanDelete(stay, windowStart) || !stay.googleEventId || eventIds.has(stay.googleEventId)) continue;
      // Allow Google listing to catch up after a successful outbound write.
      if (stay.calendarSyncAttemptedAt && now.getTime() - stay.calendarSyncAttemptedAt.getTime() < 300000) continue;
      const removed = await prisma.stay.updateMany({ where: { id: stay.id, deletedAt: null,
        calendarSyncState: "synced", calendarSyncRevision: stay.calendarSyncRevision, calendarSyncLeaseUntil: null },
        data: { deletedAt: now, calendarSyncRevision: { increment: 1 } } });
      stats.deleted += removed.count;
    }
    return { ...stats, ...(pushed.error ? { error: pushed.error } : {}) };
  } catch {
    console.error("Calendar reconciliation failed; local visits and retry state were preserved");
    return { ...stats, error: "Google Calendar could not be reached. Saved visits remain available; synchronization will retry." };
  }
}
