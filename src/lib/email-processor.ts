import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { fetchUnseenEmails, emailConfigured, type InboundEmail, type InboundAttachment } from "@/lib/email-inbox";
import { categorizeDocument, categorizeText, embedAndStore } from "@/lib/ai";
import { extractTextFromFile, isExtractableType } from "@/lib/extract-text";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { createCalendarEvent } from "@/lib/google-calendar";
import { generateId } from "@/lib/utils";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// ─── Guardrails ─────────────────────────────────────────────────
// Email is an untrusted inlet: it can only ADD stays, documents, and
// bulletin notes. It can never modify or delete anything, and only
// allowlisted family senders are processed at all.

const DEFAULT_FAMILY_EMAILS = ["jecraigvt@gmail.com", "breadloafhillsite@gmail.com"];

function allowedSenders(): Set<string> {
  const extra = (process.env.FAMILY_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_FAMILY_EMAILS, ...extra]);
}

const POLL_INTERVAL_MS = 10 * 60 * 1000;
let lastPollAt = 0;
let polling = false;

// Fire-and-forget entry point, called from page loads (same pattern as
// calendar sync). Rate-limited so busy days don't hammer Gmail.
export function pollInboxInBackground(): void {
  if (!emailConfigured()) return;
  const now = Date.now();
  if (polling || now - lastPollAt < POLL_INTERVAL_MS) return;
  lastPollAt = now;
  polling = true;
  processInbox()
    .catch((err) => console.error("[Mail Room] poll failed:", err))
    .finally(() => {
      polling = false;
    });
}

export interface InboxRunSummary {
  unseen: number;
  processed: { from: string; subject: string; actions: EmailActions }[];
  skipped: { from: string; subject: string; reason: string }[];
  errors: { subject: string; error: string }[];
}

export async function processInbox(): Promise<InboxRunSummary> {
  const summary: InboxRunSummary = { unseen: 0, processed: [], skipped: [], errors: [] };
  const emails = await fetchUnseenEmails();
  summary.unseen = emails.length;
  console.log(`[Mail Room] inbox checked: ${emails.length} unseen message(s)`);
  if (emails.length === 0) return summary;

  const allowed = allowedSenders();

  for (const email of emails) {
    // Dedupe (Gmail can re-show messages; page loads can race)
    const existing = await prisma.emailLog.findUnique({
      where: { messageId: email.messageId },
    });
    if (existing) {
      summary.skipped.push({ from: email.fromEmail, subject: email.subject, reason: "already processed" });
      continue;
    }

    if (!allowed.has(email.fromEmail)) {
      console.log(`[Mail Room] Ignoring email from non-family sender: ${email.fromEmail}`);
      await recordLog(email, { ignored: "sender not on family allowlist" });
      summary.skipped.push({ from: email.fromEmail, subject: email.subject, reason: "sender not on allowlist" });
      continue;
    }

    try {
      const actions = await processEmail(email);
      await recordLog(email, actions);
      await postAuditNote(email, actions);
      summary.processed.push({ from: email.fromEmail, subject: email.subject, actions });
    } catch (err) {
      console.error(`[Mail Room] Failed to process "${email.subject}":`, err);
      await recordLog(email, { error: String(err) });
      summary.errors.push({ subject: email.subject, error: String(err) });
    }
  }
  return summary;
}

interface EmailActions {
  staysCreated: { guestName: string; checkIn: string; checkOut: string }[];
  staysAlreadyOnCalendar: { guestName: string; checkIn: string; checkOut: string }[];
  docsFiled: { title: string; category: string | null }[];
  notes: string[];
}

