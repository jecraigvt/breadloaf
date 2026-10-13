import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventChanged, missingEventCanDelete, normalizeCalendarEvent } from "./calendar-reconciliation";
import { parseStayDate } from "./stay-dates";

const event = { id: "google-event", summary: "Tom at Breadloaf Hill", start: { date: "2026-11-25" }, end: { date: "2026-12-01" }, description: "Room: Tom Craig\nArriving late" };

test("note-only edits and cleared notes count as changes; room metadata is not a user note", () => {
  const normalized = normalizeCalendarEvent(event)!;
  const stay = { guestName: "Tom", checkIn: normalized.checkIn, checkOut: normalized.checkOut, notes: "Arriving late", roomId: "room-tom" };
  assert.equal(calendarEventChanged(stay, normalized, "room-tom"), false);
  assert.equal(calendarEventChanged(stay, normalizeCalendarEvent({ ...event, description: "Room: Tom Craig\nArriving at noon" })!, "room-tom"), true);
  assert.equal(calendarEventChanged(stay, normalizeCalendarEvent({ ...event, description: "Room: Tom Craig" })!, "room-tom"), true);
  assert.equal(normalizeCalendarEvent({ ...event, description: "No room assigned" })!.notes, null);
  assert.equal(calendarEventChanged(stay, normalized, "room-jim"), true);
  assert.equal(calendarEventChanged({ ...stay, checkIn: new Date("2026-11-25T04:00:00Z") }, normalized, "room-tom"), true);
});

test("partial rolling calendar windows cannot erase past local visits", () => {
  const windowStart = parseStayDate("2026-07-13");
  const active = { checkOut: parseStayDate("2026-12-01"), deletedAt: null, calendarSyncState: "synced" };
  assert.equal(missingEventCanDelete(active, windowStart), true);
  assert.equal(missingEventCanDelete({ ...active, checkOut: parseStayDate("2026-05-01") }, windowStart), false);
  assert.equal(missingEventCanDelete({ ...active, checkOut: windowStart }, windowStart), false);
  assert.equal(missingEventCanDelete({ ...active, calendarSyncState: "pending" }, windowStart), false);
  assert.equal(missingEventCanDelete({ ...active, calendarSyncState: "error" }, windowStart), false);
  assert.equal(missingEventCanDelete({ ...active, deletedAt: new Date() }, windowStart), false);
});

test("timed Google events use the property's timezone; invalid and cancelled events are ignored", () => {
  const normalized = normalizeCalendarEvent({ ...event, start: { dateTime: "2026-10-14T02:00:00Z" }, end: { dateTime: "2026-10-14T04:00:00Z" } })!;
  assert.equal(normalized.checkIn.toISOString(), "2026-10-13T00:00:00.000Z");
  assert.equal(normalized.checkOut.toISOString(), "2026-10-14T00:00:00.000Z");
  assert.equal(normalizeCalendarEvent({ ...event, start: { date: "2026-02-31" } }), null);
  assert.equal(normalizeCalendarEvent({ ...event, status: "cancelled" }), null);
});

test("requested plans round-trip while an explicit Google confirmation wins", () => {
  const metadata = { private: { breadloafStatus: "requested" } };
  assert.equal(normalizeCalendarEvent({ ...event, status: "tentative", extendedProperties: metadata })!.status, "requested");
  assert.equal(normalizeCalendarEvent({ ...event, status: "confirmed", extendedProperties: metadata })!.status, "confirmed");
  const normalized = normalizeCalendarEvent({ ...event, status: "tentative" })!;
  assert.equal(calendarEventChanged({ guestName: "Tom", checkIn: normalized.checkIn, checkOut: normalized.checkOut, notes: normalized.notes, roomId: "room", status: "confirmed" }, normalized, "room"), true);
});
