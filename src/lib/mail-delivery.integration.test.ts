import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { simpleParser } from "mailparser";

const databaseUrl = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const prefix = `mail-api-test-${randomUUID()}`;
const memberIds: string[] = [], requestEmails: string[] = [], rateKeys: string[] = [];
const budgetKey = createHash("sha256").update("property-email-outbound").digest("hex");
const envKeys = ["DATABASE_URL", "AUTH_SECRET", "APP_URL", "FAMILY_EMAIL_SIGN_IN_ENABLED", "GMAIL_SEND_CLIENT_ID", "GMAIL_SEND_CLIENT_SECRET", "GMAIL_SEND_REFRESH_TOKEN",
  "GMAIL_SEND_DAILY_BUDGET", "GMAIL_APP_PASSWORD", "FAMILY_EMAIL_TEST_SMTP_PORT", "BUCKY_NOTIFICATION_EMAILS", "RAILWAY_PROJECT_ID"];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let db: (typeof import("./prisma"))["prisma"];
let linkRoute: typeof import("../app/api/auth/link/route");
let requestRoute: typeof import("../app/api/auth/access-request/route");
let delivery: typeof import("./mail-delivery");
let access: typeof import("./family-access");
let familyMail: typeof import("./family-sign-in-email");
let notifications: typeof import("./outbound-email");
const rawMessages: Buffer[] = [];
let sendStatus = 200;

before(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) && /test/i.test(parsed.pathname), "Mail integration requires disposable loopback PostgreSQL named test");
  process.env.DATABASE_URL = databaseUrl;
  Object.assign(process.env, { AUTH_SECRET: "disposable-mail-api-fixture-only", APP_URL: "https://breadloafhill.com", FAMILY_EMAIL_SIGN_IN_ENABLED: "true",
    GMAIL_SEND_CLIENT_ID: "synthetic.apps.googleusercontent.com", GMAIL_SEND_CLIENT_SECRET: "synthetic-secret", GMAIL_SEND_REFRESH_TOKEN: "synthetic-refresh",
    GMAIL_SEND_DAILY_BUDGET: "100", RAILWAY_PROJECT_ID: "synthetic-hobby", GMAIL_APP_PASSWORD: "", FAMILY_EMAIL_TEST_SMTP_PORT: "", BUCKY_NOTIFICATION_EMAILS: "synthetic@example.test" });
  db = (await import("./prisma")).prisma;
  linkRoute = await import("../app/api/auth/link/route");
  requestRoute = await import("../app/api/auth/access-request/route");
  delivery = await import("./mail-delivery");
  access = await import("./family-access");
  familyMail = await import("./family-sign-in-email");
  notifications = await import("./outbound-email");
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.redirect, "error");
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600,
      scope: `${delivery.GMAIL_SEND_SCOPE} openid https://www.googleapis.com/auth/userinfo.email` });
    if (String(url) === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ email: delivery.PROPERTY_EMAIL_ACCOUNT, email_verified: true });
    assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    rawMessages.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url"));
    return Response.json(sendStatus === 200 ? { id: "synthetic-sent-id" } : { error: "synthetic private provider detail" }, { status: sendStatus });
  };
  await db.authRateLimit.deleteMany({ where: { key: budgetKey } });
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (db) {
    await db.familySignInLink.deleteMany({ where: { memberId: { in: memberIds } } });
    await db.familySession.deleteMany({ where: { memberId: { in: memberIds } } });
    await db.familyAccessRequest.deleteMany({ where: { email: { in: requestEmails } } });
    await db.familyMember.deleteMany({ where: { id: { in: memberIds } } });
    await db.authRateLimit.deleteMany({ where: { key: { in: [budgetKey, ...rateKeys] } } });
    await db.$disconnect();
  }
  for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
});

async function member(tag: string, caretaker = false) {
  const row = await db.familyMember.create({ data: { name: `Synthetic ${prefix}-${tag}`, displayName: "Synthetic", branch: "Tom", email: `${prefix}-${tag}@example.test`,
    accessApproved: true, canClaim: true, isMinor: false, deceased: false, isCurator: caretaker } });
  memberIds.push(row.id); return row;
}

