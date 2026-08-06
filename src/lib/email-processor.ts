import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchUnseenEmails, emailConfigured, type InboundEmail, type InboundAttachment } from "@/lib/email-inbox";
import { MODELS } from "@/lib/ai";
import { indexDocument } from "@/lib/embeddings";
import { resolveDocumentCategory } from "@/lib/document-categories";
import { findOverlappingStay, createStayWithCalendarSync } from "@/lib/stays";
import { generateId } from "@/lib/utils";
import { sha256 } from "@/lib/archive-integrity";
import { resolveDocumentTitle } from "@/lib/document-title";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { analyzeDocumentBuffer } from "@/lib/document-analysis";
import { resolveSupportedFileType } from "@/lib/document-file-types";
import { createHistoricalPhotoQuestion } from "@/lib/historical-photo";

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
    // Claim the ledger row BEFORE processing — the unique messageId acts
    // as a lock so concurrent polls (rapid manual triggers, page-load
    // races) can't double-process an email during the ~30s of AI work.
    const claimed = await claimEmail(email);
    if (!claimed) {
      summary.skipped.push({ from: email.fromEmail, subject: email.subject, reason: "already processed (or in progress)" });
      continue;
    }

    // MAIL_ROOM_ALLOW_ALL=true disables the sender allowlist (set via
    // Railway env). Anyone who emails the address can then add stays/docs/
    // notes — flip it back off after the family's addresses are collected.
    const allowAll = process.env.MAIL_ROOM_ALLOW_ALL === "true";
    if (!allowAll && !allowed.has(email.fromEmail)) {
      console.log(`[Mail Room] Ignoring email from non-family sender: ${email.fromEmail}`);
      await updateLog(email.messageId, { ignored: "sender not on family allowlist" });
      summary.skipped.push({ from: email.fromEmail, subject: email.subject, reason: "sender not on allowlist" });
      continue;
    }

    try {
      const actions = await processEmail(email);
      await updateLog(email.messageId, actions);
      await postAuditNote(email, actions);
      summary.processed.push({ from: email.fromEmail, subject: email.subject, actions });
    } catch (err) {
      console.error(`[Mail Room] Failed to process "${email.subject}":`, err);
      await updateLog(email.messageId, { error: String(err) });
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
    try {
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
        const duplicate = await findOverlappingStay(stay.guestName, checkIn, checkOut);
        if (duplicate) {
          actions.staysAlreadyOnCalendar.push(stay);
          continue;
        }
        await createStayWithCalendarSync({
          guestName: stay.guestName,
          checkIn,
          checkOut,
          notes: `Added by Mail Room from ${email.fromName}'s email "${email.subject}"`,
        });
        actions.staysCreated.push(stay);
      }
    } catch (error) {
      // Attachment filing remains available even if body interpretation is
      // temporarily unavailable.
      console.error(`[Mail Room] body analysis failed for "${email.subject}":`, error);
      actions.notes.push("Bucky could not analyze the email body; attachments were still archived.");
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
    const result = await fileAttachment(attachment, email);
    if (result && "filed" in result) actions.docsFiled.push(result.filed);
    else if (result && "skipped" in result) actions.notes.push(`Skipped attachment ${result.skipped}`);
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
    const safeName = (email.subject || "email").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "email";
    const analysis = await analyzeDocumentBuffer({
      buffer,
      fileName: `${safeName}.txt`,
      fileType: "text/plain",
      categories,
    });
    const result = analysis.result;
    if (!result) {
      console.error(
        `[Mail Room] ${analysis.state} for email body "${email.subject}"; filing for review: ${analysis.error}`
      );
    }
    const resolution = result
      ? await resolveDocumentCategory({
          suggestedCategory: result.suggestedCategory,
          newCategoryProposal: result.newCategoryProposal,
          confidence: result.confidence,
        })
      : {
          categoryId: null,
          categoryName: null,
          categorySlug: null,
          categoryCreated: false,
          needsReview: true,
        };

    const doc = await prisma.document.create({
      data: {
        title: resolveDocumentTitle({
          suggestedTitle: result?.title,
          fileName: `${safeName}.txt`,
          summary: result?.summary,
          extractedText: result?.extractedText,
          fileType: "text/plain",
          createdAt: email.receivedAt,
        }),
        description: result?.summary || null,
        fileName: `${safeName}.txt`,
        filePath: `/uploads/${uniqueName}`,
        fileType: "text/plain",
        fileSize: buffer.length,
        categoryId: resolution.categoryId,
        tags: result?.tags?.length ? JSON.stringify(result.tags) : null,
        aiSummary: result?.summary || null,
        aiExtractedText: result?.extractedText || null,
        analysisState: analysis.state,
        analysisError: analysis.error,
        uploadedBy: `${email.fromName} (email)`,
        checksum: sha256(buffer),
      },
      include: { category: true },
    });

    void indexDocument(doc.id);

    if (result?.intakeType === "historical_photo") {
      await createHistoricalPhotoQuestion({
        documentId: doc.id,
        documentTitle: doc.title,
        analysis: result,
      }).catch((error) =>
        console.error("[Mail Room] historical-photo question creation failed:", error)
      );
    }

    if (resolution.needsReview) {
      try {
        await prisma.buckyQuestion.create({
          data: {
            question: `Where should "${doc.title}" be filed?`,
            context: `This substantive email body could not be confidently categorized. It came from ${email.fromName} with subject "${email.subject}".`,
            questionType: "archive",
            sourceType: "document",
            sourceId: doc.id,
            sourceLabel: doc.title,
            options: result?.suggestedCategory ? [result.suggestedCategory, "Other"] : undefined,
          },
        });
      } catch (error) {
        console.error("[Mail Room] body filing question creation failed:", error);
      }
    }

    return { title: doc.title, category: resolution.categoryName };
  } catch (err) {
    console.error("[Mail Room] body archive failed:", err);
    return null;
  }
}