async function processEmail(email: InboundEmail): Promise<EmailActions> {
  const actions: EmailActions = {
    staysCreated: [],
    staysAlreadyOnCalendar: [],
    docsFiled: [],
    notes: [],
  };

  // 1. Analyze the body: stay announcements + is the body itself a document?
  let bodyIsDocument = false;
  if (email.text.trim()) {
    const analysis = await analyzeEmailBody(email);
    bodyIsDocument = analysis.bodyIsDocument;
    const stays = analysis.stays;
    for (const stay of stays) {
      // Hard guards regardless of model confidence: never create stays in
      // the past (forwarded/old emails) or implausibly far out
      const checkOut = new Date(stay.checkOut);
      const checkIn = new Date(stay.checkIn);
      const monthsAhead = (checkIn.getTime() - Date.now()) / (30 * 24 * 3600 * 1000);
      if (checkOut <= new Date() || monthsAhead > 18) {
        actions.notes.push(
          `Skipped ${stay.guestName} ${stay.checkIn}–${stay.checkOut} (dates in the past or too far out — old/forwarded email?)`
        );
        continue;
      }
      if (stay.confidence < 0.7) {
        actions.notes.push(
          `Possible visit mentioned (${stay.guestName}, ${stay.checkIn}–${stay.checkOut}) but not confident enough to add`
        );
        continue;
      }
      const duplicate = await findOverlappingStay(stay);
      if (duplicate) {
        actions.staysAlreadyOnCalendar.push(stay);
        continue;
      }
      const created = await prisma.stay.create({
        data: {
          guestName: stay.guestName,
          checkIn: new Date(stay.checkIn),
          checkOut: new Date(stay.checkOut),
          status: "confirmed",
          notes: `Added by Mail Room from ${email.fromName}'s email "${email.subject}"`,
        },
      });
      try {
        await createCalendarEvent(created);
      } catch (err) {
        console.error("[Mail Room] calendar sync failed for emailed stay:", err);
      }
      actions.staysCreated.push(stay);
    }
  }

  // 2. If the body itself is substantive content (typed-in minutes, a
  // report, detailed instructions), archive it as a document
  if (bodyIsDocument) {
    const filed = await archiveBodyAsDocument(email);
    if (filed) actions.docsFiled.push(filed);
  }

  // 3. File attachments through the document pipeline
  for (const attachment of email.attachments) {
    const filed = await fileAttachment(attachment, email);
    if (filed) actions.docsFiled.push(filed);
  }

  return actions;
}

// ─── Body analysis (stays + is-this-a-document) ────────────────

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

async function analyzeEmailBody(email: InboundEmail): Promise<BodyAnalysis> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const today = new Date().toISOString().slice(0, 10);

  const result = await model.generateContent(
    `You extract visit announcements for the Breadloaf Hill family property calendar (Vermont; the Craig family: brothers Tom, Jim, Sandy, Greg and their branches).

Today's date: ${today}
Email from: ${email.fromName} <${email.fromEmail}>
Subject: ${email.subject}

Email body:
${email.text}

Find statements that clearly announce someone WILL be staying at the property ("we'll be up July 10-17", "the Kellers arrive the 12th through the 19th"). Rules:
- Only definite plans. "We might come up in August" or questions are NOT announcements (confidence < 0.5).
- FORWARDED / OLD MESSAGES: if this is a forwarded email (subject starts with "Fwd:", or the body contains a forwarded-message header with an original date), judge announcements by the ORIGINAL message's date, not today. A visit announced in an old message already happened — give it confidence 0.1. Never roll an old announcement forward to a future year.
- guestName: who is staying, as it would appear on a calendar (e.g. "Jim & Carol", "The Kellers"). If the sender says "we" without names, use the sender's name + family (e.g. "${email.fromName} & family").
- Dates in YYYY-MM-DD. Infer the year from today's date (announcements are about upcoming visits). checkOut is the departure date.
- confidence: 0-1 that this is a real, definite stay announcement with correct dates.

Separately, decide whether the email BODY ITSELF is a document worth archiving ("bodyIsDocument"). TRUE only when the body contains substantive content a family member would look up later — meeting minutes or decisions/votes typed into the email, financial details or vendor quotes, detailed how-to instructions (e.g. winterization steps), a written report. FALSE for logistics chatter, greetings, scheduling talk, short social notes, or a body that mainly says "see attached" (the attachment gets archived separately). When unsure, say false.

Return ONLY valid JSON (no markdown fences):
{"stays": [{"guestName": "...", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "confidence": 0.0}], "bodyIsDocument": false}
Return {"stays": [], "bodyIsDocument": false} if there is nothing.`
  );

  try {
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    return {
      stays: (parsed.stays || []).filter(
        (s: ExtractedStay) =>
          s?.guestName?.trim() &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.checkIn || "") &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.checkOut || "") &&
          new Date(s.checkOut) > new Date(s.checkIn)
      ),
      bodyIsDocument: parsed.bodyIsDocument === true,
    };
  } catch {
    return { stays: [], bodyIsDocument: false };
  }
}

