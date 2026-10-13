import { randomUUID } from "node:crypto";
import { Prisma, type EmailLog } from "@prisma/client";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scanInbox, parseInboundEmail, markInboxEmailSeen, type InboundEmail, type InboundAttachment } from "@/lib/email-inbox";
import { retainEmailSource, readEmailSource } from "@/lib/email-source";
import { emailIntakeDisposition } from "@/lib/email-authentication";
import { EMAIL_LEASE_MS, MAX_EMAIL_ATTEMPTS, TERMINAL_EMAIL_STATUSES, assertEmailLease, commitEmailAction, emailRetryAt } from "@/lib/email-workflow";
import { buildHistoricalPhotoQuestionProposal, loadHistoricalPhotoRoster } from "@/lib/historical-photo";
import { MODELS } from "@/lib/ai";
import { indexDocument } from "@/lib/embeddings";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { findOverlappingStay, createStayInTransaction } from "@/lib/stays";
import { sha256 } from "@/lib/archive-integrity";
import { resolveDocumentTitle } from "@/lib/document-title";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { analyzeDocumentBuffer } from "@/lib/document-analysis";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { storeFileBuffer } from "@/lib/file-storage";

async function allowedSenders(): Promise<Set<string>> {
  const members = await prisma.familyMember.findMany({ where: { accessApproved: true, canClaim: true, isMinor: false, deceased: false }, select: { email: true } });
  return new Set([...members.flatMap((member) => member.email ? [member.email.trim().toLowerCase()] : []),
    ...(process.env.FAMILY_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)]);
}

export interface EmailActions {
  staysCreated: { guestName: string; checkIn: string; checkOut: string }[];
  staysAlreadyOnCalendar: { guestName: string; checkIn: string; checkOut: string }[];
  docsFiled: { title: string; category: string | null }[];
  notes: string[];
}
export interface InboxRunSummary {
  received: number;
  processed: { from: string; subject: string; actions: EmailActions }[];
  skipped: { from: string; subject: string; reason: string }[];
  errors: { subject: string; error: string }[];
}

/** A scheduler or deliberate curator POST runs intake; page loads never process mail. */
export async function processInbox(options: { maxEmails?: number } = {}): Promise<InboxRunSummary> {
  const maxEmails = Math.min(Math.max(options.maxEmails ?? 6, 1), 20);
  const summary: InboxRunSummary = { received: 0, processed: [], skipped: [], errors: [] };
  const allowed = await allowedSenders();
  try {
    const cursor = await prisma.emailMailboxState.findUnique({ where: { id: "gmail-inbox" } });
    summary.received = await scanInbox({ cursor, maxEmails,
      receive: (email, source) => receiveEmail(email, source, allowed),
      saveCursor: async ({ uidValidity, lastScannedUid }) => {
        await prisma.$executeRaw`INSERT INTO "EmailMailboxState" ("id", "uidValidity", "lastScannedUid", "updatedAt")
          VALUES ('gmail-inbox', ${uidValidity}, ${lastScannedUid}, NOW())
          ON CONFLICT ("id") DO UPDATE SET
          "lastScannedUid" = CASE WHEN "EmailMailboxState"."uidValidity" = ${uidValidity}
            THEN GREATEST("EmailMailboxState"."lastScannedUid"::BIGINT, ${lastScannedUid}::BIGINT)::TEXT ELSE ${lastScannedUid} END,
          "uidValidity" = ${uidValidity}, "updatedAt" = NOW()`;
      },
    });
  } catch { summary.errors.push({ subject: "Mailbox check", error: "Gmail could not be checked; previously saved messages can still retry" }); }

  const now = new Date();
  const pending = await prisma.emailLog.findMany({ where: { nextAttemptAt: { lte: now }, attempts: { lt: MAX_EMAIL_ATTEMPTS },
    OR: [{ status: "received" }, { status: "retry" }, { status: "processing", leaseExpiresAt: { lte: now } }] },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }], take: maxEmails });
  for (const candidate of pending) {
    const row = await claimStoredEmail(candidate.id);
    if (!row) continue;
    try {
      const actions = await processStoredEmail(row, allowed);
      if (actions) summary.processed.push({ from: row.fromEmail, subject: row.subject || "(no subject)", actions });
      else summary.skipped.push({ from: row.fromEmail, subject: row.subject || "(no subject)", reason: "Waiting for curator review" });
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "Email processing failed";
      await prisma.emailLog.updateMany({ where: { id: row.id, leaseToken: row.leaseToken, status: "processing" }, data: {
        status: row.attempts >= MAX_EMAIL_ATTEMPTS ? "quarantined" : "retry", nextAttemptAt: emailRetryAt(row.attempts),
        lastError: reason, leaseToken: null, leaseExpiresAt: null,
      } });
      summary.errors.push({ subject: row.subject || "(no subject)", error: "This message is retained and can be retried or reviewed" });
    }
  }
  return summary;
}

