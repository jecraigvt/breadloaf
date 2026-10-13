import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { GMAIL_SEND_SCOPE, MailDeliveryBudgetError, MailDeliveryError, PROPERTY_EMAIL_ACCOUNT, mailDeliveryConfigured, sendPropertyEmail, type PropertyEmail } from "./mail-delivery";
import { sendFamilyAccessRequestNotice, sendFamilySignInEmail } from "./family-sign-in-email";
import { sendBuckyQuestionNotification } from "./outbound-email";
import { prisma } from "./prisma";

const oauth = { GMAIL_SEND_CLIENT_ID: "synthetic-client.apps.googleusercontent.com", GMAIL_SEND_CLIENT_SECRET: "synthetic-client-secret",
  GMAIL_SEND_REFRESH_TOKEN: "synthetic-refresh-token", GMAIL_APP_PASSWORD: "unused-synthetic-password", RAILWAY_PROJECT_ID: "synthetic-hobby" };
const message = { displayName: "Breadloaf Hill" as const, to: "synthetic@example.test", subject: "A Vermont visit — welcome", text: "A retained message.\nSecond line.",
  html: "<p>A retained message.</p>", headers: { "Auto-Submitted": "auto-generated", "X-Breadloaf-Notification": "family-sign-in" } };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const reserveAttempt = async () => true;

function provider(changes: { scope?: string; email?: string; verified?: boolean; status?: number; sendBody?: unknown; lostResponse?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const raw: Buffer[] = [];
  const fetcher: typeof fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal);
    if (String(url) === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("client_id"), oauth.GMAIL_SEND_CLIENT_ID);
      assert.equal(body.get("refresh_token"), oauth.GMAIL_SEND_REFRESH_TOKEN);
      return json({ access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600,
        scope: changes.scope ?? `${GMAIL_SEND_SCOPE} openid https://www.googleapis.com/auth/userinfo.email` });
    }
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-access-token");
    if (String(url) === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: changes.email ?? PROPERTY_EMAIL_ACCOUNT, email_verified: changes.verified ?? true });
    assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(init.method, "POST");
    const encoded = JSON.parse(String(init.body)).raw;
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    raw.push(Buffer.from(encoded, "base64url"));
    if (changes.lostResponse) throw new Error("synthetic private provider detail and token");
    return json(changes.sendBody ?? { id: "synthetic-message-id" }, changes.status ?? 200);
  };
  return { calls, raw, fetcher };
}

