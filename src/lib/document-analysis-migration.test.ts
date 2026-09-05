import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

// Reproduce the legacy CHECK constraint, which prisma db push cannot model.
// Use only an explicitly supplied disposable database and an isolated schema.
const testUrl = process.env.BUCKY_JOB_TEST_DATABASE_URL;
test("pending analysis migration preserves historical states and keeps invalid values rejected", { skip: !testUrl }, async () => {
  const schema = `analysis_state_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new PrismaClient({ datasourceUrl: testUrl });
  const scopedUrl = new URL(testUrl!);
  scopedUrl.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: scopedUrl.toString() });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    await db.$executeRawUnsafe('CREATE TABLE "Document" ("id" TEXT PRIMARY KEY, "analysisState" TEXT NOT NULL DEFAULT \'provider_error\')');
    const historical = await readFile("prisma/migrations/20260805220000_add_document_analysis_state/migration.sql", "utf8");
    const check = historical.match(/ADD CONSTRAINT "Document_analysisState_check"[\s\S]*?;/)?.[0];
    assert.ok(check, "The historical migration must contain the original constraint");
    await db.$executeRawUnsafe(`ALTER TABLE "Document" ${check}`);
    const states = ["ok", "unsupported_type", "too_large", "provider_error"];
    for (const state of states) await db.$executeRaw`INSERT INTO "Document" ("id", "analysisState") VALUES (${state}, ${state})`;
    await assert.rejects(db.$executeRaw`INSERT INTO "Document" ("id", "analysisState") VALUES ('pending-before', 'pending')`, /Document_analysisState_check/);

    const migration = await readFile("prisma/migrations/20260905130000_allow_pending_document_analysis/migration.sql", "utf8");
    await db.$executeRawUnsafe(migration);
    await db.$executeRaw`INSERT INTO "Document" ("id", "analysisState") VALUES ('pending-after', 'pending')`;
    await db.$executeRaw`UPDATE "Document" SET "analysisState" = 'ok' WHERE "id" = 'pending-after'`;
    await db.$executeRaw`UPDATE "Document" SET "analysisState" = 'pending' WHERE "id" = 'pending-after'`;
    await assert.rejects(db.$executeRaw`INSERT INTO "Document" ("id", "analysisState") VALUES ('invalid', 'anything_goes')`, /Document_analysisState_check/);
    const rows = await db.$queryRaw<Array<{ analysisState: string }>>`SELECT "analysisState" FROM "Document" ORDER BY "analysisState"`;
    assert.deepEqual(rows.map((row) => row.analysisState), [...states, "pending"].sort());
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
});
