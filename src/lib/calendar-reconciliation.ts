import { parseStayDate, propertyToday } from "./stay-dates";

export interface CalendarEventData {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  status?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
}

export function normalizeCalendarEvent(event: CalendarEventData) {
  if (!event.id || !event.summary?.trim() || event.status === "cancelled") return null;
  try {
    const dateKey = (part: CalendarEventData["start"]) => part?.date
      ? part.date
      : part?.dateTime ? propertyToday(new Date(part.dateTime)) : null;
    const start = dateKey(event.start);
    const end = dateKey(event.end);
    if (!start || !end) return null;
    const checkIn = parseStayDate(start);
    let checkOut = parseStayDate(end);
    // Same-day timed events represent a one-day visit in the date-only calendar.
    if (checkOut <= checkIn) checkOut = new Date(checkIn.getTime() + 86400000);
    const description = event.description || "";
    const roomLine = description.match(/^Room:\s*(.+)$/m)?.[1]?.trim() || null;
    const savedStatus = event.extendedProperties?.private?.breadloafStatus;
    return {
      googleEventId: event.id,
      guestName: event.summary.replace(/ at Breadloaf Hill$/, "").trim(),
      checkIn, checkOut,
      notes: description.replace(/^(Room:.*|No room assigned)\r?\n?/m, "").trim() || null,
      roomName: roomLine,
      roomId: event.extendedProperties?.private?.breadloafRoomId || null,
      status: savedStatus && ["confirmed", "tentative", "requested"].includes(savedStatus)
        ? event.status === "tentative" ? savedStatus === "requested" ? "requested" : "tentative"
          : event.status === "confirmed" ? "confirmed" : savedStatus
        : event.status === "tentative" ? "tentative" : null,
      hasRoomAssignment: Boolean(roomLine || /^No room assigned(?:\r?\n|$)/m.test(description) || event.extendedProperties?.private?.breadloafRoomId !== undefined),
    };
  } catch { return null; }
}

export function calendarEventChanged(
  stay: { guestName: string; checkIn: Date; checkOut: Date; notes: string | null; roomId: string | null; status?: string },
  event: NonNullable<ReturnType<typeof normalizeCalendarEvent>>,
  roomId: string | null,
) {
  return stay.guestName !== event.guestName || stay.checkIn.getTime() !== event.checkIn.getTime()
    || stay.checkOut.getTime() !== event.checkOut.getTime() || stay.notes !== event.notes
    || (event.hasRoomAssignment && stay.roomId !== roomId)
    || (event.status !== null && stay.status !== undefined && stay.status !== event.status);
}

/** Google timeMin filters by event END; never infer deletion outside that same window. */
export function missingEventCanDelete(stay: { checkOut: Date; deletedAt: Date | null; calendarSyncState: string }, windowStart: Date) {
  return !stay.deletedAt && stay.calendarSyncState === "synced" && stay.checkOut > windowStart;
}
