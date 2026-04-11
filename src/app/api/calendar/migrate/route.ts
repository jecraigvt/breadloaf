import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/google-calendar";

/**
 * One-time migration endpoint: clears old googleEventIds and pushes
 * all existing stays to the new Google Calendar.
 *
 * DELETE THIS FILE after migration is complete.
 */
// Support both GET (browser) and POST (curl)
export async function GET() {
  return migrate();
}

export async function POST() {
  return migrate();
}

async function migrate() {
  try {
    // Step 1: Clear all old googleEventIds so sync doesn't delete these stays
    const cleared = await prisma.stay.updateMany({
      where: { googleEventId: { not: null } },
      data: { googleEventId: null },
    });

    // Step 2: Fetch all stays with room info
    const stays = await prisma.stay.findMany({
      include: { room: true },
      orderBy: { checkIn: "asc" },
    });

    // Step 3: Push each stay to the new Google Calendar
    let pushed = 0;
    let failed = 0;
    const results: { name: string; status: string }[] = [];

    for (const stay of stays) {
      try {
        const eventId = await createCalendarEvent(stay);
        if (eventId) {
          pushed++;
          results.push({ name: stay.guestName, status: "ok" });
        } else {
          failed++;
          results.push({ name: stay.guestName, status: "no calendar client" });
        }
      } catch (err) {
        failed++;
        results.push({
          name: stay.guestName,
          status: `error: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }

    return NextResponse.json({
      message: "Migration complete",
      clearedOldIds: cleared.count,
      totalStays: stays.length,
      pushed,
      failed,
      results,
    });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}