export async function receiveEmail(email: InboundEmail, source: Buffer, allowed: Set<string>): Promise<boolean> {
  const existing = await prisma.emailLog.findUnique({ where: { messageId: email.messageId } });
  if (existing && (!existing.sourceChecksum || existing.sourceChecksum === email.sourceChecksum)) return TERMINAL_EMAIL_STATUSES.includes(existing.status);
  // A duplicate RFC Message-ID with different bytes never overwrites an original source.
  const messageId = existing ? `${email.messageId}#${email.sourceChecksum}` : email.messageId;
  const status = emailIntakeDisposition({ authentication: email.authentication, knownSender: allowed.has(email.fromEmail), ownNotification: email.ownNotification });
  const sourceChecksum = status === "ignored" ? null : await retainEmailSource(source);
  await prisma.emailLog.upsert({ where: { messageId }, update: {}, create: {
    messageId, fromEmail: email.fromEmail, senderName: email.fromName, subject: email.subject, receivedAt: email.receivedAt,
    status, sourceChecksum, inboxUid: email.inboxUid, inboxUidValidity: email.inboxUidValidity,
    authenticationStatus: email.authentication.verified ? "verified" : "unverified",
    authenticationReason: email.authentication.reason,
    ...(status === "quarantined" ? { lastError: allowed.has(email.fromEmail) ? "Sender authentication needs curator review" : "Sender is not approved for automatic filing" } : {}),
    ...(status === "ignored" ? { actions: JSON.stringify({ ignored: "Breadloaf notification; no source retained" }) } : {}),
  } });
  return TERMINAL_EMAIL_STATUSES.includes(status);
}

async function claimStoredEmail(id: string): Promise<EmailLog | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const result = await prisma.emailLog.updateMany({ where: { id, nextAttemptAt: { lte: now }, attempts: { lt: MAX_EMAIL_ATTEMPTS },
    OR: [{ status: "received" }, { status: "retry" }, { status: "processing", leaseExpiresAt: { lte: now } }] },
    data: { status: "processing", leaseToken, leaseExpiresAt: new Date(now.getTime() + EMAIL_LEASE_MS), attempts: { increment: 1 }, lastError: null } });
  return result.count === 1 ? prisma.emailLog.findUnique({ where: { id } }) : null;
}

