import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { REMEMBERED_DEVICE_MS, REMEMBERED_TOKEN_PREFIX, hashSignInSecret } from "./sign-in-policy";

const databaseUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const prefix = `family-auth-test-${Date.now()}`;
const memberIds: string[] = [];
const accessRequestIds: string[] = [];
const rateKeys: string[] = [];
let db: (typeof import("./prisma"))["prisma"];
let access: typeof import("./family-access");
let actors: typeof import("./actor");
let auth: typeof import("./auth");
let limiter: typeof import("./auth-rate-limit");
let accessRoute: typeof import("../app/api/access/route");
let calendarTokenRoute: typeof import("../app/api/calendar/token/route");
let familyProfileRoute: typeof import("../app/api/family/[id]/route");

before(async () => {
  if (!databaseUrl) return;
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("Auth tests require a valid disposable loopback database URL"); }
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname), "Auth tests require a disposable loopback database named test");
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET = "local-fixture-auth-secret-only";
  process.env.FAMILY_PINS = "Tom:fixture-transition-pin";
  process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "true";
  process.env.CALENDAR_FEED_SECRET = "local-fixture-calendar-feed-secret-only";
  access = await import("./family-access");
  actors = await import("./actor");
  auth = await import("./auth");
  limiter = await import("./auth-rate-limit");
  accessRoute = await import("../app/api/access/route");
  calendarTokenRoute = await import("../app/api/calendar/token/route");
  familyProfileRoute = await import("../app/api/family/[id]/route");
  db = (await import("./prisma")).prisma;
  try {
    await db.familyMember.findFirst({ where: { id: "no-auth-fixture" }, select: { accessApproved: true } });
    await db.familySignInLink.count({ where: { id: "no-auth-fixture" } });
    await db.authRateLimit.count({ where: { key: "no-auth-fixture" } });
  } catch { throw new Error("Disposable database is missing the family email-access schema; apply the local test schema before running these tests"); }
});

after(async () => {
  if (!db) return;
  await db.familySignInLink.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.familySession.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.familyAccessRequest.deleteMany({ where: { id: { in: accessRequestIds } } });
  await db.familyMember.deleteMany({ where: { id: { in: memberIds } } });
  await db.authRateLimit.deleteMany({ where: { key: { in: rateKeys } } });
  await db.$disconnect();
});

async function member(tag: string, changes: Record<string, unknown> = {}) {
  const row = await db.familyMember.create({ data: { name: `Fixture ${prefix}-${tag}`, displayName: "Fixture", branch: "Tom",
    email: `${prefix}-${tag}@example.test`, accessApproved: true, canClaim: true, isMinor: false, ...changes } });
  memberIds.push(row.id);
  return row;
}

function request(token: string, face = false) {
  return new NextRequest("http://127.0.0.1:3000/api/documents", { headers: {
    cookie: face ? `${actors.getIdentityCookieName()}=${token}` : `${auth.getAuthCookieName()}=${REMEMBERED_TOKEN_PREFIX}${token}`,
  } });
}

async function signedIn(tag: string, changes: Record<string, unknown> = {}) {
  const person = await member(tag, changes);
  const issued = await access.issueFamilySignInLink(person.email!, "/calendar");
  assert.ok(issued, "An approved adult receives a sign-in link");
  const redeemed = await access.redeemFamilySignInLink(issued!.token, "local regression browser");
  const tokenHash = await actors.hashIdentityToken(redeemed.token);
  const session = await db.familySession.findUniqueOrThrow({ where: { tokenHash } });
  return { person, issued: issued!, redeemed, session, tokenHash };
}

async function changeAccess(token: string, body: Record<string, unknown>) {
  return accessRoute.PATCH(new NextRequest("http://127.0.0.1:3000/api/access", { method: "PATCH", headers: {
    "content-type": "application/json", cookie: `${auth.getAuthCookieName()}=${REMEMBERED_TOKEN_PREFIX}${token}`,
  }, body: JSON.stringify(body) }));
}

