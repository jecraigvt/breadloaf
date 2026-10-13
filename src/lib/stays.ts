import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { syncPendingCalendarStay } from "@/lib/google-calendar";
import { stayDateKey } from "@/lib/stay-dates";
import { StayInputError, validateStayInput, type StayInput } from "@/lib/stay-input";

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
  checkOut: Date,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string; guestName: string; checkIn: Date; checkOut: Date } | null> {
  const overlapping = await client.stay.findMany({
    where: {
      deletedAt: null,
      checkIn: { lt: checkOut },
      checkOut: { gt: checkIn },
    },
    select: { id: true, guestName: true, checkIn: true, checkOut: true },
  });
  return overlapping.find((s) => guestNamesMatch(s.guestName, guestName)) ?? null;
}

interface CreateStayInput {
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  roomId?: string | null;
  notes?: string | null;
  status?: string;
  allowRoomOverlap?: boolean;
}

/** Used by mail intake when a visit and its intake outcome must commit together. */
export async function createStayInTransaction(tx: Prisma.TransactionClient, input: CreateStayInput) {
  const data = validateStayInput({ ...input, checkIn: stayDateKey(input.checkIn), checkOut: stayDateKey(input.checkOut) });
  const key = `visit:${data.guestName.toLowerCase()}:${stayDateKey(data.checkIn)}:${stayDateKey(data.checkOut)}:${data.roomId || ""}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  const existing = await tx.stay.findFirst({ where: { guestName: { equals: data.guestName, mode: "insensitive" },
    roomId: data.roomId, checkIn: data.checkIn, checkOut: data.checkOut, deletedAt: null }, include: { room: true } });
  if (existing) return { stay: existing, created: false };
  await checkRoomConflicts(tx, data, input.allowRoomOverlap === true);
  return { stay: await tx.stay.create({ data: { ...data, calendarSyncState: "pending" }, include: { room: true } }), created: true };
}

export async function createStayWithCalendarSync(input: CreateStayInput) {
  const { stay, created } = await prisma.$transaction((tx) => createStayInTransaction(tx, input));
  await syncPendingCalendarStay(stay.id).catch(() => {});
  return { ...(await prisma.stay.findUnique({ where: { id: stay.id }, include: { room: true } }) || stay), alreadyExisted: !created };
}

async function checkRoomConflicts(tx: Prisma.TransactionClient, input: StayInput, allowRoomOverlap: boolean, excludeId?: string) {
  if (!input.roomId) return;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`room:${input.roomId}`}, 0))`;
  const room = await tx.room.findUnique({ where: { id: input.roomId } });
  if (!room) throw new StayInputError("That room is no longer available. Choose another room or Decide later");
  // Tents and off-site locations are shared locations, not individual bed reservations.
  if (allowRoomOverlap || room.type === "tent" || room.type === "offsite") return;
  const overlapping = await tx.stay.findMany({ where: {
    roomId: input.roomId, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}),
    checkIn: { lt: input.checkOut }, checkOut: { gt: input.checkIn },
  }, select: { id: true, guestName: true, checkIn: true, checkOut: true, status: true }, orderBy: { checkIn: "asc" } });
  if (overlapping.length) throw new StayInputError(`${room.name} already has a visit during these dates. Check whether you will be sharing the room.`, 409,
    overlapping.map((stay) => ({ ...stay, checkIn: stayDateKey(stay.checkIn), checkOut: stayDateKey(stay.checkOut) })));
}

export async function updateStayWithCalendarSync(id: string, body: Record<string, unknown>) {
  const stay = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Stay" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.stay.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new StayInputError("This visit has been removed", 404);
    if (body.expectedRevision !== undefined && body.expectedRevision !== current.calendarSyncRevision) {
      throw new StayInputError("Someone else changed this visit. Close this form and reopen it to see the latest details.", 409);
    }
    const data = validateStayInput(body, current);
    const assignmentChanged = data.roomId !== current.roomId || stayDateKey(data.checkIn) !== stayDateKey(current.checkIn)
      || stayDateKey(data.checkOut) !== stayDateKey(current.checkOut);
    if (assignmentChanged) await checkRoomConflicts(tx, data, body.allowRoomOverlap === true, current.id);
    return tx.stay.update({ where: { id }, data: { ...data, calendarSyncState: "pending", calendarSyncError: null,
      calendarSyncRevision: { increment: 1 } }, include: { room: true } });
  });
  await syncPendingCalendarStay(id).catch(() => {});
  return await prisma.stay.findUnique({ where: { id }, include: { room: true } }) || stay;
}

export async function deleteStayWithCalendarSync(id: string) {
  const stay = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Stay" WHERE "id" = ${id} FOR UPDATE`;
    const current = await tx.stay.findUnique({ where: { id } });
    if (!current) throw new StayInputError("Visit not found", 404);
    if (current.deletedAt) return current;
    return tx.stay.update({ where: { id }, data: { deletedAt: new Date(), calendarSyncState: "pending",
      calendarSyncError: null, calendarSyncRevision: { increment: 1 } } });
  });
  await syncPendingCalendarStay(stay.id).catch(() => {});
  const result = await prisma.stay.findUnique({ where: { id } });
  return { success: true, calendarSyncState: result?.calendarSyncState || "pending" };
}