async function processStoredEmail(row: EmailLog, allowed: Set<string>): Promise<EmailActions | null> {
  if (!row.sourceChecksum || !row.leaseToken) throw new Error("This historical message has no retained source; review it in Gmail");
  const source = await readEmailSource(row.sourceChecksum);
  const email = await parseInboundEmail(source, { uid: row.inboxUid || undefined, uidValidity: row.inboxUidValidity || undefined, receivedAt: row.receivedAt });
  email.messageId = row.messageId;
  const reviewed = Boolean(row.reviewedBy && row.reviewedAt);
  if ((!email.authentication.verified || !allowed.has(email.fromEmail)) && !reviewed) {
    await prisma.emailLog.updateMany({ where: { id: row.id, leaseToken: row.leaseToken }, data: { status: "quarantined", leaseToken: null, leaseExpiresAt: null, lastError: "Sender needs curator approval" } });
    await markInboxEmailSeen(row).catch(() => {});
    return null;
  }
  const leaseToken = row.leaseToken;
  const heartbeat = setInterval(() => { void prisma.emailLog.updateMany({ where: { id: row.id, leaseToken, status: "processing", leaseExpiresAt: { gt: new Date() } },
    data: { leaseExpiresAt: new Date(Date.now() + EMAIL_LEASE_MS) } }).catch(() => {}); }, 60000);
  try {
    let plan: BodyAnalysis;
    if (row.processingPlan) plan = BodyAnalysisSchema.parse(row.processingPlan);
    else {
      plan = email.text.trim() ? await analyzeEmailBody(email) : { stays: [], bodyIsDocument: false };
      const saved = await prisma.emailLog.updateMany({ where: { id: row.id, leaseToken, status: "processing", leaseExpiresAt: { gt: new Date() } }, data: { processingPlan: plan as unknown as Prisma.InputJsonValue } });
      if (saved.count !== 1) throw new Error("The email attempt expired before its plan was saved");
    }
    const actions: EmailActions = { staysCreated: [], staysAlreadyOnCalendar: [], docsFiled: [], notes: [] };
    if (email.additionalAttachmentCount) actions.notes.push(`${email.additionalAttachmentCount} additional attachments remain in the retained original for manual filing`);
    for (const stay of plan.stays) {
      const checkIn = new Date(stay.checkIn), checkOut = new Date(stay.checkOut);
      const monthsAhead = (checkIn.getTime() - Date.now()) / (30 * 24 * 3600 * 1000);
      if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) || checkOut <= checkIn || checkOut <= new Date() || monthsAhead > 18 || stay.confidence < 0.7) {
        actions.notes.push(`Visit mention for ${stay.guestName} needs confirmation; no dates were added`); continue;
      }
      const receipt = await commitEmailAction({ messageId: row.messageId, leaseToken, kind: "stay", identity: JSON.stringify([stay.guestName.toLowerCase(), stay.checkIn, stay.checkOut]),
        find: (tx, id) => tx.stay.findUnique({ where: { id } }),
        create: async (tx) => {
          const overlap = await findOverlappingStay(stay.guestName, checkIn, checkOut, tx);
          if (overlap) return { entity: await tx.stay.findUnique({ where: { id: overlap.id } }), kind: "stay_existing" };
          const result = await createStayInTransaction(tx, { guestName: stay.guestName, checkIn, checkOut, notes: `Mail Room: ${email.fromName}'s email "${email.subject}"`, status: "confirmed" });
          return { entity: result.stay, kind: result.created ? "stay_created" : "stay_existing" };
        },
      });
      (receipt.kind === "stay_created" ? actions.staysCreated : actions.staysAlreadyOnCalendar).push(stay);
    }
    if (plan.bodyIsDocument) {
      const buffer = Buffer.from([`From: ${email.fromName} <${email.fromEmail}>`, `Delivered: ${email.receivedAt.toISOString()}`, `Subject: ${email.subject}`, "", email.text].join("\n"));
      const name = (email.subject || "email").replace(/[^\w\- ]+/g, "").slice(0, 60) || "email";
      const filed = await archiveEmailDocument({ buffer, fileName: `${name}.txt`, fileType: "text/plain", email, leaseToken, identity: "email-body" });
      if (filed) actions.docsFiled.push(filed);
    }
    for (const attachment of email.attachments) {
      if (attachment.inline) continue;
      const type = resolveSupportedFileType(attachment.contentType, attachment.filename);
      if (!type || attachment.size > 30 * 1024 * 1024) { actions.notes.push(`Attachment "${attachment.filename}" is retained with the email but needs manual filing`); continue; }
      const filed = await archiveEmailDocument({ buffer: attachment.content, fileName: attachment.filename, fileType: type, email, leaseToken, identity: `attachment:${sha256(attachment.content)}` });
      if (filed) actions.docsFiled.push(filed);
    }
    await postAuditNote(email, actions, leaseToken);
    const completed = await prisma.emailLog.updateMany({ where: { id: row.id, leaseToken, status: "processing", leaseExpiresAt: { gt: new Date() } }, data: {
      status: "completed", actions: JSON.stringify(actions), leaseToken: null, leaseExpiresAt: null, lastError: null,
    } });
    if (completed.count !== 1) throw new Error("The email attempt no longer owns completion");
    await markInboxEmailSeen(row).catch(() => {});
    return actions;
  } finally { clearInterval(heartbeat); }
}
interface ExtractedStay {
  guestName: string;
  checkIn: string;
  checkOut: string;
  confidence: number;
}

