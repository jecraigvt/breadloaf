import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const databaseUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
test("property systems omit restricted document metadata and derived maintenance, including their counts", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const before = { DATABASE_URL: process.env.DATABASE_URL, FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  process.env.DATABASE_URL = databaseUrl;
  process.env.FAMILY_PINS = "Synthetic:9231";
  process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
  const { prisma } = await import("./prisma");
  const { GET } = await import("../app/api/assets/route");
  const { createAuthToken, getAuthCookieName } = await import("./auth");
  const prefix = `asset-access-test-${randomUUID()}`;
  const ids = [`${prefix}-family`, `${prefix}-vault`, `${prefix}-deleted`];
  const recordIds = [`${prefix}-visible-work`, `${prefix}-private-work`];
  try {
    await prisma.asset.create({ data: { id: prefix, name: prefix, category: "other" } });
    await prisma.document.createMany({ data: ids.map((id, index) => ({
      id, assetId: prefix, title: id, fileName: `${id}.wav`, filePath: `/uploads/${id}.wav`, fileType: "audio/wav", fileSize: 0,
      accessScope: index === 1 ? "vault" : "family", deletedAt: index === 2 ? new Date() : null,
    })) });
    await prisma.maintenanceRecord.createMany({ data: recordIds.map((id, index) => ({
      id, assetId: prefix, title: id, category: "General", performedAt: new Date("2026-10-01T00:00:00Z"),
      sourceRecordings: index === 1 ? [{ fileName: `${ids[1]}.wav`, filePath: `/uploads/${ids[1]}.wav`, transcript: "Restricted source canary" }] : [],
    })) });
    const token = await createAuthToken("Synthetic");
    const response = await GET(new NextRequest("https://breadloafhill.com/api/assets", { headers: { Cookie: `${getAuthCookieName()}=${token}` } }));
    assert.equal(response.status, 200);
    const rows = await response.json() as { id: string; documents: { id: string }[]; records: { id: string }[]; _count: { documents: number; records: number } }[];
    const asset = rows.find(row => row.id === prefix)!;
    assert.ok(asset);
    assert.deepEqual(asset.documents.map(doc => doc.id), [ids[0]]);
    assert.deepEqual(asset.records.map(record => record.id), [recordIds[0]]);
    assert.deepEqual(asset._count, { documents: 1, records: 1 });
    assert.ok(!JSON.stringify(asset).includes("Restricted source canary"));
  } finally {
    await prisma.maintenanceRecord.deleteMany({ where: { id: { in: recordIds } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
    await prisma.asset.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