async function waitForBlockedTransactions(holderPid: number, count: number) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid))
      UNION
      SELECT activity.pid FROM pg_stat_activity activity JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
    ) SELECT count(*) AS count FROM blocked`;
    if (Number(rows[0].count) >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("The concurrent requests did not reach the held member lock");
}

test("only a unique approved adult email can receive a sign-in link", { skip: !enabled }, async () => {
  const unapproved = await member("unapproved", { accessApproved: false });
  const minor = await member("minor", { isMinor: true });
  const deceased = await member("deceased", { deceased: true });
  const cannotClaim = await member("cannot-claim", { canClaim: false });
  for (const person of [unapproved, minor, deceased, cannotClaim]) assert.equal(await access.issueFamilySignInLink(person.email!, "/"), null);
  assert.equal(await access.issueFamilySignInLink(`${prefix}-unknown@example.test`, "/"), null);
  const first = await member("duplicate");
  await member("duplicate-two", { email: first.email });
  assert.equal(await access.issueFamilySignInLink(first.email!, "/"), null);
});

test("helper normalization accepts mixed-case and whitespace around approved addresses", { skip: !enabled }, async () => {
  const person = await member("normalized");
  const issued = await access.issueFamilySignInLink(`  ${person.email!.toUpperCase()}  `, "/calendar");
  assert.ok(issued, "Normalize the address at the helper boundary, not only the HTTP route");
  const redeemed = await access.redeemFamilySignInLink(issued!.token, null);
  assert.equal(redeemed.destination, "/calendar");
});

test("links and remembered sessions store one-way verifiers, never plaintext tokens", { skip: !enabled }, async () => {
  const { person, issued, redeemed, session } = await signedIn("verifiers", { isCurator: true, isBoardMember: true });
  const stored = await db.familySignInLink.findUniqueOrThrow({ where: { id: issued.id } });
  assert.ok(stored.tokenHash === hashSignInSecret(issued.token) && stored.tokenHash !== issued.token, "The link row stores its hash only");
  assert.ok(!JSON.stringify(stored).includes(issued.token), "No link token is saved in another column");
  assert.ok(session.tokenHash !== redeemed.token && !JSON.stringify(session).includes(redeemed.token), "No session token is saved in plaintext");
  assert.equal(session.claimedVia, "email"); assert.ok(session.verifiedAt);
  const remembered = await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${redeemed.token}`);
  assert.ok(remembered && remembered.memberId === person.id);
  const actor = await actors.getCurrentActor(request(redeemed.token));
  assert.equal(actor?.verified, true); assert.equal(actor?.isCurator, true); assert.equal(actor?.isBoardMember, true);
  assert.equal(await actors.getDoorFamily(request(redeemed.token)), "Tom");
});

test("a remembered email device receives a separately scoped calendar subscription token", { skip: !enabled }, async () => {
  const { redeemed } = await signedIn("calendar-subscription");
  const response = await calendarTokenRoute.GET(request(redeemed.token));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(await auth.getFamilyFromCalendarFeedToken(body.token), "Tom");
  assert.equal(await auth.getFamilyFromAuthToken(body.token), null, "The feed token cannot become a family door cookie");
  assert.equal((await calendarTokenRoute.GET(new NextRequest("http://127.0.0.1:3000/api/calendar/token"))).status, 401);
});

test("an expired or already-used link never creates another session", { skip: !enabled }, async () => {
  const expired = await member("expired-link");
  const issued = await access.issueFamilySignInLink(expired.email!, "/");
  assert.ok(issued);
  await db.familySignInLink.update({ where: { id: issued!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(access.redeemFamilySignInLink(issued!.token, null), access.SignInLinkError);
  assert.equal(await db.familySession.count({ where: { memberId: expired.id } }), 0);
  const active = await signedIn("single-use");
  await assert.rejects(access.redeemFamilySignInLink(active.issued.token, null), access.SignInLinkError);
  assert.equal(await db.familySession.count({ where: { memberId: active.person.id } }), 1);
});

test("concurrent redemption of one link has exactly one winner", { skip: !enabled }, async () => {
  const person = await member("concurrent-redemption");
  const issued = await access.issueFamilySignInLink(person.email!, "/documents");
  assert.ok(issued);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => access.redeemFamilySignInLink(issued!.token, null)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.status === "rejected" && result.reason instanceof access.SignInLinkError));
  assert.equal(await db.familySession.count({ where: { memberId: person.id } }), 1);
});

test("removing approval invalidates both remembered access and remembered-door actor resolution", { skip: !enabled }, async () => {
  const { person, redeemed } = await signedIn("approval-removed", { isCurator: true, isBoardMember: true });
  await db.familyMember.update({ where: { id: person.id }, data: { accessApproved: false } });
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${redeemed.token}`), null);
  assert.equal(await actors.getDoorFamily(request(redeemed.token)), null);
  assert.equal(await actors.getCurrentActor(request(redeemed.token)), null, "An invalid remembered door must not supply an actor");
});

test("caretaker revocation serializes ahead of concurrent link issue and redemption", { skip: !enabled }, async () => {
  const caretaker = await signedIn("revoke-caretaker", { isCurator: true });
  const target = await signedIn("concurrent-revoke-target");
  const outstanding = await access.issueFamilySignInLink(target.person.email!, "/calendar");
  assert.ok(outstanding);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let locked!: (pid: number) => void;
  const lockReady = new Promise<number>(resolve => { locked = resolve; });
  const blocker = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${target.person.id} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    locked(rows[0].pid);
    await held;
  }, { timeout: 10000 });
  const pid = await lockReady;
  const revocation = changeAccess(caretaker.redeemed.token, { action: "revoke", memberId: target.person.id });
  let results: PromiseSettledResult<unknown>[];
  try {
    await waitForBlockedTransactions(pid, 1);
    const issuance = access.issueFamilySignInLink(target.person.email!, "/");
    const redemption = access.redeemFamilySignInLink(outstanding!.token, null);
    const concurrent = Promise.allSettled([issuance, redemption]);
    await waitForBlockedTransactions(pid, 3);
    release();
    await blocker;
    assert.equal((await revocation).status, 200);
    results = await concurrent;
  } finally { release(); await blocker; }
  assert.deepEqual(results![0], { status: "fulfilled", value: null });
  assert.ok(results![1].status === "rejected" && results![1].reason instanceof access.SignInLinkError);
  assert.equal(await db.familySession.count({ where: { memberId: target.person.id, revokedAt: null } }), 0);
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${target.redeemed.token}`), null);
});

