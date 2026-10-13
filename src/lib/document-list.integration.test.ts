import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const databaseUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
test("PostgreSQL archive search finds mixed-case text and all 105 permitted records without leaking vault counts", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname));
  const before = { DATABASE_URL: process.env.DATABASE_URL, FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  process.env.DATABASE_URL = databaseUrl;
  process.env.FAMILY_PINS = "Synthetic:9231";
  process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
  const { prisma } = await import("./prisma");
  const { GET } = await import("../app/api/documents/route");
  const { createAuthToken, getAuthCookieName } = await import("./auth");
  const { getArchiveHealth } = await import("./archive-health");
  const prefix = `archive-list-test-${randomUUID()}`;
  const ids = Array.from({ length: 109 }, (_, index) => `${prefix}-${String(index).padStart(3, "0")}`);
  try {
    const healthBefore = await getArchiveHealth(["family"]);
    const createdAfterMeasurement = new Date(`${healthBefore.verification.measuredAt}T00:00:00Z`);
    createdAfterMeasurement.setUTCDate(createdAfterMeasurement.getUTCDate() + 1);
    await prisma.document.createMany({ data: ids.map((id, index) => ({
      id, title: `Roof-${prefix}`, fileName: `${id}.txt`, filePath: `/uploads/${id}.txt`, fileType: "text/plain", fileSize: 0,
      accessScope: index < 105 ? "family" : "vault", analysisState: "pending", createdAt: createdAfterMeasurement,
    })) });
    const token = await createAuthToken("Synthetic");
    const headers = { Cookie: `${getAuthCookieName()}=${token}` };
    const found = new Set<string>();
    for (const offset of [0, 50, 100]) {
      const response = await GET(new NextRequest(`https://breadloafhill.com/api/documents?q=${encodeURIComponent(`ROOF-${prefix.toUpperCase()}`)}&offset=${offset}`, { headers }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Total-Count"), "105");
      const data = await response.json() as { id: string; accessScope: string }[];
      assert.equal(data.length, offset === 100 ? 5 : 50);
      assert.equal(response.headers.get("X-Has-More"), String(offset < 100));
      for (const doc of data) { assert.equal(doc.accessScope, "family"); assert.ok(ids.includes(doc.id)); assert.ok(!found.has(doc.id)); found.add(doc.id); }
    }
    assert.equal(found.size, 105);
    const unknown = await GET(new NextRequest(`https://breadloafhill.com/api/documents?category=${prefix}`, { headers }));
    assert.deepEqual(await unknown.json(), []);
    assert.equal(unknown.headers.get("X-Total-Count"), "0");
    const healthResponse = await GET(new NextRequest("https://breadloafhill.com/api/documents?healthOnly=true", { headers }));
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as { totalDocuments: number; issueDocuments: number; documentsAddedAfterMeasurement: number; issues: { id: string }[] };
    assert.equal(health.totalDocuments, healthBefore.totalDocuments + 105);
    assert.equal(health.issueDocuments, healthBefore.issueDocuments + 105);
    assert.equal(health.documentsAddedAfterMeasurement, healthBefore.documentsAddedAfterMeasurement + 105);
    assert.ok(health.issues.every((issue) => !ids.slice(105).includes(issue.id)));
  } finally {
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