async function fixtureEnvironment(work: () => Promise<void>) {
  const keys = [...Object.keys(oauth), "APP_URL", "FAMILY_EMAIL_TEST_SMTP_PORT", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_PUBLIC_DOMAIN"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, oauth, { APP_URL: "https://breadloafhill.com" });
    await work();
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
}

test("Gmail HTTPS refreshes a narrowly scoped property grant and sends complete base64url MIME", async () => {
  const fake = provider();
  const result = await sendPropertyEmail(message, { env: oauth, fetch: fake.fetcher, reserveAttempt });
  assert.deepEqual(result, { provider: "gmail-api" });
  assert.equal(fake.calls.length, 3);
  const parsed = await simpleParser(fake.raw[0]);
  assert.equal(parsed.from?.value[0].address, PROPERTY_EMAIL_ACCOUNT);
  assert.equal(parsed.to && !Array.isArray(parsed.to) ? parsed.to.value[0].address : null, message.to);
  assert.equal(parsed.subject, message.subject);
  assert.equal(parsed.text?.trim(), message.text);
  assert.equal(parsed.html, message.html);
  assert.equal(parsed.headers.get("auto-submitted"), "auto-generated");
  assert.equal(parsed.headers.get("x-breadloaf-notification"), "family-sign-in");
});

test("configuration rejects partial OAuth and blocked Railway SMTP while retaining isolated local SMTP", async () => {
  assert.equal(mailDeliveryConfigured({}), false);
  assert.equal(mailDeliveryConfigured({ GMAIL_APP_PASSWORD: "fixture-password" }), true);
  assert.equal(mailDeliveryConfigured({ GMAIL_APP_PASSWORD: "fixture-password", RAILWAY_PROJECT_ID: "fixture" }), false);
  for (const key of ["GMAIL_SEND_CLIENT_ID", "GMAIL_SEND_CLIENT_SECRET", "GMAIL_SEND_REFRESH_TOKEN"]) {
    assert.equal(mailDeliveryConfigured({ ...oauth, [key]: "" }), false);
    await assert.rejects(sendPropertyEmail(message, { env: { ...oauth, [key]: "" }, fetch: async () => { throw new Error("No provider call permitted"); } }), MailDeliveryError);
  }
  const local = { ...oauth, APP_URL: "http://127.0.0.1:3000", DATABASE_URL: "postgresql://fixture@127.0.0.1:55438/breadloaf_test", FAMILY_EMAIL_TEST_SMTP_PORT: "12525" };
  assert.equal(mailDeliveryConfigured(local), true);
  const original = nodemailer.createTransport;
  let closed = false;
  try {
    nodemailer.createTransport = ((configuration: unknown) => {
      assert.equal((configuration as { host: string }).host, "127.0.0.1");
      return { sendMail: async () => undefined, close: () => { closed = true; } };
    }) as unknown as typeof original;
    assert.deepEqual(await sendPropertyEmail(message, { env: local, fetch: async () => { throw new Error("Local mail must not call Google"); } }), { provider: "test-smtp" });
    assert.equal(closed, true);
  } finally { nodemailer.createTransport = original; }
});

test("a wrong account, unverified identity or broad/missing Gmail scope cannot send or fall back to SMTP", async () => {
  const original = nodemailer.createTransport;
  let smtpCalls = 0;
  try {
    nodemailer.createTransport = (() => { smtpCalls++; throw new Error("No SMTP fallback permitted"); }) as typeof original;
    for (const changes of [{ email: "other@example.test" }, { verified: false }, { scope: "openid email" },
      { scope: `${GMAIL_SEND_SCOPE} openid email https://www.googleapis.com/auth/gmail.readonly` }, { scope: `${GMAIL_SEND_SCOPE} openid` }]) {
      const fake = provider(changes);
      await assert.rejects(sendPropertyEmail(message, { env: oauth, fetch: fake.fetcher, reserveAttempt }), MailDeliveryError);
      assert.equal(fake.raw.length, 0);
    }
    assert.equal(smtpCalls, 0);
  } finally { nodemailer.createTransport = original; }
});

test("HTTP rejection, lost responses and malformed success never claim delivery or repeat a send", async () => {
  for (const changes of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { sendBody: {} }, { lostResponse: true }]) {
    const fake = provider(changes);
    await assert.rejects(sendPropertyEmail(message, { env: oauth, fetch: fake.fetcher, reserveAttempt }), error => error instanceof MailDeliveryError && !error.message.includes("private"));
    assert.equal(fake.raw.length, 1);
    assert.equal(fake.calls.length, 3);
  }
});

