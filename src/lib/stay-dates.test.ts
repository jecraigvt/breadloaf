import assert from "node:assert/strict";
import test from "node:test";
import { daysUntilStay, localCalendarDay, parseStayDate, propertyToday, stayActiveOnDay, stayDateKey, stayDisplayDate, stayNights } from "./stay-dates";
import { googleVisitTemplate } from "./stay-calendar-links";
import { StayInputError, validateStayInput, visitRangesOverlap } from "./stay-input";

test("a Vermont visit has the same displayed, occupied and exported dates in every guest timezone", () => {
  const original = process.env.TZ;
  try {
    const stay = { guestName: "Family", notes: null, checkIn: parseStayDate("2026-11-25"), checkOut: parseStayDate("2026-12-01") };
    for (const zone of ["America/New_York", "America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(localCalendarDay(stayDisplayDate(stay.checkIn)), "2026-11-25", zone);
      assert.equal(stayDateKey(stay.checkOut), "2026-12-01", zone);
      assert.equal(stayActiveOnDay(stay, new Date("2026-11-24T12:00:00")), false, zone);
      assert.equal(stayActiveOnDay(stay, new Date("2026-11-25T12:00:00")), true, zone);
      assert.equal(stayActiveOnDay(stay, new Date("2026-12-01T12:00:00")), false, zone);
      assert.equal(new URL(googleVisitTemplate(stay, "Jim")).searchParams.get("dates"), "20261125/20261201", zone);
      assert.equal(stayNights(stay.checkIn, stay.checkOut), 6, zone);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("DST does not change night counts and today is the Vermont calendar day", () => {
  assert.equal(stayNights("2026-03-07", "2026-03-09"), 2);
  assert.equal(stayNights("2026-10-31", "2026-11-02"), 2);
  assert.equal(propertyToday(new Date("2026-10-14T02:00:00Z")), "2026-10-13");
  assert.equal(daysUntilStay("2026-10-14", new Date("2026-10-14T02:00:00Z")), 1);
});

test("invalid calendar days and the fake unassigned room never reach persistence", () => {
  for (const value of ["2026-02-29", "2026-02-31", "2026-13-01", "not-a-date", "2026-10-13T00:00:00Z"]) assert.throws(() => parseStayDate(value));
  const valid = { guestName: " Tom ", checkIn: "2026-10-20", checkOut: "2026-10-24", roomId: null };
  assert.equal(validateStayInput(valid).guestName, "Tom");
  assert.throws(() => validateStayInput({ ...valid, roomId: "unassigned" }), StayInputError);
  assert.throws(() => validateStayInput({ ...valid, checkOut: valid.checkIn }), StayInputError);
  assert.throws(() => validateStayInput({ ...valid, status: "invented" }), StayInputError);
  assert.throws(() => validateStayInput({ ...valid, notes: {} }), StayInputError);
});

test("a departure and arrival on the same date do not conflict", () => {
  const first = { checkIn: parseStayDate("2026-10-20"), checkOut: parseStayDate("2026-10-24") };
  assert.equal(visitRangesOverlap(first, { checkIn: parseStayDate("2026-10-24"), checkOut: parseStayDate("2026-10-28") }), false);
  assert.equal(visitRangesOverlap(first, { checkIn: parseStayDate("2026-10-23"), checkOut: parseStayDate("2026-10-28") }), true);
});
