import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { GET } from "../app/api/access/route";

test("profile identity labels are available only to verified caretakers and omit raw birth dates and relationship rows", async () => {
  const original = { session: prisma.familySession.findUnique, members: prisma.familyMember.findMany, requests: prisma.familyAccessRequest.findMany };
  const actor = { id: "synthetic-caretaker", name: "Synthetic Caretaker", displayName: "Synthetic", branch: "North", boardRole: null,
    email: "synthetic@example.test", accessApproved: true, canClaim: true, isMinor: false, deceased: false, isCurator: true, isBoardMember: false };
  let verifiedAt: Date | null = new Date();
  let listReads = 0;
  prisma.familySession.findUnique = (async () => ({ id: "synthetic-session", member: actor, verifiedAt,
    verifiedEmail: actor.email, revokedAt: null, expiresAt: new Date(Date.now() + 60000), lastUsedAt: new Date() })) as unknown as typeof prisma.familySession.findUnique;
  prisma.familyMember.findMany = (async (input: unknown) => {
    listReads++;
    const query = input as { select: { relTo: { where: { type: string } } }; where: { isMinor: boolean; deceased: boolean; canClaim: boolean } };
    assert.deepEqual(query.where, { canClaim: true, isMinor: false, deceased: false });
    assert.equal(query.select.relTo.where.type, "parent");
    return [
      { id: "synthetic-first", name: "Alex Example", branch: "North", email: null, accessApproved: false, isCurator: false, birthday: "1951-02-03", relTo: [] },
      { id: "synthetic-second", name: "Alex Example", branch: "North", email: null, accessApproved: false, isCurator: false, birthday: "1981-09-10", relTo: [] },
    ];
  }) as unknown as typeof prisma.familyMember.findMany;
  prisma.familyAccessRequest.findMany = (async () => []) as unknown as typeof prisma.familyAccessRequest.findMany;
  const request = () => new NextRequest("https://breadloafhill.com/api/access", { headers: { Cookie: "breadloaf_session=v3.synthetic-device-token" } });
  try {
    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const data = await response.json() as { members: { profileLabel: string }[] };
    assert.deepEqual(data.members.map(member => member.profileLabel), ["Alex Example · North branch · born 1951", "Alex Example · North branch · born 1981"]);
    assert.ok(!JSON.stringify(data).includes("1951-02-03"));
    assert.ok(!JSON.stringify(data).includes("relTo"));
    actor.isCurator = false;
    assert.equal((await GET(request())).status, 403);
    actor.isCurator = true;
    verifiedAt = null;
    assert.equal((await GET(request())).status, 403);
    assert.equal(listReads, 1, "Unverified faces and ordinary family members do not load the caretaker identity details");
  } finally {
    prisma.familySession.findUnique = original.session;
    prisma.familyMember.findMany = original.members;
    prisma.familyAccessRequest.findMany = original.requests;
  }
});