// ─── Attachment filing ──────────────────────────────────────────

const SAVE_SIZE_LIMIT = 30 * 1024 * 1024;

type FileResult =
  | { filed: { title: string; category: string | null } }
  | { skipped: string }
  | null; // inline signature image — ignore without comment

async function fileAttachment(
  attachment: InboundAttachment,
  email: InboundEmail
): Promise<FileResult> {
  if (attachment.inline) return null;

  const type = resolveSupportedFileType(attachment.contentType, attachment.filename);
  if (!type) {
    return {
      skipped: `"${attachment.filename}" — refused because Breadloaf cannot read ${attachment.contentType || "that file type"}`,
    };
  }
  if (attachment.size > SAVE_SIZE_LIMIT) {
    return { skipped: `"${attachment.filename}" — too large (${Math.round(attachment.size / 1024 / 1024)}MB)` };
  }

  // Save to /uploads like the web upload path
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const ext = attachment.filename.split(".").pop() || "bin";
  const uniqueName = `${generateId()}.${ext}`;
  await writeFile(path.join(uploadDir, uniqueName), attachment.content);

  // Categorize (save-only formats and oversized-for-AI files skip analysis
  // and land in Needs Review instead)
  const categories = await prisma.category.findMany({
    select: { name: true, description: true },
    orderBy: { name: "asc" },
  });

  const analysis = await analyzeDocumentBuffer({
    buffer: attachment.content,
    fileName: attachment.filename,
    fileType: type,
    categories,
  });
  const result = analysis.result;
  if (!result) {
    console.error(
      `[Mail Room] ${analysis.state} for ${attachment.filename}; filing for review: ${analysis.error}`
    );
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
      title: resolveDocumentTitle({
        suggestedTitle: result?.title,
        fileName: attachment.filename,
        summary: result?.summary,
        extractedText: result?.extractedText,
        fileType: type,
        createdAt: email.receivedAt,
      }),
      description: result?.summary || null,
      fileName: attachment.filename,
      filePath: `/uploads/${uniqueName}`,
      fileType: type,
      fileSize: attachment.size,
      categoryId: resolution.categoryId,
      tags: result?.tags?.length ? JSON.stringify(result.tags) : null,
      aiSummary: result?.summary || null,
      aiExtractedText: result?.extractedText || null,
      analysisState: analysis.state,
      analysisError: analysis.error,
      uploadedBy: `${email.fromName} (email)`,
      checksum: sha256(attachment.content),
    },
    include: { category: true },
  });

  void indexDocument(doc.id);

  if (result?.intakeType === "historical_photo") {
    await createHistoricalPhotoQuestion({
      documentId: doc.id,
      documentTitle: doc.title,
      analysis: result,
    }).catch((error) =>
      console.error("[Mail Room] historical-photo question creation failed:", error)
    );
  }

  if (resolution.needsReview) {
    try {
      await prisma.buckyQuestion.create({
        data: {
          question: `Where should "${doc.title}" be filed?`,
          context: result?.suggestedCategory
            ? `My best guess was "${result.suggestedCategory}", but I wasn't confident enough to file it automatically. It arrived as an attachment to "${email.subject}".`
            : `I couldn't read or confidently categorize this attachment to "${email.subject}".`,
          questionType: "archive",
          sourceType: "document",
          sourceId: doc.id,
          sourceLabel: doc.title,
          options: result?.suggestedCategory ? [result.suggestedCategory, "Other"] : undefined,
        },
      });
    } catch (error) {
      console.error("[Mail Room] needs-review question creation failed:", error);
    }
  }

  return { filed: { title: doc.title, category: resolution.categoryName } };
}

// ─── Audit trail ────────────────────────────────────────────────

// Returns false if another run already claimed (or completed) this email.
async function claimEmail(email: InboundEmail): Promise<boolean> {
  try {
    await prisma.emailLog.create({
      data: {
        messageId: email.messageId,
        fromEmail: email.fromEmail,
        subject: email.subject,
        receivedAt: email.receivedAt,
        actions: JSON.stringify({ status: "processing" }),
      },
    });
    return true;
  } catch {
    return false; // unique collision — someone else owns it
  }
}

async function updateLog(messageId: string, actions: unknown): Promise<void> {
  try {
    await prisma.emailLog.update({
      where: { messageId },
      data: { actions: JSON.stringify(actions) },
    });
  } catch {
    // log row vanished — nothing to update
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