test("same-address reapproval does not resurrect a revoked device or old email link", { skip: !enabled }, async () => {
  const caretaker = await signedIn("reapproval-caretaker", { isCurator: true });
  const target = await signedIn("reapproval-target");
  const outstanding = await access.issueFamilySignInLink(target.person.email!, "/");
  assert.ok(outstanding);
  assert.equal((await changeAccess(caretaker.redeemed.token, { action: "revoke", memberId: target.person.id })).status, 200);
  assert.equal((await changeAccess(caretaker.redeemed.token, { action: "approve", memberId: target.person.id, email: target.person.email })).status, 200);
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${target.redeemed.token}`), null);
  assert.equal(await actors.getCurrentActor(request(target.redeemed.token)), null);
  await assert.rejects(access.redeemFamilySignInLink(outstanding!.token, null), access.SignInLinkError);
  const fresh = await access.issueFamilySignInLink(target.person.email!, "/calendar");
  assert.ok(fresh);
  await access.redeemFamilySignInLink(fresh!.token, null);
  assert.equal(await db.familySession.count({ where: { memberId: target.person.id, revokedAt: null } }), 1);
});

test("simultaneous caretaker revocations retain one approved caretaker and deny the stale actor", { skip: !enabled }, async () => {
  const first = await signedIn("mutual-caretaker-first", { isCurator: true });
  const second = await signedIn("mutual-caretaker-second", { isCurator: true });
  const responses = await Promise.all([
    changeAccess(first.redeemed.token, { action: "revoke", memberId: second.person.id }),
    changeAccess(second.redeemed.token, { action: "revoke", memberId: first.person.id }),
  ]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(await db.familyMember.count({ where: { id: { in: [first.person.id, second.person.id] }, accessApproved: true, isCurator: true } }), 1);
  const removed = await db.familyMember.findFirstOrThrow({ where: { id: { in: [first.person.id, second.person.id] }, accessApproved: false } });
  const staleToken = removed.id === first.person.id ? first.redeemed.token : second.redeemed.token;
  const device = await signedIn("stale-caretaker-device-target");
  assert.equal((await changeAccess(staleToken, { action: "revoke-device", sessionId: device.session.id })).status, 403);
  assert.equal((await db.familySession.findUniqueOrThrow({ where: { id: device.session.id } })).revokedAt, null);
  const pending = await db.familyAccessRequest.create({ data: { name: "Disposable access request", email: `${prefix}-stale-caretaker-request@example.test` } });
  accessRequestIds.push(pending.id);
  assert.equal((await changeAccess(staleToken, { action: "dismiss-request", requestId: pending.id })).status, 403);
  assert.equal((await db.familyAccessRequest.findUniqueOrThrow({ where: { id: pending.id } })).status, "pending");
});

test("generic family profile editing cannot bypass approved-access revocation controls", { skip: !enabled }, async () => {
  const caretaker = await signedIn("profile-bypass-caretaker", { isCurator: true });
  const target = await signedIn("profile-bypass-target", { isCurator: true });
  const context = { params: Promise.resolve({ id: target.person.id }) };
  for (const body of [{ isCurator: false }, { canClaim: false }, { deceased: true }, { isMinor: true }, { email: `${prefix}-profile-changed@example.test` }]) {
    const response = await familyProfileRoute.PATCH(new NextRequest("http://127.0.0.1:3000/api/family/fixture", { method: "PATCH", headers: {
      "content-type": "application/json", cookie: `${auth.getAuthCookieName()}=${REMEMBERED_TOKEN_PREFIX}${caretaker.redeemed.token}`,
    }, body: JSON.stringify(body) }), context);
    assert.equal(response.status, 403);
  }
  const remove = await familyProfileRoute.DELETE(request(caretaker.redeemed.token), context);
  assert.equal(remove.status, 409);
  const saved = await db.familyMember.findUniqueOrThrow({ where: { id: target.person.id } });
  assert.ok(saved.accessApproved && saved.canClaim && saved.isCurator && !saved.deceased && !saved.isMinor);
  assert.equal(saved.email, target.person.email);
  assert.ok(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${target.redeemed.token}`));
});

