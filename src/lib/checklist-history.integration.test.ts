import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { archiveChecklistAndReset } from "./checklist-history";

const testUrl = process.env.CHECKLIST_TEST_DATABASE_URL;
test("season history retains completion and reset rolls back if history cannot be stored", { skip: !testUrl }, async () => {
  const schema = "checklist_test_" + randomUUID().replace(/-/g, "");
  const admin = new PrismaClient({ datasourceUrl: testUrl });
  const scoped = new URL(testUrl!); scoped.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: scoped.toString() });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    await db.$executeRawUnsafe('CREATE TABLE "ChecklistItem" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "list" TEXT NOT NULL, "section" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL, "checked" BOOLEAN NOT NULL, "checkedBy" TEXT, "checkedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await db.$executeRawUnsafe('CREATE TABLE "ChecklistRun" ("id" TEXT PRIMARY KEY, "list" TEXT NOT NULL, "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "archivedBy" TEXT, "items" JSONB NOT NULL)');
    const completed = await db.checklistItem.create({ data: { name: "Water off", list: "closing", section: "Water System", sortOrder: 0, checked: true, checkedBy: "Jeremy", checkedAt: new Date("2026-10-13T16:00:00Z") } });
    const run = await archiveChecklistAndReset(db, "closing", "Jeremy");
    const snapshot = run.items as Array<{ checked: boolean; checkedBy: string; checkedAt: string }>;
    assert.equal(snapshot[0].checked, true); assert.equal(snapshot[0].checkedBy, "Jeremy"); assert.equal(snapshot[0].checkedAt, "2026-10-13T16:00:00.000Z");
    assert.equal((await db.checklistItem.findUniqueOrThrow({ where: { id: completed.id } })).checked, false);
    await db.checklistItem.update({ where: { id: completed.id }, data: { checked: true, checkedBy: "Jeremy" } });
    await db.$executeRawUnsafe('ALTER TABLE "ChecklistRun" ADD CONSTRAINT "Reject_new_runs" CHECK ("list" <> \'closing\') NOT VALID');
    await assert.rejects(archiveChecklistAndReset(db, "closing", "Jeremy"));
    assert.equal((await db.checklistItem.findUniqueOrThrow({ where: { id: completed.id } })).checked, true);
    assert.equal(await db.checklistRun.count(), 1);
  } finally { await db.$disconnect(); await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await admin.$disconnect(); }
});
