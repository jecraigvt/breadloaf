import { google, calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getCalendarClient(): calendar_v3.Calendar | null {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!credentials || !calendarId) {
    return null;
  }

  try {
    const key = JSON.parse(credentials);
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: SCOPES,
    });
    return google.calendar({ version: "v3", auth: auth as unknown as string });
  } catch (err) {
    console.error("Failed to initialize Google Calendar client:", err);
    return null;
  }
}

function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || "";
}

/**
 * Create a Google Calendar event for a stay
 */
export async function createCalendarEvent(stay: {
  id: string;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  notes: string | null;
  room?: { name: string } | null;
}): Promise<string | null> {
  const calendar = getCalendarClient();
  if (!calendar) return null;

  try {
    const event = await calendar.events.insert({
      calendarId: getCalendarId(),
      requestBody: {
        summary: `${stay.guestName} at Breadloaf Hill`,
        description: [
          stay.room ? `Room: ${stay.room.name}` : "No room assigned",
          stay.notes || "",
        ]
          .filter(Boolean)
          .join("\n"),
        location: "Breadloaf Hill, Vermont",
        start: {
          date: formatDateOnly(stay.checkIn),
        },
        end: {
          date: formatDateOnly(stay.checkOut),
        },
        transparency: "transparent",
      },
    });

    const eventId = event.data.id || null;

    if (eventId) {
      await prisma.stay.update({
        where: { id: stay.id },
        data: { googleEventId: eventId },
      });
    }

    return eventId;
  } catch (err) {
    console.error("Failed to create calendar event:", err);
    return null;
  }
}

/**
 * Update a Google Calendar event when a stay changes
 */
export async function updateCalendarEvent(
  googleEventId: string,
  stay: {
    guestName: string;
    checkIn: Date;
    checkOut: Date;
    notes: string | null;
    room?: { name: string } | null;
  }
): Promise<boolean> {
  const calendar = getCalendarClient();
  if (!calendar) return false;

  try {
    await calendar.events.update({
      calendarId: getCalendarId(),
      eventId: googleEventId,
      requestBody: {
        summary: `${stay.guestName} at Breadloaf Hill`,
        description: [
          stay.room ? `Room: ${stay.room.name}` : "No room assigned",
          stay.notes || "",
        ]
          .filter(Boolean)
          .join("\n"),
        location: "Breadloaf Hill, Vermont",
        start: {
          date: formatDateOnly(stay.checkIn),
        },
        end: {
          date: formatDateOnly(stay.checkOut),
        },
      },
    });
    return true;
  } catch (err) {
    console.error("Failed to update calendar event:", err);
    return false;
  }
}

/**
 * Delete a Google Calendar event
 */
export async function deleteCalendarEvent(
  googleEventId: string
): Promise<boolean> {
  const calendar = getCalendarClient();
  if (!calendar) return false;

  try {
    await calendar.events.delete({
      calendarId: getCalendarId(),
      eventId: googleEventId,
    });
    return true;
  } catch (err) {
    console.error("Failed to delete calendar event:", err);
    return false;
  }
}

/**
 * Sync events FROM Google Calendar back to the local database.
 * This handles changes made directly in Google Calendar.
 */
export async function syncFromGoogleCalendar(): Promise<{
  created: number;
  updated: number;
  deleted: number;
}> {
  const calendar = getCalendarClient();
  if (!calendar) return { created: 0, updated: 0, deleted: 0 };

  const stats = { created: 0, updated: 0, deleted: 0 };

  try {
    // Fetch upcoming events from Google Calendar
    const calId = getCalendarId();
    console.log(`[Calendar Sync] Syncing from calendar: ${calId}`);
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    const response = await calendar.events.list({
      calendarId: getCalendarId(),
      timeMin: threeMonthsAgo.toISOString(),
      maxResults: 250,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    console.log(`[Calendar Sync] Fetched ${events.length} events from Google Calendar`);
    for (const e of events.slice(0, 5)) {
      console.log(`[Calendar Sync] Event: "${e.summary}" | ${e.start?.date || e.start?.dateTime} - ${e.end?.date || e.end?.dateTime} | ID: ${e.id}`);
    }
    const googleEventIds = new Set<string>();

    for (const event of events) {
      if (!event.id || !event.summary) continue;

      googleEventIds.add(event.id);

      // Use event title as guest/event name, strip " at Breadloaf Hill" if present
      const guestName = event.summary.replace(" at Breadloaf Hill", "").trim();
      const checkIn = event.start?.date
        ? new Date(event.start.date + "T00:00:00")
        : event.start?.dateTime
        ? new Date(event.start.dateTime)
        : null;
      // Google Calendar all-day event end dates are exclusive (day after last day)
      // Subtract 1 day so a single-day event shows as 1 day, not 2
      let checkOut: Date | null = null;
      if (event.end?.date) {
        const endDate = new Date(event.end.date + "T00:00:00");
        endDate.setDate(endDate.getDate() - 1);
        // If single-day event, checkOut = checkIn
        checkOut = endDate < checkIn! ? checkIn : endDate;
      } else if (event.end?.dateTime) {
        checkOut = new Date(event.end.dateTime);
      }

      if (!checkIn || !checkOut) continue;

      // Check if this event already exists locally
      const existingStay = await prisma.stay.findUnique({
        where: { googleEventId: event.id },
      });

      if (existingStay) {
        // Update if dates or name changed
        const needsUpdate =
          existingStay.guestName !== guestName ||
          existingStay.checkIn.toISOString().slice(0, 10) !==
            checkIn.toISOString().slice(0, 10) ||
          existingStay.checkOut.toISOString().slice(0, 10) !==
            checkOut.toISOString().slice(0, 10);

        if (needsUpdate) {
          await prisma.stay.update({
            where: { id: existingStay.id },
            data: {
              guestName,
              checkIn,
              checkOut,
              notes: event.description || existingStay.notes,
            },
          });
          stats.updated++;
        }
      } else {
        // Create new local stay from Google Calendar event
        await prisma.stay.create({
          data: {
            guestName,
            checkIn,
            checkOut,
            notes: event.description || null,
            status: "confirmed",
            googleEventId: event.id,
          },
        });
        stats.created++;
      }
    }

    // Mark stays as deleted if their Google event was removed
    const linkedStays = await prisma.stay.findMany({
      where: { googleEventId: { not: null } },
    });

    for (const stay of linkedStays) {
      if (stay.googleEventId && !googleEventIds.has(stay.googleEventId)) {
        await prisma.stay.delete({ where: { id: stay.id } });
        stats.deleted++;
      }
    }
  } catch (err) {
    console.error("[Calendar Sync] FAILED:", err);
  }

  return stats;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
