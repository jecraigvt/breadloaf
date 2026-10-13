import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { sha256 } from "@/lib/archive-integrity";
import { gmailSenderAuthentication, isOwnMailNotification, rawEmailHeaders, type EmailAuthentication } from "@/lib/email-authentication";

const GMAIL_ADDRESS = "breadloafhillsite@gmail.com";
export const MAX_EMAIL_SOURCE_BYTES = 45 * 1024 * 1024;
export interface InboundAttachment { filename: string; contentType: string; content: Buffer; size: number; inline: boolean }
export interface InboundEmail {
  messageId: string; fromEmail: string; fromName: string; subject: string; text: string;
  receivedAt: Date; attachments: InboundAttachment[]; authentication: EmailAuthentication;
  ownNotification: boolean; sourceChecksum: string; inboxUid?: string; inboxUidValidity?: string;
  additionalAttachmentCount: number;
}
export interface MailboxCursor { uidValidity: string; lastScannedUid: string }
export function emailConfigured(): boolean { return Boolean(process.env.GMAIL_APP_PASSWORD?.trim()); }

function mailClient() {
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!password) throw new Error("Mail Room is not configured");
  return new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL_ADDRESS, pass: password }, logger: false, disableAutoIdle: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    maxLiteralSize: MAX_EMAIL_SOURCE_BYTES, maxLineLength: 256 * 1024 });
}

export async function parseInboundEmail(source: Buffer, identity: { uid?: string; uidValidity?: string; receivedAt?: Date } = {}): Promise<InboundEmail> {
  if (source.length > MAX_EMAIL_SOURCE_BYTES) throw new Error("Email source is too large");
  const parsed = await simpleParser(source, { maxHtmlLengthToParse: 100000, skipTextToHtml: true, skipImageLinks: true });
  const sender = parsed.from?.value?.[0];
  const fromEmail = (sender?.address || "").trim().toLowerCase();
  const headers = rawEmailHeaders(source);
  const sourceChecksum = sha256(source);
  return {
    messageId: parsed.messageId?.slice(0, 500) || `source:${sourceChecksum}`,
    fromEmail, fromName: (sender?.name || fromEmail || "Unknown sender").slice(0, 200),
    subject: (parsed.subject || "(no subject)").slice(0, 1000), text: parsed.text || "",
    receivedAt: identity.receivedAt || (parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : new Date()),
    authentication: gmailSenderAuthentication(headers, fromEmail, parsed.from?.value.length || 0),
    ownNotification: isOwnMailNotification(headers, fromEmail), sourceChecksum,
    inboxUid: identity.uid, inboxUidValidity: identity.uidValidity,
    additionalAttachmentCount: Math.max(0, (parsed.attachments?.length || 0) - 30),
    attachments: (parsed.attachments || []).filter((attachment) => attachment.content?.length > 0).slice(0, 30).map((attachment) => ({
      filename: (attachment.filename || "attachment").slice(0, 255), contentType: attachment.contentType || "application/octet-stream",
      content: attachment.content, size: attachment.content.length, inline: attachment.related === true,
    })),
  };
}

/** Seen is never an intake cursor. Commit source+log before advancing the durable UID cursor. */
export async function scanInbox(options: {
  cursor: MailboxCursor | null; maxEmails?: number;
  receive(email: InboundEmail, source: Buffer): Promise<boolean>;
  saveCursor(cursor: MailboxCursor): Promise<void>;
}, createClient: () => ImapFlow = mailClient): Promise<number> {
  if (!emailConfigured()) return 0;
  const client = createClient();
  let count = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (!client.mailbox) throw new Error("Mailbox is unavailable");
      const uidValidity = String(client.mailbox.uidValidity);
      const previous = options.cursor?.uidValidity === uidValidity ? Number(options.cursor.lastScannedUid) : 0;
      const query = previous ? { uid: `${previous + 1}:*` } : { since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) };
      const found = await client.search(query, { uid: true });
      const uids = (found || []).filter((uid) => uid > previous).sort((a, b) => a - b).slice(0, Math.min(options.maxEmails ?? 10, 20));
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true, size: true }, { uid: true });
        if (!msg || !msg.source) continue;
        let email: InboundEmail;
        try { email = await parseInboundEmail(msg.source, { uid: String(uid), uidValidity,
          receivedAt: msg.internalDate instanceof Date ? msg.internalDate : undefined }); }
        catch {
          const checksum = sha256(msg.source);
          email = { messageId: `unparsed:${checksum}`, fromEmail: "", fromName: "Unknown sender", subject: "Email needs manual parsing",
            text: "", receivedAt: msg.internalDate instanceof Date ? msg.internalDate : new Date(), attachments: [],
            authentication: { verified: false, reason: "The original MIME message could not be parsed" }, ownNotification: false,
            sourceChecksum: checksum, inboxUid: String(uid), inboxUidValidity: uidValidity, additionalAttachmentCount: 0 };
        }
        const terminal = await options.receive(email, msg.source);
        await options.saveCursor({ uidValidity, lastScannedUid: String(uid) });
        if (terminal) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        count++;
      }
      if (!uids.length) await options.saveCursor({ uidValidity, lastScannedUid: String(previous || Math.max(0, client.mailbox.uidNext - 1)) });
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return count;
}

export async function markInboxEmailSeen(identity: { inboxUid: string | null; inboxUidValidity: string | null }): Promise<void> {
  if (!identity.inboxUid || !identity.inboxUidValidity || !emailConfigured()) return;
  const client = mailClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (client.mailbox && String(client.mailbox.uidValidity) === identity.inboxUidValidity) await client.messageFlagsAdd(identity.inboxUid, ["\\Seen"], { uid: true });
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}