// Save the email body itself as an archived .txt document and run it
// through the same categorization pipeline as any other text file.
async function archiveBodyAsDocument(
  email: InboundEmail
): Promise<{ title: string; category: string | null } | null> {
  try {
    const content = [
      `From: ${email.fromName} <${email.fromEmail}>`,
      `Date: ${email.receivedAt.toISOString()}`,
      `Subject: ${email.subject}`,
      "",
      email.text,
    ].join("\n");

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const uniqueName = `${generateId()}.txt`;
    const buffer = Buffer.from(content, "utf-8");
    await writeFile(path.join(uploadDir, uniqueName), buffer);

    const categories = await prisma.category.findMany({
      select: { name: true, description: true },
      orderBy: { name: "asc" },
    });
    const result = await categorizeText(content, email.subject, categories);
    const resolution = await resolveDocumentCategory({
      suggestedCategory: result.suggestedCategory,
      newCategoryProposal: result.newCategoryProposal,
      confidence: result.confidence,
    });

    const safeName = (email.subject || "email").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "email";
    const doc = await prisma.document.create({
      data: {
        title: result.title || email.subject,
        description: result.summary || null,
        fileName: `${safeName}.txt`,
        filePath: `/uploads/${uniqueName}`,
        fileType: "text/plain",
        fileSize: buffer.length,
        categoryId: resolution.categoryId,
        tags: result.tags?.length ? JSON.stringify(result.tags) : null,
        aiSummary: result.summary || null,
        aiExtractedText: result.extractedText || null,
        uploadedBy: `${email.fromName} (email)`,
      },
      include: { category: true },
    });

    const embeddingContent = [doc.title, doc.category?.name || "", doc.aiSummary || "", doc.aiExtractedText || ""]
      .filter(Boolean)
      .join(" | ");
    embedAndStore("document", doc.id, embeddingContent).catch(() => {});

    return { title: doc.title, category: resolution.categoryName };
  } catch (err) {
    console.error("[Mail Room] body archive failed:", err);
    return null;
  }
}

// A stay is a duplicate if the date ranges overlap AND the guest names
// share a word — overlapping stays by different branches are normal.
async function findOverlappingStay(stay: ExtractedStay) {
  const overlapping = await prisma.stay.findMany({
    where: {
      checkIn: { lt: new Date(stay.checkOut) },
      checkOut: { gt: new Date(stay.checkIn) },
    },
    select: { id: true, guestName: true },
  });
  return overlapping.find((s) => guestNamesMatch(s.guestName, stay.guestName)) ?? null;
}

function guestNamesMatch(a: string, b: string): boolean {
  const at = nameTokens(a);
  const bt = nameTokens(b);
  // Prefer first names/nicknames — surnames are shared family-wide
  if (at.length > 0 && bt.length > 0) return at.some((t) => bt.includes(t));
  // One side is surname-only ("The Kellers") — compare with surnames included
  const aAll = allNameTokens(a);
  const bAll = allNameTokens(b);
  return aAll.some((t) => bAll.includes(t));
}

// Family surnames are shared by everyone, so they can't distinguish one
// branch's stay from another's — only first names/nicknames count.
const NAME_STOPWORDS = new Set([
  "the", "and", "family", "families", "kids", "crew",
  "craig", "craigs", "keller", "kellers", "devlin", "devlins", "noyes", "noye",
]);

const GENERIC_STOPWORDS = new Set(["the", "and", "family", "families", "kids", "crew"]);

function allNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !GENERIC_STOPWORDS.has(t))
    // singularize so "the Kellers" matches "Rob Keller" (consistent both sides)
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

