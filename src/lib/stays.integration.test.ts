import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { StayInputError } from "./stay-input";

// Opt-in only. This file never inherits the production DATABASE_URL and never
// calls Google; fixtures are confined to a disposable loopback database.
const databaseUrl = process.env.STAY_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
let services: typeof import("./stays");
let db: (typeof import("./prisma"))["prisma"];
let roomId: string;
const prefix = `stay-test-${Date.now()}`;
const ids = new Set<string>();

before(async () => {
  if (!databaseUrl) return;
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("Stay tests require a valid disposable loopback database URL"); }
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname), "Stay tests require a disposable loopback database named test");
  process.env.DATABASE_URL = databaseUrl;
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "";
  process.env.GOOGLE_CALENDAR_ID = "";
  services = await import("./stays");
  db = (await import("./prisma")).prisma;
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "";
  process.env.GOOGLE_CALENDAR_ID = "";
  const room = await db.room.create({ data: { name: prefix, slug: prefix, type: "bedroom", minCapacity: 1, maxCapacity: 2 } });
  roomId = room.id;
});

after(async () => {
  if (!db) return;
  await db.stay.deleteMany({ where: { id: { in: Array.from(ids) } } });
  if (roomId) await db.room.delete({ where: { id: roomId } });
  await db.$disconnect();
});

function input(name: string, checkIn = "2026-11-25", checkOut = "2026-12-01") {
  return { guestName: `${prefix}-${name}`, checkIn: new Date(checkIn), checkOut: new Date(checkOut), roomId };
}

test("identical failed-response retries save one normalized visit with durable pending state", { skip: !enabled }, async () => {
  const first = await services.createStayWithCalendarSync(input("first")); ids.add(first.id);
  const retry = await services.createStayWithCalendarSync(input("first")); ids.add(retry.id);
  assert.equal(retry.id, first.id);
  assert.equal(first.alreadyExisted, false);
  assert.equal(retry.alreadyExisted, true);
  assert.equal(first.checkIn.toISOString(), "2026-11-25T00:00:00.000Z");
  assert.equal(first.calendarSyncState, "pending");
  assert.equal(await db.stay.count({ where: { guestName: first.guestName } }), 1);
});

test("room overlaps require deliberate sharing; departure-day handovers are accepted", { skip: !enabled }, async () => {
  await assert.rejects(services.createStayWithCalendarSync(input("overlap")), (error: unknown) => error instanceof StayInputError && error.status === 409 && Boolean(error.conflicts?.length));
  const shared = await services.createStayWithCalendarSync({ ...input("overlap"), allowRoomOverlap: true }); ids.add(shared.id);
  const adjacent = await services.createStayWithCalendarSync(input("adjacent", "2026-12-01", "2026-12-03")); ids.add(adjacent.id);
  assert.equal(adjacent.roomId, roomId);
});

test("an unassigned visit can be assigned and edited, with stale edits rejected", { skip: !enabled }, async () => {
  const unassigned = await services.createStayWithCalendarSync({ ...input("unassigned", "2027-02-01", "2027-02-04"), roomId: null }); ids.add(unassigned.id);
  const assigned = await services.updateStayWithCalendarSync(unassigned.id, { roomId, expectedRevision: unassigned.calendarSyncRevision, notes: "Arrival time" });
  assert.equal(assigned.roomId, roomId);
  const cleared = await services.updateStayWithCalendarSync(assigned.id, { notes: "", expectedRevision: assigned.calendarSyncRevision });
  assert.equal(cleared.notes, null);
  await assert.rejects(services.updateStayWithCalendarSync(assigned.id, { notes: "Stale draft", expectedRevision: assigned.calendarSyncRevision }), (error: unknown) => error instanceof StayInputError && error.status === 409);
  assert.equal((await db.stay.findUnique({ where: { id: assigned.id } }))!.notes, null);
});

test("deletion retains a retryable tombstone and does not participate in bookings or dedupe", { skip: !enabled }, async () => {
  const stay = await services.createStayWithCalendarSync(input("removed", "2027-03-01", "2027-03-04")); ids.add(stay.id);
  await db.stay.update({ where: { id: stay.id }, data: { googleEventId: `${prefix}-google` } });
  const result = await services.deleteStayWithCalendarSync(stay.id);
  const retained = await db.stay.findUnique({ where: { id: stay.id } });
  assert.equal(result.success, true); assert.ok(retained?.deletedAt);
  assert.equal(retained?.calendarSyncState, "pending");
  assert.equal(await db.stay.count({ where: { id: stay.id, deletedAt: null } }), 0);
  assert.equal(await services.findOverlappingStay(stay.guestName, stay.checkIn, stay.checkOut), null);
  const replacement = await services.createStayWithCalendarSync(input("replacement", "2027-03-01", "2027-03-04")); ids.add(replacement.id);
  assert.notEqual(replacement.id, stay.id);
});

test("two simultaneous room bookings warn one caller instead of silently overbooking", { skip: !enabled }, async () => {
  const results = await Promise.allSettled([
    services.createStayWithCalendarSync(input("concurrent-one", "2027-04-01", "2027-04-04")),
    services.createStayWithCalendarSync(input("concurrent-two", "2027-04-01", "2027-04-04")),
  ]);
  for (const result of results) if (result.status === "fulfilled") ids.add(result.value.id);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.status === "rejected" && result.reason instanceof StayInputError && result.reason.status === 409));
});

test("concurrent retries of an identical visit still create exactly one row", { skip: !enabled }, async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => services.createStayWithCalendarSync(input("concurrent-retry", "2027-04-10", "2027-04-12"))));
  for (const result of results) ids.add(result.id);
  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(results.filter((result) => !result.alreadyExisted).length, 1);
});