test("changing an approved email invalidates old links and devices", { skip: !enabled }, async () => {
  const { person, redeemed } = await signedIn("email-changed", { isCurator: true });
  const outstanding = await access.issueFamilySignInLink(person.email!, "/");
  assert.ok(outstanding);
  await db.familyMember.update({ where: { id: person.id }, data: { email: `${prefix}-new-address@example.test` } });
  await assert.rejects(access.redeemFamilySignInLink(outstanding!.token, null), access.SignInLinkError);
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${redeemed.token}`), null);
  assert.equal(await actors.getCurrentActor(request(redeemed.token)), null);
});

test("a revoked or expired device cannot identify a verified actor", { skip: !enabled }, async () => {
  const revoked = await signedIn("revoked", { isCurator: true });
  await actors.revokeIdentitySession(revoked.redeemed.token);
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${revoked.redeemed.token}`), null);
  assert.equal(await actors.getCurrentActor(request(revoked.redeemed.token)), null);
  const expired = await signedIn("expired-device");
  await db.familySession.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${expired.redeemed.token}`), null);
  assert.equal(await actors.getCurrentActor(request(expired.redeemed.token)), null);
});

test("turning a member into a minor or nonclaimable member invalidates remembered authority", { skip: !enabled }, async () => {
  for (const [tag, change] of [["became-minor", { isMinor: true }], ["claim-disabled", { canClaim: false }], ["marked-deceased", { deceased: true }]] as const) {
    const { person, redeemed } = await signedIn(tag, { isCurator: true });
    await db.familyMember.update({ where: { id: person.id }, data: change });
    assert.equal(await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${redeemed.token}`), null);
    assert.equal(await actors.getCurrentActor(request(redeemed.token)), null);
  }
});

test("remembered access renews the device lifetime after a day of elapsed lifetime", { skip: !enabled }, async () => {
  const { redeemed, session } = await signedIn("renewal");
  const now = Date.now();
  await db.familySession.update({ where: { id: session.id }, data: { expiresAt: new Date(now + 10 * 86400000), lastUsedAt: new Date(now - 2 * 86400000) } });
  const remembered = await access.rememberedFamilySession(`${REMEMBERED_TOKEN_PREFIX}${redeemed.token}`);
  assert.ok(remembered);
  const saved = await db.familySession.findUniqueOrThrow({ where: { id: session.id } });
  assert.ok(saved.expiresAt.getTime() >= now + REMEMBERED_DEVICE_MS - 5000 && saved.expiresAt.getTime() <= Date.now() + REMEMBERED_DEVICE_MS + 5000);
  assert.ok(saved.lastUsedAt.getTime() >= now - 5000);
});

test("a face claim of a privileged family profile cannot inherit administrative roles", { skip: !enabled }, async () => {
  const person = await member("face-claimed-curator", { isCurator: true, isBoardMember: true });
  const token = await actors.createIdentitySession(person.id, { claimedVia: "tap" });
  const actor = await actors.getCurrentActor(request(token, true));
  assert.ok(actor && actor.memberId === person.id);
  assert.equal(actor?.verified, false); assert.equal(actor?.isCurator, false); assert.equal(actor?.isBoardMember, false);
  assert.equal(await actors.getVerifiedActor(request(token, true)), null);
});

test("the durable rate limit admits only its configured count across concurrent callers", { skip: !enabled }, async () => {
  const key = `${prefix}:concurrent-rate`;
  const hash = createHash("sha256").update(key).digest("hex"); rateKeys.push(hash);
  const results = await Promise.all(Array.from({ length: 20 }, () => limiter.consumeAuthAttempt(key, 5, 60000)));
  assert.equal(results.filter(Boolean).length, 5);
  const stored = await db.authRateLimit.findUniqueOrThrow({ where: { key: hash } });
  assert.equal(stored.count, 20);
  assert.ok(stored.key !== key, "Rate-limit rows contain no plaintext caller identifier");
  await db.authRateLimit.update({ where: { key: hash }, data: { windowEndsAt: new Date(Date.now() - 1000) } });
  assert.equal(await limiter.consumeAuthAttempt(key, 5, 60000), true);
  assert.equal((await db.authRateLimit.findUniqueOrThrow({ where: { key: hash } })).count, 1);
});