function nameTokens(name: string): string[] {
  return allNameTokens(name).filter((t) => !NAME_STOPWORDS.has(t));
}

// ─── Attachment filing ──────────────────────────────────────────

const AI_SIZE_LIMIT = 15 * 1024 * 1024;
const FILEABLE_PREFIXES = ["image/"];
const FILEABLE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

async function fileAttachment(
  attachment: InboundAttachment,
  email: InboundEmail
): Promise<{ title: string; category: string | null } | null> {
  const type = attachment.contentType.split(";")[0].trim();
  const fileable =
    FILEABLE_PREFIXES.some((p) => type.startsWith(p)) || FILEABLE_TYPES.has(type);
  if (!fileable || attachment.size > AI_SIZE_LIMIT) return null;

  // Save to /uploads like the web upload path
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const ext = attachment.filename.split(".").pop() || "bin";
  const uniqueName = `${generateId()}.${ext}`;
  await writeFile(path.join(uploadDir, uniqueName), attachment.content);

  // Categorize
  const categories = await prisma.category.findMany({
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  });

  let result = null;
  if (type.startsWith("image/") || type === "application/pdf") {
    result = await categorizeDocument(
      attachment.content.toString("base64"),
      type,
      categories
    );
  } else if (isExtractableType(type)) {
    const extracted = await extractTextFromFile(attachment.content, type);
    if (extracted?.trim()) {
      result = await categorizeText(extracted, attachment.filename, categories);
    }
  }

  const resolution = result
    ? await resolveDocumentCategory({
        suggestedCategory: result.suggestedCategory,
        newCategoryProposal: result.newCategoryProposal,
        confidence: result.confidence,
      })
    : { categoryId: null, categoryName: null, categorySlug: null, categoryCreated: false, needsReview: true };

  const doc = await prisma.document.create({
    data: {
      title: result?.title || attachment.filename,
      description: result?.summary || null,
      fileName: attachment.filename,
      filePath: `/uploads/${uniqueName}`,
      fileType: type,
      fileSize: attachment.size,
      categoryId: resolution.categoryId,
      tags: result?.tags?.length ? JSON.stringify(result.tags) : null,
      aiSummary: result?.summary || null,
      aiExtractedText: result?.extractedText || null,
      uploadedBy: `${email.fromName} (email)`,
    },
    include: { category: true },
  });

  const embeddingContent = [doc.title, doc.category?.name || "", doc.aiSummary || "", doc.aiExtractedText || ""]
    .filter(Boolean)
    .join(" | ");
  embedAndStore("document", doc.id, embeddingContent).catch(() => {});

  return { title: doc.title, category: resolution.categoryName };
}

// ─── Audit trail ────────────────────────────────────────────────

async function recordLog(email: InboundEmail, actions: unknown): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        messageId: email.messageId,
        fromEmail: email.fromEmail,
        subject: email.subject,
        receivedAt: email.receivedAt,
        actions: JSON.stringify(actions),
      },
    });
  } catch {
    // unique collision from a racing poll — fine
  }
}

async function postAuditNote(email: InboundEmail, actions: EmailActions): Promise<void> {
  const lines: string[] = [];
  for (const s of actions.staysCreated) {
    lines.push(`Added stay: ${s.guestName}, ${s.checkIn} → ${s.checkOut} (now on the calendar)`);
  }
  for (const s of actions.staysAlreadyOnCalendar) {
    lines.push(`${s.guestName}'s visit ${s.checkIn} → ${s.checkOut} was already on the calendar`);
  }
  for (const d of actions.docsFiled) {
    lines.push(
      d.category ? `Filed "${d.title}" under ${d.category}` : `Saved "${d.title}" — needs review on the Documents page`
    );
  }
  lines.push(...actions.notes);

  if (lines.length === 0) return; // nothing actionable — stay quiet

  await prisma.bulletinMessage.create({
    data: {
      author: "📧 Mail Room",
      content: `From ${email.fromName}'s email "${email.subject}":\n${lines.map((l) => `• ${l}`).join("\n")}`,
    },
  });
}