interface BodyAnalysis {
  stays: ExtractedStay[];
  bodyIsDocument: boolean;
}

const BodyAnalysisSchema = z.object({
  stays: z.array(z.object({
    guestName: z.string(),
    checkIn: z.string(),
    checkOut: z.string(),
    confidence: z.number(),
  })),
  bodyIsDocument: z.boolean(),
});

async function analyzeEmailBody(email: InboundEmail): Promise<BodyAnalysis> {
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You extract visit announcements for the Breadloaf Hill family property calendar (Vermont; the Craig family: brothers Tom, Jim, Sandy, Greg and their branches).

Today's date: ${today}
Email from: ${email.fromName} <${email.fromEmail}>
Subject: ${email.subject}

Email body:
${email.text.slice(0, 15000)}

Find statements that clearly announce someone WILL be staying at the property ("we'll be up July 10-17", "the Kellers arrive the 12th through the 19th"). Rules:
- Only definite plans. "We might come up in August" or questions are NOT announcements (confidence < 0.5).
- FORWARDED / OLD MESSAGES: if this is a forwarded email (subject starts with "Fwd:", or the body contains a forwarded-message header with an original date), judge announcements by the ORIGINAL message's date, not today. A visit announced in an old message already happened — give it confidence 0.1. Never roll an old announcement forward to a future year.
- guestName: who is staying, as it would appear on a calendar (e.g. "Jim & Carol", "The Kellers"). If the sender says "we" without names, use the sender's name + family (e.g. "${email.fromName} & family").
- Dates in YYYY-MM-DD. Infer the year from today's date (announcements are about upcoming visits). checkOut is the departure date.
- confidence: 0-1 that this is a real, definite stay announcement with correct dates.

Separately, decide whether the email BODY ITSELF is a document worth archiving ("bodyIsDocument"). TRUE only when the body contains substantive content a family member would look up later — meeting minutes or decisions/votes typed into the email, financial details or vendor quotes, detailed how-to instructions (e.g. winterization steps), a written report. FALSE for logistics chatter, greetings, scheduling talk, short social notes, or a body that mainly says "see attached" (the attachment gets archived separately). When unsure, say false.

Return ONLY valid JSON (no markdown fences):
{"stays": [{"guestName": "...", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "confidence": 0.0}], "bodyIsDocument": false}
Return {"stays": [], "bodyIsDocument": false} if there is nothing.`;

  const result = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: prompt,
    text: { format: zodTextFormat(BodyAnalysisSchema, "email_body_analysis") },
  }));
  if (!result.output_parsed) throw new Error("OpenAI returned no email body analysis");
  return {
    stays: result.output_parsed.stays.filter(
      (stay) =>
        stay.guestName.trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(stay.checkIn) &&
        /^\d{4}-\d{2}-\d{2}$/.test(stay.checkOut) &&
        new Date(stay.checkOut) > new Date(stay.checkIn)
    ),
    bodyIsDocument: result.output_parsed.bodyIsDocument,
  };
}


async function archiveEmailDocument(input: { buffer: Buffer; fileName: string; fileType: string; email: InboundEmail; leaseToken: string; identity: string }): Promise<{ title: string; category: string | null } | null> {
  const checksum = sha256(input.buffer);
  const existing = await prisma.document.findFirst({ where: { checksum, deletedAt: null, accessScope: "family" }, include: { category: true } });
  const stored = existing ? null : await storeFileBuffer({ buffer: input.buffer, fileName: input.fileName, contentType: input.fileType });
  const categories = existing ? [] : await prisma.category.findMany({ select: { name: true, description: true }, orderBy: { name: "asc" } });
  const analysis = existing ? null : await analyzeDocumentBuffer({ buffer: input.buffer, fileName: input.fileName, fileType: input.fileType, categories });
  const result = analysis?.result;
  const photoQuestion = result?.intakeType === "historical_photo"
    ? buildHistoricalPhotoQuestionProposal(result, await loadHistoricalPhotoRoster()) : null;
  const receipt = await commitEmailAction({ messageId: input.email.messageId, leaseToken: input.leaseToken, kind: "document", identity: input.identity,
    find: (tx, id) => tx.document.findUnique({ where: { id }, include: { category: true } }),
    create: async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`mail-document:${checksum}`}, 0))`;
      const duplicate = await tx.document.findFirst({ where: { checksum, deletedAt: null, accessScope: "family" }, include: { category: true } });
      if (duplicate) return { entity: duplicate };
      if (!stored || !analysis) throw new Error("The duplicate document changed while the email was being filed");
      const resolution = result ? await resolveDocumentCategory({ suggestedCategory: result.suggestedCategory, newCategoryProposal: result.newCategoryProposal, confidence: result.confidence }, tx)
        : { categoryId: null, categoryName: null, needsReview: true };
      const doc = await tx.document.create({ data: {
        title: resolveDocumentTitle({ suggestedTitle: result?.title, fileName: input.fileName, summary: result?.summary, extractedText: result?.extractedText, fileType: input.fileType, createdAt: input.email.receivedAt }),
        description: result?.summary || null, fileName: input.fileName, filePath: stored.filePath, fileType: stored.fileType, fileSize: stored.fileSize,
        categoryId: resolution.categoryId, tags: result?.tags?.length ? JSON.stringify(result.tags) : null, aiSummary: result?.summary || null,
        aiExtractedText: result?.extractedText || null, analysisState: analysis.state, analysisError: analysis.error,
        uploadedBy: `${input.email.fromName} (email${input.email.authentication.verified ? " verified" : ", curator approved"})`, checksum, accessScope: "family",
      }, include: { category: true } });
      if (resolution.needsReview) await tx.buckyQuestion.create({ data: {
        question: `Where should "${doc.title}" be filed?`, context: `Retained from ${input.email.fromName}'s email "${input.email.subject}"; automatic filing needs review.`,
        questionType: "archive", sourceType: "document", sourceId: doc.id, sourceLabel: doc.title,
      } });
      if (photoQuestion) await tx.buckyQuestion.create({ data: {
        ...photoQuestion, questionType: "historical_photo_identification", sourceType: "document", sourceId: doc.id, sourceLabel: doc.title,
      } });
      return { entity: doc };
    },
  });
  if (!receipt.entity) return null;
  void indexDocument(receipt.entity.id).catch(() => {});
  return { title: receipt.entity.title, category: receipt.entity.category?.name || null };
}

async function postAuditNote(email: InboundEmail, actions: EmailActions, leaseToken: string): Promise<void> {
  const lines = [
    ...actions.staysCreated.map((stay) => `Saved visit: ${stay.guestName}, ${stay.checkIn} → ${stay.checkOut}; Google sync is queued`),
    ...actions.staysAlreadyOnCalendar.map((stay) => `${stay.guestName}'s visit ${stay.checkIn} → ${stay.checkOut} was already recorded`),
    ...actions.docsFiled.map((doc) => doc.category ? `Filed "${doc.title}" under ${doc.category}` : `Saved "${doc.title}" for archive review`), ...actions.notes,
  ];
  if (!lines.length) return;
  await commitEmailAction({ messageId: email.messageId, leaseToken, kind: "audit", identity: "email-audit",
    find: (tx, id) => tx.bulletinMessage.findUnique({ where: { id } }),
    create: async (tx) => ({ entity: await tx.bulletinMessage.create({ data: { author: "📧 Mail Room", content: `From ${email.fromName}'s email "${email.subject}":\n${lines.map((line) => `• ${line}`).join("\n")}` } }) }),
  });
}
