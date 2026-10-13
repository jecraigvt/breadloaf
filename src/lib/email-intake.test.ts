import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ImapFlow } from "imapflow";
import { emailIntakeDisposition, gmailSenderAuthentication, rawEmailHeaders } from "./email-authentication";
import { parseInboundEmail, scanInbox, type MailboxCursor } from "./email-inbox";
import { readEmailSource, retainEmailSource } from "./email-source";
import { assertEmailLease, emailActionKey, emailRetryAt } from "./email-workflow";

function emailSource(extra: string = "", from = "relative@gmail.com") {
  return Buffer.from(`Received: from mail.example.com by mx.google.com with ESMTPS\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@gmail.com; spf=pass smtp.mailfrom=${from}; dmarc=pass header.from=gmail.com\r\nFrom: Relative <${from}>\r\nTo: breadloafhillsite@gmail.com\r\nMessage-ID: <synthetic-mail-intake@example.com>\r\nSubject: Family invoice forwarded\r\nDate: Tue, 13 Oct 2026 12:00:00 -0400\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\nFwd: vendor invoice details. Keep this financial report.\r\n`);
}

test("only Gmail's first receiving result aligned to actual From can authorize automatic filing", () => {
  const headers = rawEmailHeaders(emailSource());
  assert.equal(gmailSenderAuthentication(headers, "relative@gmail.com").verified, true);
  assert.equal(gmailSenderAuthentication(headers, "relative@attacker.example").verified, false);
  assert.equal(gmailSenderAuthentication(headers, "relative@gmail.com", 2).verified, false);
  const spoofed = [{ key: "authentication-results", value: "mx.google.com; dmarc=fail header.from=gmail.com; spf=fail; dkim=fail" }, ...headers];
  assert.equal(gmailSenderAuthentication(spoofed, "relative@gmail.com").verified, false);
  assert.equal(gmailSenderAuthentication([{ key: "authentication-results", value: "attacker.example; dmarc=pass header.from=gmail.com; spf=pass" }, ...headers], "relative@gmail.com").verified, false);
  assert.equal(emailIntakeDisposition({ authentication: { verified: true, reason: "synthetic" }, knownSender: false, ownNotification: false }), "quarantined");
  assert.equal(emailIntakeDisposition({ authentication: { verified: false, reason: "synthetic" }, knownSender: true, ownNotification: false }), "quarantined");
});

test("forwarded business content survives parsing and our notification headers prevent token-bearing mail intake", async () => {
  const delivered = new Date("2026-10-14T01:00:00Z");
  const parsed = await parseInboundEmail(emailSource(), { uid: "19", uidValidity: "123", receivedAt: delivered });
  assert.match(parsed.text, /vendor invoice details/);
  assert.equal(parsed.receivedAt.toISOString(), delivered.toISOString());
  assert.equal(parsed.authentication.verified, true);
  assert.equal(parsed.ownNotification, false);
  const own = await parseInboundEmail(emailSource("X-Breadloaf-Notification: family-sign-in\r\nAuto-Submitted: auto-generated\r\n", "breadloafhillsite@gmail.com"));
  assert.equal(own.ownNotification, true);
  assert.equal(emailIntakeDisposition({ authentication: own.authentication, knownSender: true, ownNotification: own.ownNotification }), "ignored");
  const autoInvoice = await parseInboundEmail(emailSource("Auto-Submitted: auto-generated\r\n"));
  assert.equal(autoInvoice.ownNotification, false);
});

test("retained RFC822 sources survive retries, use checksum names and fail closed after corruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "breadloaf-email-source-test-"));
  try {
    const source = emailSource();
    const checksum = await retainEmailSource(source, root);
    assert.equal(await retainEmailSource(source, root), checksum);
    assert.deepEqual(await readEmailSource(checksum, root), source);
    await assert.rejects(readEmailSource("../secret", root));
    await writeFile(path.join(root, `${checksum}.eml`), "corrupted synthetic source");
    await assert.rejects(readEmailSource(checksum, root), /integrity/);
  } finally { assert.equal(path.dirname(root), os.tmpdir()); await rm(root, { recursive: true, force: true }); }
});

test("UID scanning ignores Seen, advances only after durable receive, and marks only terminal outcomes Seen", async () => {
  const oldPassword = process.env.GMAIL_APP_PASSWORD;
  process.env.GMAIL_APP_PASSWORD = "synthetic-never-networked";
  const events: string[] = [];
  const fake = { mailbox: { uidValidity: BigInt(123), uidNext: 11 }, connect: async () => {}, logout: async () => {},
    getMailboxLock: async () => ({ release() {} }),
    search: async (query: { uid: string; seen?: boolean }, options: { uid: boolean }) => { assert.equal(query.uid, "9:*"); assert.equal(query.seen, undefined); assert.equal(options.uid, true); return [8, 9, 10]; },
    fetchOne: async (uid: string, _query: unknown, options: { uid: boolean }) => { assert.equal(options.uid, true); return { source: emailSource(), internalDate: new Date(), uid: Number(uid) }; },
    messageFlagsAdd: async (uid: string, _flags: string[], options: { uid: boolean }) => { assert.equal(options.uid, true); events.push(`seen:${uid}`); return true; },
  } as unknown as ImapFlow;
  const saved: MailboxCursor[] = [];
  try {
    const count = await scanInbox({ cursor: { uidValidity: "123", lastScannedUid: "8" },
      receive: async (email) => { events.push(`saved:${email.inboxUid}`); return email.inboxUid === "10"; },
      saveCursor: async (cursor) => { saved.push(cursor); events.push(`cursor:${cursor.lastScannedUid}`); },
    }, () => fake);
    assert.equal(count, 2);
    assert.deepEqual(events, ["saved:9", "cursor:9", "saved:10", "cursor:10", "seen:10"]);
    assert.equal(saved.at(-1)?.lastScannedUid, "10");
    events.length = 0;
    await assert.rejects(scanInbox({ cursor: { uidValidity: "123", lastScannedUid: "8" }, receive: async () => { throw new Error("synthetic DB failure"); }, saveCursor: async () => { events.push("cursor"); } }, () => fake), /synthetic DB failure/);
    assert.deepEqual(events, []);
  } finally { if (oldPassword === undefined) delete process.env.GMAIL_APP_PASSWORD; else process.env.GMAIL_APP_PASSWORD = oldPassword; }
});

test("a stale mail attempt cannot apply work, and retry keys are stable across restarts", () => {
  const row = { status: "processing", leaseToken: "new", leaseExpiresAt: new Date(Date.now() + 60000) };
  assert.doesNotThrow(() => assertEmailLease(row, "new"));
  assert.throws(() => assertEmailLease(row, "old"));
  assert.throws(() => assertEmailLease({ ...row, leaseExpiresAt: new Date(0) }, "new"));
  assert.equal(emailActionKey("message", "attachment", "checksum"), emailActionKey("message", "attachment", "checksum"));
  assert.notEqual(emailActionKey("message", "attachment", "checksum"), emailActionKey("message", "stay", "checksum"));
  assert.equal(emailRetryAt(1, new Date(0)).getTime(), 60000);
});
