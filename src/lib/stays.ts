import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/google-calendar";

// Shared stay creation + dedupe, used by the Mail Room (email inlet) and
// Bucky (assistant inlet) so both behave identically: same duplicate
// detection, same Google Calendar sync.

// Family surnames are shared by everyone, so they can't distinguish one
// branch's stay from another's — only first names/nicknames count.
const NAME_STOPWORDS = new Set([
  "the", "and", "family", "families", "kids", "crew",
  "craig", "craigs", "keller", "kellers", "devlin", "devlins", "noyes", "noye",
]);

const GENERIC_STOPWORDS = new Set(["the", "and", "family", "families", "kids", "crew"]);

function allNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !GENERIC_STOPWORDS.has(t))
    // singularize so "the Kellers" matches "Rob Keller" (consistent both sides)
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function nameTokens(name: string): string[] {
  return allNameTokens(name).filter((t) => !NAME_STOPWORDS.has(t));
}

export function guestNamesMatch(a: string, b: string): boolean {
  const at = nameTokens(a);
  const bt = nameTokens(b);
  // Prefer first names/nicknames — surnames are shared family-wide
  if (at.length > 0 && bt.length > 0) return at.some((t) => bt.includes(t));
  // One side is surname-only ("The Kellers") — compare with surnames included
  const aAll = allNameTokens(a);
  const bAll = allNameTokens(b);
  return aAll.some((t) => bAll.includes(t));
}

// A stay is a duplicate if the date ranges overlap AND the guest names
// match — overlapping stays by different branches are normal.
export async function findOverlappingStay(
  guestName: string,
  checkIn: Date,
  checkOut: Date
): Promise<{ id: string; guestName: string; checkIn: Date; checkOut: Date } | null> {
  const overlapping = await prisma.stay.findMany({
    where: {
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
    },
    select: { id: true, guestName: true, checkIn: true, checkOut: true },
  });
  return overlapping.find((s) => guestNamesMatch(s.guestName, guestName)) ?? null;
}

export async function createStayWithCalendarSync(input: {
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  roomId?: string | null;
  notes?: string | null;
  status?: string;
}) {
  const stay = await prisma.stay.create({
    data: {
      guestName: input.guestName,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      roomId: input.roomId ?? null,
      notes: input.notes ?? null,
      status: input.status ?? "confirmed",
    },
    include: { room: true },
  });
  try {
    await createCalendarEvent(stay);
  } catch (err) {
    console.error("Calendar sync failed for new stay:", err);
  }
  return stay;
}
