import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const testUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
test("rollout migration preserves old mail and calendar links, approves unique eligible directory emails only", { skip: !testUrl }, async () => {
  const url = new URL(testUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const schema = `family_rollout_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new PrismaClient({ datasourceUrl: testUrl });
  url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    await db.$executeRawUnsafe('CREATE TABLE "Stay" ("id" TEXT PRIMARY KEY, "googleEventId" TEXT)');
    await db.$executeRawUnsafe('CREATE TABLE "EmailLog" ("id" TEXT PRIMARY KEY)');
    await db.$executeRawUnsafe('CREATE TABLE "FamilyMember" ("id" TEXT PRIMARY KEY, "email" TEXT, "canClaim" BOOLEAN DEFAULT true, "isMinor" BOOLEAN DEFAULT false, "deceased" BOOLEAN DEFAULT false)');
    await db.$executeRawUnsafe('CREATE TABLE "FamilySession" ("id" TEXT PRIMARY KEY)');
    await db.$executeRawUnsafe(`INSERT INTO "Stay" VALUES ('linked', 'google-event'), ('unlinked', NULL)`);
    await db.$executeRawUnsafe(`INSERT INTO "EmailLog" VALUES ('historical')`);
    const cases = [
      ["approved", "  FAMILY@example.com ", true, false, false],
      ["shared-one", "shared@example.com", true, false, false],
      ["shared-two", "SHARED@example.com", true, false, false],
      ["minor", "minor@example.com", true, true, false],
      ["deceased", "deceased@example.com", true, false, true],
      ["ineligible", "former@example.com", false, false, false],
      ["invalid", "bad address", true, false, false],
      ["missing", null, true, false, false],
    ] as const;
    for (const [id, email, canClaim, isMinor, deceased] of cases) await db.$executeRaw`INSERT INTO "FamilyMember" ("id", "email", "canClaim", "isMinor", "deceased") VALUES (${id}, ${email}, ${canClaim}, ${isMinor}, ${deceased})`;
    const sql = await readFile("prisma/migrations/20261013160000_family_access_and_reliability/migration.sql", "utf8");
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(statement => statement.trim())) await db.$executeRawUnsafe(statement);
    const members = await db.$queryRaw<Array<{ id: string; email: string | null; accessApproved: boolean }>>`SELECT "id", "email", "accessApproved" FROM "FamilyMember"`;
    assert.deepEqual(members.filter(member => member.accessApproved).map(member => member.id), ["approved"]);
    assert.equal(members.find(member => member.id === "approved")?.email, "family@example.com");
    const stays = await db.$queryRaw<Array<{ id: string; calendarSyncState: string }>>`SELECT "id", "calendarSyncState" FROM "Stay" ORDER BY "id"`;
    assert.deepEqual(stays, [{ id: "linked", calendarSyncState: "synced" }, { id: "unlinked", calendarSyncState: "pending" }]);
    const mail = await db.$queryRaw<Array<{ status: string; sourceChecksum: string | null }>>`SELECT "status", "sourceChecksum" FROM "EmailLog"`;
    assert.deepEqual(mail, [{ status: "completed", sourceChecksum: null }]);
    await assert.rejects(db.$executeRaw`UPDATE "FamilyMember" SET "email" = 'FAMILY@example.com', "accessApproved" = true WHERE "id" = 'missing'`, /23505/);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
