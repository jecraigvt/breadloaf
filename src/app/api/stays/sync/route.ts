import { NextResponse } from "next/server";
import { syncFromGoogleCalendar } from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const result = await syncFromGoogleCalendar();
  const pending = await prisma.stay.count({ where: { calendarSyncState: { not: "synced" } } });
  return NextResponse.json({ ...result, pending });
}
