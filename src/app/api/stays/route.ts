import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createStayWithCalendarSync } from "@/lib/stays";
import { parseStayDate } from "@/lib/stay-dates";
import { StayInputError, validateStayInput } from "@/lib/stay-input";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const where: Record<string, unknown> = { deletedAt: null };
  if (from || to) {
    try {
      if (from) where.checkOut = { gt: parseStayDate(from) };
      if (to) where.checkIn = { lte: parseStayDate(to) };
    } catch { return NextResponse.json({ error: "Use valid from/to dates in YYYY-MM-DD format" }, { status: 400 }); }
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
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StayInputError("Enter visit details");
    const input = validateStayInput(body);
    const stay = await createStayWithCalendarSync({ ...input, allowRoomOverlap: body.allowRoomOverlap === true });
    return NextResponse.json(stay);
  } catch (error) {
    if (error instanceof StayInputError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status });
    console.error("Stay creation error:", error);
    return NextResponse.json(
      { error: "Failed to create stay" },
      { status: 500 }
    );
  }
}
