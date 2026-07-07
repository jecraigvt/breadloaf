import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

// Reads unseen messages from the breadloafhillsite@gmail.com inbox.
// Auth is a Gmail app password in GMAIL_APP_PASSWORD (spaces tolerated).

const GMAIL_ADDRESS = "breadloafhillsite@gmail.com";

export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
}

export interface InboundEmail {
  messageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  text: string;
  receivedAt: Date;
  attachments: InboundAttachment[];
}

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_APP_PASSWORD?.trim());
}

export async function fetchUnseenEmails(): Promise<InboundEmail[]> {
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!password) return [];

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: GMAIL_ADDRESS, pass: password },
    logger: false,
  });

  const emails: InboundEmail[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const unseen = await client.search({ seen: false });
      if (unseen && unseen.length > 0) {
        // Cap per poll so a backlog can't stall a page-load-triggered run
        const batch = unseen.slice(0, 10);
        for (const uid of batch) {
          const msg = await client.fetchOne(String(uid), { source: true });
          if (!msg || typeof msg === "boolean" || !msg.source) continue;
          const parsed: ParsedMail = await simpleParser(msg.source);

          const fromAddr = parsed.from?.value?.[0];
          emails.push({
            messageId: parsed.messageId || `no-id-${uid}-${Date.now()}`,
            fromEmail: (fromAddr?.address || "").toLowerCase(),
            fromName: fromAddr?.name || fromAddr?.address || "Unknown",
            subject: parsed.subject || "(no subject)",
            text: (parsed.text || "").slice(0, 15000),
            receivedAt: parsed.date || new Date(),
            attachments: (parsed.attachments || [])
              .filter((a) => a.content && a.content.length > 0)
              .map((a) => ({
                filename: a.filename || "attachment",
                contentType: a.contentType || "application/octet-stream",
                content: a.content as Buffer,
                size: a.size || (a.content as Buffer).length,
              })),
          });

          // Mark seen so the next poll doesn't refetch it. Processing
          // failures are still recorded in EmailLog by the caller.
          await client.messageFlagsAdd(String(uid), ["\\Seen"]);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return emails;
}
