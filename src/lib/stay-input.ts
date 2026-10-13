import { parseStayDate, stayDateKey } from "./stay-dates";

export class StayInputError extends Error {
  constructor(message: string, public status = 400, public conflicts?: StayConflict[]) { super(message); }
}

export interface StayConflict { id: string; guestName: string; checkIn: string; checkOut: string; status: string }

export interface StayInput {
  guestName: string; roomId: string | null; checkIn: Date; checkOut: Date; notes: string | null; status: string;
}

export function validateStayInput(body: Record<string, unknown>, existing?: StayInput): StayInput {
  const guestName = body.guestName === undefined ? existing?.guestName : body.guestName;
  const roomId = body.roomId === undefined ? existing?.roomId ?? null : body.roomId;
  const status = body.status === undefined ? existing?.status || "confirmed" : body.status;
  const notes = body.notes === undefined ? existing?.notes ?? null : body.notes;
  if (typeof guestName !== "string" || !guestName.trim() || guestName.trim().length > 200) throw new StayInputError("Enter a guest or family name, up to 200 characters");
  if (roomId !== null && roomId !== "" && (typeof roomId !== "string" || roomId === "unassigned")) throw new StayInputError("Choose a room, or choose Decide later");
  if (typeof status !== "string" || !["confirmed", "tentative", "requested"].includes(status)) throw new StayInputError("Choose Confirmed, Maybe or Requested");
  if (notes !== null && (typeof notes !== "string" || notes.length > 4000)) throw new StayInputError("Notes must be text, up to 4,000 characters");
  let checkIn: Date, checkOut: Date;
  try {
    checkIn = body.checkIn === undefined && existing ? parseStayDate(stayDateKey(existing.checkIn)) : parseStayDate(body.checkIn);
    checkOut = body.checkOut === undefined && existing ? parseStayDate(stayDateKey(existing.checkOut)) : parseStayDate(body.checkOut);
  } catch { throw new StayInputError("Enter valid arrival and departure dates"); }
  if (checkOut <= checkIn) throw new StayInputError("Departure must be after arrival");
  return { guestName: guestName.trim(), roomId: (roomId || null) as string | null, checkIn, checkOut, notes: typeof notes === "string" ? notes.trim() || null : null, status };
}

export function visitRangesOverlap(a: { checkIn: Date; checkOut: Date }, b: { checkIn: Date; checkOut: Date }) {
  return a.checkIn < b.checkOut && a.checkOut > b.checkIn;
}
