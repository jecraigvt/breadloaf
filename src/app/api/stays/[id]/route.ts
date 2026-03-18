import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google-calendar";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await request.json();
    const updateData: Record<string, unknown> = {};

    if (data.guestName !== undefined) updateData.guestName = data.guestName.trim();
    if (data.roomId !== undefined) updateData.roomId = data.roomId || null;
    if (data.checkIn !== undefined) updateData.checkIn = new Date(data.checkIn);
    if (data.checkOut !== undefined) updateData.checkOut = new Date(data.checkOut);
    if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null;
    if (data.status !== undefined) updateData.status = data.status;

    const stay = await prisma.stay.update({
      where: { id: params.id },
      data: updateData,
      include: { room: true },
    });

    // Sync update to Google Calendar (non-blocking)
    if (stay.googleEventId) {
      updateCalendarEvent(stay.googleEventId, stay).catch((err) =>
        console.error("Calendar update failed:", err)
      );
    }

    return NextResponse.json(stay);
  } catch (error) {
    console.error("Stay update error:", error);
    return NextResponse.json(
      { error: "Failed to update stay" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get the stay first to check for Google event
    const stay = await prisma.stay.findUnique({ where: { id: params.id } });

    await prisma.stay.delete({ where: { id: params.id } });

    // Remove from Google Calendar (non-blocking)
    if (stay?.googleEventId) {
      deleteCalendarEvent(stay.googleEventId).catch((err) =>
        console.error("Calendar delete failed:", err)
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stay delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete stay" },
      { status: 500 }
    );
  }
}
