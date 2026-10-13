import assert from "node:assert/strict";
import test from "node:test";
import { stableCalendarEventId, syncCalendarStay, type CalendarSyncProvider, type CalendarSyncStay, type CalendarSyncStore } from "./calendar-sync-engine";

function fixture() {
  const row: CalendarSyncStay = { id: "visit", guestName: "Tom", checkIn: new Date("2026-11-25"), checkOut: new Date("2026-12-01"),
    notes: null, roomId: null, status: "confirmed", googleEventId: null, deletedAt: null, calendarSyncRevision: 0, calendarSyncState: "pending" };
  let lease: Date | null = null;
  let error: string | null = null;
  const store: CalendarSyncStore = {
    async claim(id, now, until) {
      if (id !== row.id || row.calendarSyncState === "synced" || (lease && lease > now)) return null;
      lease = until; return { ...row };
    },
    async rememberEventId(_id, eventId, until) { if (lease?.getTime() === until.getTime() && !row.googleEventId) row.googleEventId = eventId; },
    async settle(_id, revision, until, failure) {
      if (row.calendarSyncRevision !== revision || lease?.getTime() !== until.getTime()) return false;
      row.calendarSyncState = failure ? "error" : "synced"; error = failure; return true;
    },
    async release(_id, until) { if (lease?.getTime() === until.getTime()) lease = null; },
  };
  return { row, store, error: () => error, lease: () => lease };
}

test("an insert with a lost response retries the same external event, without duplicating it", async () => {
  const { row, store } = fixture();
  const external = new Set<string>();
  let calls = 0;
  const provider: CalendarSyncProvider = { async upsert(_stay, eventId) { external.add(eventId); if (++calls === 1) throw new Error("Response lost"); }, async remove() {} };
  assert.equal((await syncCalendarStay(store, provider, row.id)).synced, false);
  assert.equal(row.calendarSyncState, "error");
  assert.equal(row.googleEventId, stableCalendarEventId(row.id));
  assert.equal((await syncCalendarStay(store, provider, row.id)).synced, true);
  assert.equal(external.size, 1);
});

test("failed deletion preserves a tombstone and retries instead of resurrecting the visit", async () => {
  const { row, store } = fixture();
  row.deletedAt = new Date(); row.googleEventId = "existing-google-event";
  let available = false, deletes = 0, writes = 0;
  const provider: CalendarSyncProvider = { async upsert() { writes++; }, async remove() { deletes++; if (!available) throw new Error("Unavailable"); } };
  await syncCalendarStay(store, provider, row.id);
  assert.equal(row.calendarSyncState, "error"); assert.ok(row.deletedAt);
  available = true;
  assert.equal((await syncCalendarStay(store, provider, row.id)).synced, true);
  assert.equal(writes, 0); assert.equal(deletes, 2); assert.ok(row.deletedAt);
});

test("a newer family edit remains pending when an older Google write finishes", async () => {
  const { row, store } = fixture();
  const names: string[] = [];
  const provider: CalendarSyncProvider = { async upsert(stay) {
    names.push(stay.guestName);
    if (names.length === 1) { row.guestName = "Jim"; row.calendarSyncRevision++; row.calendarSyncState = "pending"; }
  }, async remove() {} };
  assert.equal((await syncCalendarStay(store, provider, row.id)).synced, false);
  assert.equal(row.calendarSyncState, "pending");
  assert.equal((await syncCalendarStay(store, provider, row.id)).synced, true);
  assert.deepEqual(names, ["Tom", "Jim"]);
});

test("two concurrent requests cannot both claim the same live sync lease", async () => {
  const { row, store } = fixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const provider: CalendarSyncProvider = { async upsert() { writes++; await waiting; }, async remove() {} };
  const first = syncCalendarStay(store, provider, row.id);
  assert.equal((await syncCalendarStay(store, provider, row.id)).attempted, false);
  release(); await first;
  assert.equal(writes, 1);
});
