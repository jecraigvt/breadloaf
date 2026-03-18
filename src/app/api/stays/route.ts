import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createCalendarEvent,
  syncFromGoogleCalendar,
} from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sync = searchParams.get("sync");

  // Trigger Google Calendar sync if requested
  if (sync === "true") {
    const stats = await syncFromGoogleCalendar();
    if (stats.created > 0 || stats.updated > 0 || stats.deleted > 0) {
      console.log("Calendar sync:", stats);
    }
  }

  const where: Record<string, unknown> = {};
  if (from || to) {
    where.checkOut = from ? { gte: new Date(from) } : undefined;
    where.checkIn = to ? { lte: new Date(to) } : undefined;
  }

  const rooms = await prisma.room.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      stays: {
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { checkIn: "asc" },
      },
    },
  });

  // Also fetch stays with no room assigned (e.g., events synced from Google Calendar)
  const unassignedStays = await prisma.stay.findMany({
    where: {
      roomId: null,
      ...(Object.keys(where).length > 0 ? where : {}),
    },
    orderBy: { checkIn: "asc" },
  });

  // Add a virtual "Unassigned" entry if there are unassigned stays
  if (unassignedStays.length > 0) {
    rooms.push({
      id: "unassigned",
      name: "No Room Assigned",
      slug: "unassigned",
      type: "other",
      minCapacity: 0,
      maxCapacity: 0,
      hasCrib: false,
      description: "Events and visits without a room assignment",
      sortOrder: 999,
      stays: unassignedStays,
    } as typeof rooms[0]);
  }

  return NextResponse.json(rooms);
}

export async function POST(request: NextRequest) {
  try {
    const { guestName, roomId, checkIn, checkOut, notes, status } =
      await request.json();

    if (!guestName?.trim() || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "Guest name, check-in, and check-out dates are required" },
        { status: 400 }
      );
    }

    const stay = await prisma.stay.create({
      data: {
        guestName: guestName.trim(),
        roomId: roomId || null,
        checkIn: new Date(checkIn),
        checkOut: new Date(checkOut),
        notes: notes?.trim() || null,
        status: status || "confirmed",
      },
      include: { room: true },
    });

    // Sync to Google Calendar
    try {
      const eventId = await createCalendarEvent(stay);
      if (eventId) {
        console.log("Calendar event created:", eventId);
      }
    } catch (err) {
      console.error("Calendar sync failed:", err);
    }

    // Re-fetch to include googleEventId
    const updatedStay = await prisma.stay.findUnique({
      where: { id: stay.id },
      include: { room: true },
    });

    return NextResponse.json(updatedStay || stay);
  } catch (error) {
    console.error("Stay creation error:", error);
    return NextResponse.json(
      { error: "Failed to create stay" },
      { status: 500 }
    );
  }
}
