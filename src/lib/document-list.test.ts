import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createAuthToken, getAuthCookieName } from "./auth";
import { GET } from "../app/api/documents/route";

test("actual archive handler searches without case sensitivity and pages beyond 100 with scoped counts", async () => {
  const old = { findMany: prisma.document.findMany, count: prisma.document.count, category: prisma.category.findUnique };
  const env = { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  try {
    process.env.FAMILY_PINS = "Synthetic:9231";
    process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
    const token = await createAuthToken("Synthetic");
    const headers = { Cookie: `${getAuthCookieName()}=${token}` };
    const source = Array.from({ length: 109 }, (_, index) => ({ id: `synthetic-${index}`, title: "Roof inspection", accessScope: index < 105 ? "family" : "vault", fileType: "text/plain", filePath: `/uploads/synthetic-${index}.txt` }));
    let queries = 0;
    const eligible = (where: Prisma.DocumentWhereInput) => {
      assert.deepEqual(where.accessScope, { in: ["family"] });
      assert.equal(where.deletedAt, null);
      assert.ok(Array.isArray(where.OR));
      for (const field of where.OR) {
        const search = Object.values(field)[0] as { contains: string; mode: string };
        assert.equal(search.contains, "rOoF");
        assert.equal(search.mode, "insensitive");
      }
      return source.filter(doc => doc.accessScope === "family");
    };
    (prisma.document as unknown as { findMany: unknown }).findMany = async (args: { where: Prisma.DocumentWhereInput; take: number; skip: number; orderBy: unknown }) => {
      queries++;
      assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
      return eligible(args.where).slice(args.skip, args.skip + args.take);
    };
    (prisma.document as unknown as { count: unknown }).count = async (args: { where: Prisma.DocumentWhereInput }) => { queries++; return eligible(args.where).length; };
    (prisma.category as unknown as { findUnique: unknown }).findUnique = async () => null;
    const ids = new Set<string>();
    for (const offset of [0, 50, 100]) {
      const response = await GET(new NextRequest(`https://breadloafhill.com/api/documents?q=rOoF&offset=${offset}`, { headers }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Total-Count"), "105", "private documents must not inflate the result count");
      const data = await response.json() as { id: string; accessScope: string }[];
      assert.equal(data.length, offset === 100 ? 5 : 50);
      assert.equal(response.headers.get("X-Has-More"), String(offset < 100));
      assert.equal(response.headers.get("X-Next-Offset"), String(offset + data.length));
      for (const doc of data) { assert.equal(doc.accessScope, "family"); ids.add(doc.id); }
    }
    assert.equal(ids.size, 105);
    const before = queries;
    const unknown = await GET(new NextRequest("https://breadloafhill.com/api/documents?category=does-not-exist", { headers }));
    assert.deepEqual(await unknown.json(), []);
    assert.equal(unknown.headers.get("X-Total-Count"), "0");
    assert.equal(queries, before, "an unknown category must not broaden into all documents");
    for (const query of ["limit=101", "limit=0", "offset=-1", "offset=NaN", `q=${"a".repeat(301)}`]) {
      assert.equal((await GET(new NextRequest(`https://breadloafhill.com/api/documents?${query}`, { headers }))).status, 400);
    }
  } finally {
    prisma.document.findMany = old.findMany; prisma.document.count = old.count; prisma.category.findUnique = old.category;
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
