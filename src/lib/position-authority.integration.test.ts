import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const databaseUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
test("position changes recheck the real device and current role inside the access lock before writing", { skip: !databaseUrl }, async () => {
  const location = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && /test/i.test(location.pathname));
  const before = { DATABASE_URL: process.env.DATABASE_URL, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  process.env.DATABASE_URL = databaseUrl;
  process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "true";
  const { prisma } = await import("./prisma");
  const { issueFamilySignInLink, redeemFamilySignInLink } = await import("./family-access");
  const { getCurrentActor } = await import("./actor");
  const { getAuthCookieName } = await import("./auth");
  const { lockVerifiedActorForAccessChange } = await import("./access-policy");
  const { executeToolFunction } = await import("./ai");
  const { REMEMBERED_TOKEN_PREFIX } = await import("./sign-in-policy");
  const prefix = `position-authority-test-${randomUUID()}`;
  const memberIds = [`${prefix}-actor`, `${prefix}-target`];
  try {
    const actorMember = await prisma.familyMember.create({ data: { id: memberIds[0], name: memberIds[0], email: `${prefix}@example.test`, accessApproved: true, canClaim: true, isMinor: false, isCurator: true } });
    const target = await prisma.familyMember.create({ data: { id: memberIds[1], name: memberIds[1] } });
    const issue = await issueFamilySignInLink(actorMember.email!, "/assistant");
    assert.ok(issue);
    const redemption = await redeemFamilySignInLink(issue!.token, "Disposable authority fixture");
    const request = new NextRequest("https://breadloafhill.com/api/assistant", { headers: { Cookie: `${getAuthCookieName()}=${REMEMBERED_TOKEN_PREFIX}${redemption.token}` } });
    const actor = await getCurrentActor(request);
    assert.ok(actor?.verified && actor.isCurator);
    const context = { actor, authorizeFamilyChange: (tx: Parameters<typeof lockVerifiedActorForAccessChange>[0]) => lockVerifiedActorForAccessChange(tx, request, actor!) };
    const args = { personName: target.name, position: prefix, effectiveDate: "2026-10-13", sourceType: "family_instruction", source: "Disposable authority fixture" };
    assert.equal((await executeToolFunction("update_position", args, actor!.fullName, { actor })).success, false, "A captured identity without request-bound verification grants no administrative write");
    await prisma.familySession.updateMany({ where: { memberId: actorMember.id }, data: { revokedAt: new Date() } });
    assert.equal((await executeToolFunction("update_position", args, actor!.fullName, context)).success, false);
    assert.equal(await prisma.positionAssignment.count({ where: { position: prefix } }), 0);
    await prisma.familySession.updateMany({ where: { memberId: actorMember.id }, data: { revokedAt: null } });
    await prisma.familyMember.update({ where: { id: actorMember.id }, data: { isCurator: false } });
    assert.equal((await executeToolFunction("update_position", args, actor!.fullName, context)).success, false, "Captured privileges cannot survive role demotion");
    assert.equal(await prisma.positionAssignment.count({ where: { position: prefix } }), 0);
    await prisma.familyMember.update({ where: { id: actorMember.id }, data: { isCurator: true } });
    assert.equal((await executeToolFunction("update_position", args, actor!.fullName, context)).success, true);
    assert.equal(await prisma.positionAssignment.count({ where: { position: prefix } }), 1);
    assert.equal((await prisma.familyMember.findUniqueOrThrow({ where: { id: target.id } })).isBoardMember, true);
    assert.equal((await executeToolFunction("update_position", { ...args, personName: actorMember.name }, actor!.fullName, context)).success, true);
    const formerHolder = await prisma.familyMember.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(formerHolder.boardRole, null);
    assert.equal(formerHolder.isBoardMember, false, "Ending the last position removes its board authority");
  } finally {
    await prisma.positionAssignment.deleteMany({ where: { position: prefix } });
    await prisma.familySignInLink.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.familySession.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.familyMember.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.$disconnect();
    for (const [name, value] of Object.entries(before)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
