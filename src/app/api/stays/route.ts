import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

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

    return NextResponse.json(stay);
  } catch (error) {
    console.error("Stay creation error:", error);
    return NextResponse.json(
      { error: "Failed to create stay" },
      { status: 500 }
    );
  }
}
