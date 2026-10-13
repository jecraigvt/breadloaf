import assert from "node:assert/strict";
import test from "node:test";
import { google } from "googleapis";
import { prisma } from "./prisma";
import { syncFromGoogleCalendar } from "./google-calendar";

async function fixture(options: { pushFails?: boolean; pullFails?: boolean }, work: () => Promise<void>) {
  const env = { GOOGLE_SERVICE_ACCOUNT_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID };
  const originals = { calendar: google.calendar, updateMany: prisma.stay.updateMany, findMany: prisma.stay.findMany,
    findUnique: prisma.stay.findUnique, rooms: prisma.room.findMany, log: console.error };
  const stay = { id: "synthetic-stay", guestName: "Synthetic Guest", checkIn: new Date("2026-11-25T00:00:00Z"),
    checkOut: new Date("2026-12-01T00:00:00Z"), notes: null, roomId: null, room: null, status: "confirmed",
    googleEventId: "synthetic-event", deletedAt: null, calendarSyncRevision: 1, calendarSyncState: "pending" };
  try {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "{}"; process.env.GOOGLE_CALENDAR_ID = "synthetic-calendar";
    (google as unknown as { calendar: unknown }).calendar = () => ({ events: {
      get: async () => ({ data: { etag: "synthetic-etag" } }),
      patch: async () => { if (options.pushFails) throw new Error("PRIVATE calendar provider response"); return {}; },
      list: async () => { if (options.pullFails) throw new Error("PRIVATE calendar provider response"); return { data: { items: [] } }; },
    } });
    (prisma.stay as unknown as { updateMany: unknown }).updateMany = async () => ({ count: 1 });
    (prisma.stay as unknown as { findUnique: unknown }).findUnique = async () => stay;
    (prisma.stay as unknown as { findMany: unknown }).findMany = async (input: { where: { googleEventId?: unknown } }) => input.where.googleEventId ? [] : [{ id: stay.id }];
    (prisma.room as unknown as { findMany: unknown }).findMany = async () => [];
    console.error = () => {};
    await work();
  } finally {
    google.calendar = originals.calendar; prisma.stay.updateMany = originals.updateMany; prisma.stay.findMany = originals.findMany;
    prisma.stay.findUnique = originals.findUnique; prisma.room.findMany = originals.rooms; console.error = originals.log;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("the actual calendar wrapper exposes a failed push even when the Google listing succeeds", async () => {
  await fixture({ pushFails: true }, async () => {
    const result = await syncFromGoogleCalendar();
    assert.equal(result.pushAttempted, 1); assert.equal(result.pushSynced, 0); assert.equal(result.pushFailed, 1);
    assert.ok(result.error); assert.equal(result.error.includes("PRIVATE"), false);
  });
});

test("successful outbound and inbound calendar passes report success and actual push counts", async () => {
  await fixture({}, async () => {
    const result = await syncFromGoogleCalendar();
    assert.equal(result.pushAttempted, 1); assert.equal(result.pushSynced, 1); assert.equal(result.pushFailed, 0); assert.equal(result.error, undefined);
  });
});

test("a failed inbound listing preserves successful outbound counts and reports failure", async () => {
  await fixture({ pullFails: true }, async () => {
    const result = await syncFromGoogleCalendar();
    assert.equal(result.pushSynced, 1); assert.equal(result.pushFailed, 0); assert.ok(result.error); assert.equal(result.error.includes("PRIVATE"), false);
  });
});
