import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICalText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET() {
  const stays = await prisma.stay.findMany({
    include: { room: true },
    orderBy: { checkIn: "asc" },
  });

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Breadloaf Hill//Family Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Breadloaf Hill Visits",
    "X-WR-TIMEZONE:America/New_York",
  ];

  for (const stay of stays) {
    const summary = stay.room
      ? `${stay.guestName} — ${stay.room.name}`
      : `${stay.guestName} — No room assigned`;

    const description = [
      stay.status !== "confirmed" ? `Status: ${stay.status}` : "",
      stay.room ? `Room: ${stay.room.name}` : "No room assigned yet",
      stay.notes || "",
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:stay-${stay.id}@breadloafhill`,
      `DTSTART;VALUE=DATE:${new Date(stay.checkIn).toISOString().slice(0, 10).replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${new Date(stay.checkOut).toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escapeICalText(summary)}`,
      `DESCRIPTION:${escapeICalText(description)}`,
      "LOCATION:Breadloaf Hill\\, Vermont",
      `STATUS:${stay.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
      `LAST-MODIFIED:${formatICalDate(new Date(stay.updatedAt))}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="breadloaf-hill.ics"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