test("native HTTP redirects cannot move credentials to another destination", async () => {
  let firstRequests = 0, redirectedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirected") { redirectedRequests++; response.end("unexpected"); return; }
    firstRequests++; response.writeHead(302, { Location: "/redirected" }); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(sendPropertyEmail(message, { env: oauth, reserveAttempt, fetch: (_url, init) => fetch(`http://127.0.0.1:${address.port}/token`, init) }), MailDeliveryError);
    assert.equal(firstRequests, 1); assert.equal(redirectedRequests, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("header injection and oversized provider/message content fail closed", async () => {
  const invalid: Partial<PropertyEmail>[] = [{ subject: "Unexpected\r\nBcc: other@example.test" }, { to: "first@example.test,other@example.test" },
    { headers: { "Auto-Submitted": "auto-generated\r\nBcc: other@example.test" } }, { headers: { Bcc: "other@example.test" } },
    { headers: { "Reply-To": "other@example.test" } }, { text: "x".repeat(1024 * 1024 + 1) }];
  for (const changes of invalid) {
    const fake = provider();
    await assert.rejects(sendPropertyEmail({ ...message, ...changes }, { env: oauth, fetch: fake.fetcher, reserveAttempt }), MailDeliveryError);
    assert.equal(fake.calls.length, 0);
  }
  await assert.rejects(sendPropertyEmail(message, { env: oauth, reserveAttempt, fetch: async () => new Response("x".repeat(64 * 1024 + 1)) }), MailDeliveryError);
});

test("family links, caretaker requests and Bucky notifications all use the verified HTTPS transport", async () => {
  await fixtureEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    const findMany = prisma.familyMember.findMany, findFirst = prisma.familyMember.findFirst, queryRaw = prisma.$queryRaw;
    const fake = provider();
    try {
      globalThis.fetch = fake.fetcher;
      (prisma as unknown as { $queryRaw: unknown }).$queryRaw = async () => [{ count: 1 }];
      (prisma.familyMember as unknown as { findMany: unknown }).findMany = async () => [{ email: "caretaker@example.test" }];
      (prisma.familyMember as unknown as { findFirst: unknown }).findFirst = async () => ({ email: "recipient@example.test" });
      await sendFamilySignInEmail("recipient@example.test", "synthetic-token", "Family & Guest");
      await sendFamilyAccessRequestNotice("Requesting Guest", "requesting@example.test");
      assert.deepEqual(await sendBuckyQuestionNotification({ questionId: "synthetic-question", targetPerson: "Recipient" }), { status: "sent", recipientCount: 1 });
      assert.equal(fake.raw.length, 3);
      const emails = await Promise.all(fake.raw.map(raw => simpleParser(raw)));
      assert.ok(emails.every(email => email.from?.value[0].address === PROPERTY_EMAIL_ACCOUNT));
      assert.match(emails[0].text!, /https:\/\/breadloafhill\.com\/login\/confirm#token=synthetic-token/);
      assert.match(String(emails[0].html), /Family &amp; Guest/);
      assert.equal(emails[1].headers.get("x-breadloaf-notification"), "family-access-request");
      assert.equal(emails[2].headers.get("x-breadloaf-question-id"), "synthetic-question");
      assert.equal(emails[2].headers.get("x-breadloaf-notification"), "bucky-question");
      assert.match(emails[2].text!, /question itself stays inside the family site/);
    } finally { globalThis.fetch = originalFetch; prisma.familyMember.findMany = findMany; prisma.familyMember.findFirst = findFirst; prisma.$queryRaw = queryRaw; }
  });
});

test("one shared daily reservation precedes real provider work and failed sends consume their attempt", async () => {
  const fake = provider({ status: 500 });
  let attempts = 0;
  const reserve = async (limit: number, windowMs: number) => {
    assert.equal(limit, 100); assert.equal(windowMs, 86400000); attempts++; return attempts === 1;
  };
  await assert.rejects(sendPropertyEmail(message, { env: oauth, fetch: fake.fetcher, reserveAttempt: reserve }), MailDeliveryError);
  await assert.rejects(sendPropertyEmail(message, { env: oauth, fetch: fake.fetcher, reserveAttempt: reserve }), MailDeliveryBudgetError);
  assert.equal(attempts, 2); assert.equal(fake.raw.length, 1);
  const limited = provider();
  await sendPropertyEmail(message, { env: { ...oauth, GMAIL_SEND_DAILY_BUDGET: "25" }, fetch: limited.fetcher,
    reserveAttempt: async limit => { assert.equal(limit, 25); return true; } });
  await assert.rejects(sendPropertyEmail(message, { env: { ...oauth, GMAIL_SEND_DAILY_BUDGET: "101" }, fetch: limited.fetcher, reserveAttempt }), MailDeliveryError);
});