function request(path: string, body: object, tag: string) {
  const ip = `${prefix}-${tag}`;
  const email = (body as { email: string }).email;
  const keyNames = path.includes("access-request") ? [`access-request-ip:${ip}`, `access-request-email:${email}`] : [`link-ip:${ip}`, `link-email:${email}`];
  rateKeys.push(...keyNames.map(key => createHash("sha256").update(key).digest("hex")));
  return new NextRequest(`https://breadloafhill.com${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
}

async function messageToken(raw: Buffer) {
  const parsed = await simpleParser(raw);
  const token = parsed.text?.match(/\/login\/confirm#token=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token); return token;
}

test("actual sign-in handler reports successful HTTPS delivery, while failed delivery invalidates its saved one-use link", { skip: !enabled }, async () => {
  const person = await member("signin");
  const result = await linkRoute.POST(request("/api/auth/link", { email: person.email, from: "/calendar" }, "success"));
  assert.equal(result.status, 200);
  const token = await messageToken(rawMessages.at(-1)!);
  const link = await db.familySignInLink.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  assert.equal(link?.destination, "/calendar"); assert.equal(link?.usedAt, null);
  assert.equal((await access.redeemFamilySignInLink(token, "synthetic HTTPS delivery browser")).destination, "/calendar");
  sendStatus = 500;
  const failed = await linkRoute.POST(request("/api/auth/link", { email: person.email }, "failure"));
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(await failed.json()), /private provider|synthetic-token/);
  const failedToken = await messageToken(rawMessages.at(-1)!);
  const failedLink = await db.familySignInLink.findUnique({ where: { tokenHash: createHash("sha256").update(failedToken).digest("hex") } });
  assert.ok(failedLink?.usedAt);
  await assert.rejects(access.redeemFamilySignInLink(failedToken, null), access.SignInLinkError);
  sendStatus = 200;
});

test("concurrent notifications and links share a durable attempt budget; exhausted sign-in is429 and access requests remain saved", { skip: !enabled }, async () => {
  await db.authRateLimit.deleteMany({ where: { key: budgetKey } });
  process.env.GMAIL_SEND_DAILY_BUDGET = "2";
  const person = await member("budget"), caretaker = await member("caretaker", true);
  assert.ok(caretaker.email);
  const initial = rawMessages.length;
  const results = await Promise.allSettled([
    familyMail.sendFamilySignInEmail(person.email!, "synthetic-not-a-signin-token", "Synthetic"),
    familyMail.sendFamilyAccessRequestNotice("Synthetic Guest", "guest@example.test"),
    notifications.sendBuckyQuestionNotification({ questionId: "synthetic-budget-question" }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof delivery.MailDeliveryBudgetError);
  assert.equal(rawMessages.length - initial, 2);
  const exhausted = await linkRoute.POST(request("/api/auth/link", { email: person.email }, "budget"));
  assert.equal(exhausted.status, 429); assert.equal(exhausted.headers.get("Retry-After"), "86400");
  assert.ok((await db.familySignInLink.findFirst({ where: { memberId: person.id } }))?.usedAt);
  const email = `${prefix}-request@example.test`; requestEmails.push(email);
  const saved = await requestRoute.POST(request("/api/auth/access-request", { name: "Synthetic Request", email }, "request"));
  assert.equal(saved.status, 200); assert.match((await saved.json()).message, /saved/);
  assert.equal((await db.familyAccessRequest.findUnique({ where: { email } }))?.status, "pending");
  assert.equal(rawMessages.length - initial, 2);
  const budget = await db.authRateLimit.findUnique({ where: { key: budgetKey } });
  assert.equal(budget?.count, 5);
  // An elapsed database-clock window replenishes the same shared budget.
  await db.authRateLimit.update({ where: { key: budgetKey }, data: { windowEndsAt: new Date(0) } });
  await familyMail.sendFamilySignInEmail(person.email!, "synthetic-new-window", "Synthetic");
  assert.equal((await db.authRateLimit.findUnique({ where: { key: budgetKey } }))?.count, 1);
  process.env.GMAIL_SEND_DAILY_BUDGET = "100";
});

test("partial OAuth configuration disables actual sign-in before issuing a link or calling a provider", { skip: !enabled }, async () => {
  const person = await member("partial");
  const beforeMessages = rawMessages.length;
  process.env.GMAIL_SEND_REFRESH_TOKEN = "";
  try {
    assert.equal((await linkRoute.POST(request("/api/auth/link", { email: person.email }, "partial"))).status, 503);
    assert.equal(await db.familySignInLink.count({ where: { memberId: person.id } }), 0);
    assert.equal(rawMessages.length, beforeMessages);
  } finally { process.env.GMAIL_SEND_REFRESH_TOKEN = "synthetic-refresh"; }
});
