import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { GROCERY_CATEGORIES, resolveCategory } from "@/lib/grocery-categories";
import { slugifyCategory, isTokenSubset, categorySimilarity } from "@/lib/document-categories";
import { findOverlappingStay, createStayWithCalendarSync } from "@/lib/stays";
import { recordBuckyToolResult, stripToolAuditMetadata } from "@/lib/bucky-ledger";
import { closeOpenArchiveQuestions } from "@/lib/archive-questions";
import { sendBuckyQuestionNotification } from "@/lib/outbound-email";
import { buildBuckyContext } from "@/lib/bucky-context";
import { selectAssistantModelTier } from "@/lib/bucky-routing";
import {
  indexAsset,
  indexDocument,
  indexExpense,
  indexMaintenance,
  indexMemory,
} from "@/lib/embeddings";
import { resolveDocumentTitle } from "@/lib/document-title";
import { parseToolArguments } from "@/lib/openai-json";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { MODELS } from "@/lib/ai-models";
import { distillRetrievalQueries } from "@/lib/bucky-retrieval-query";
import {
  applyTypeSpecificExtraction,
  INTAKE_DOCUMENT_TYPES,
  intakeDeepPassGuidance,
  type IntakeDocumentType,
  type TypeSpecificAnalysisFields,
} from "@/lib/document-intake";

export { MODELS } from "@/lib/ai-models";

// ─── Model Routing ─────────────────────────────────────────────

// ─── Embedding Functions ───────────────────────────────────────
export interface CategoryOption {
  name: string;
  description?: string | null;
}

export interface CategorizationResult extends TypeSpecificAnalysisFields {
  suggestedCategory: string;
  // Set when no existing category fits — server-side guardrails decide
  // whether it actually becomes a new category (see document-categories.ts)
  newCategoryProposal?: { name: string; description: string } | null;
  title: string;
  summary: string;
  extractedText: string;
  tags: string[];
  confidence: number;
  // Cross-linking fields for maintenance receipts
  maintenanceCost?: number | null;
  maintenanceDate?: string | null;
  maintenanceVendor?: string | null;
}

const CategorizationResultSchema = z.object({
  suggestedCategory: z.string(),
  newCategoryProposal: z.object({
    name: z.string(),
    description: z.string(),
  }).nullable(),
  title: z.string(),
  summary: z.string(),
  extractedText: z.string(),
  tags: z.array(z.string()),
  confidence: z.number(),
  maintenanceCost: z.number().nullable(),
  maintenanceDate: z.string().nullable(),
  maintenanceVendor: z.string().nullable(),
  receiptSubtotal: z.number().nullable(),
  receiptSalesTax: z.number().nullable(),
  receiptTotal: z.number().nullable(),
});

const IntakeTriageSchema = z.object({
  documentType: z.enum(INTAKE_DOCUMENT_TYPES),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export interface IntakeTriage {
  documentType: IntakeDocumentType;
  confidence: number;
  reason: string;
}

function requireParsed<T>(value: T | null): T {
  if (value === null) throw new Error("OpenAI returned no structured output");
  return value;
}

function describeCategories(categories: CategoryOption[]): string {
  return categories
    .map((c) => `- ${c.name}${c.description ? ` — ${c.description}` : ""}`)
    .join("\n");
}

const NEW_CATEGORY_RULES = `Category rules:
- STRONGLY prefer an existing category. Set "suggestedCategory" to its exact name and "newCategoryProposal" to null.
- Only if NO existing category reasonably fits, set "suggestedCategory" to "" and propose ONE new category: {"name": "Short Title Case Name", "description": "one sentence describing what belongs in it"}.
- A new category must be a recurring TYPE of document the family will file again (e.g. "Utility Bills"), never a one-off topic, a person's name, or a near-synonym of an existing category.
- If you are unsure, use the existing "Other" category rather than proposing something new.`;

const DOCUMENT_TITLE_RULES = `Title rules:
- Write a concise, human-readable title based on the CONTENT, usually 4-12 words.
- Identify the specific document or recording type and subject. Include a useful date, vendor, person, or location when the content supports it.
- Never copy the source filename or include a file extension.
- Never use a generic label such as "Document", "Untitled Document", "Scan", "Image", "Audio Recording", "Voice Memo", or "Video".
- Return only the title in the JSON title field, with no quotation marks or trailing period.`;

function finalizeCategorizationTitle(
  result: CategorizationResult,
  input: {
    fileName?: string;
    fileType: string;
    intakeType?: IntakeDocumentType;
  }
): CategorizationResult {
  const enriched = applyTypeSpecificExtraction(
    result,
    input.intakeType || "other"
  );
  return {
    ...enriched,
    title: resolveDocumentTitle({
      suggestedTitle: enriched.title,
      fileName: input.fileName,
      summary: enriched.summary,
      extractedText: enriched.extractedText,
      fileType: input.fileType,
      createdAt: new Date(),
    }),
  };
}

// Process audio/video files — extract transcript, summary, key facts
const INTAKE_TRIAGE_PROMPT = `Classify this upload for the Breadloaf Hill family archive into exactly one intake type:
- receipt_invoice: a receipt, invoice, bill, estimate, or purchase record
- corporate_record: minutes, bylaws, resolutions, shareholder records, legal filings, or governance documents
- historical_photo: an older family or property photograph whose people, era, and setting are the primary value
- property_condition_photo: a current photo documenting a room, building, equipment, damage, repair, or physical condition
- voice_memo: a spoken note, meeting recording, narrated walkthrough, or dictated record
- manual_guide: operating instructions, reference manuals, procedures, directories, or how-to guides
- other: anything that does not fit the six specific types

Choose from the closed set. Classify by content, not merely by filename.`;

export async function triageInlineDocument(
  fileBase64: string,
  fileType: string,
  fileName?: string
): Promise<IntakeTriage> {
  const prompt = `${INTAKE_TRIAGE_PROMPT}\n\nSource filename (weak provenance only): ${fileName || "unknown"}`;
  const content = fileType === "application/pdf"
    ? [
        { type: "input_file" as const, filename: fileName || "document.pdf", file_data: `data:application/pdf;base64,${fileBase64}` },
        { type: "input_text" as const, text: prompt },
      ]
    : [
        { type: "input_image" as const, image_url: `data:${fileType};base64,${fileBase64}`, detail: "low" as const },
        { type: "input_text" as const, text: prompt },
      ];
  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: [{ role: "user", content }],
    text: { format: zodTextFormat(IntakeTriageSchema, "document_intake_triage") },
  }));
  return requireParsed(response.output_parsed);
}

export async function triageTextDocument(
  documentText: string,
  fileName: string
): Promise<IntakeTriage> {
  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: `${INTAKE_TRIAGE_PROMPT}\n\nSource filename (weak provenance only): ${fileName}\n\nContent:\n${documentText}`,
    text: { format: zodTextFormat(IntakeTriageSchema, "text_intake_triage") },
  }));
  return requireParsed(response.output_parsed);
}

export async function processMediaFile(
  base64Data: string,
  mimeType: string,
  existingCategories: CategoryOption[],
  fileName?: string
): Promise<CategorizationResult> {
  const mediaFile = await toFile(
    Buffer.from(base64Data, "base64"),
    fileName || "media",
    { type: mimeType }
  );
  const transcription = await withRetry(() =>
    getOpenAIClient().audio.transcriptions.create({
      model: MODELS.transcription,
      file: mediaFile,
    })
  );
  const transcript = transcription.text.trim();
  if (!transcript) throw new Error("OpenAI returned an empty media transcript");

  let intakeType: IntakeDocumentType = "voice_memo";
  try {
    intakeType = (await triageTextDocument(transcript, fileName || "media")).documentType;
  } catch (error) {
    // Triage improves routing but must not become a new single point of failure.
    console.warn(`[Archive] media triage failed for ${fileName || "media"}; using voice-memo deep pass`, error);
  }

  const categorization = await categorizeText(
    transcript,
    fileName || "media",
    existingCategories,
    {
      mediaKind: mimeType.startsWith("video/") ? "video" : "audio recording",
      intakeType,
    }
  );
  return {
    ...categorization,
    // Preserve the raw transcript rather than the categorizer's condensed
    // extraction so the recording remains fully searchable.
    extractedText: transcript,
  };
}

export async function categorizeDocument(
  fileBase64: string,
  fileType: string,
  existingCategories: CategoryOption[],
  fileName?: string,
  options: {
    pdfSample?: { sourcePageCount: number; sampledPageNumbers: number[] };
    intakeType?: IntakeDocumentType;
  } = {}
): Promise<CategorizationResult> {
  const sampleInstruction = options.pdfSample
    ? `\nThis is a representative sample from an oversized ${options.pdfSample.sourcePageCount}-page PDF. The supplied sample contains original pages ${options.pdfSample.sampledPageNumbers.join(", ")}.
- Base the summary and extractedText only on the supplied pages and state that the analysis is sampled, not exhaustive.
- For a photo collection, put concise searchable descriptions of visible people, likely eras, settings, objects, and any legible names or captions into extractedText; do not limit extractedText to OCR.`
    : "";
  const deepPassGuidance = intakeDeepPassGuidance(options.intakeType || "other");
  const prompt = `You are a document categorization assistant for the Breadloaf Hill family property archive in Vermont.

Existing categories:
${describeCategories(existingCategories)}

${NEW_CATEGORY_RULES}

${DOCUMENT_TITLE_RULES}

Source filename (provenance only; do not use it as the title): ${fileName || "unknown"}
${sampleInstruction}
${deepPassGuidance}

Analyze this document and return ONLY valid JSON (no markdown fences, no extra text) with these fields:
{
  "suggestedCategory": "exact name of an existing category, or \\"\\" if proposing a new one",
  "newCategoryProposal": null or {"name": "...", "description": "..."},
  "title": "descriptive title for this document",
  "summary": "2-3 sentence summary of the document content",
  "extractedText": "key text extracted from the document",
  "tags": ["relevant", "tags", "for", "searching"],
  "confidence": 0.0 to 1.0,
  "maintenanceCost": null or dollar amount as number if this is a maintenance receipt/invoice (e.g. 150.00),
  "maintenanceDate": null or date in YYYY-MM-DD format if this is a maintenance receipt/invoice,
  "maintenanceVendor": null or vendor/contractor name if this is a maintenance receipt/invoice,
  "receiptSubtotal": null or receipt/invoice subtotal as a number,
  "receiptSalesTax": null or receipt/invoice sales tax as a number,
  "receiptTotal": null or receipt/invoice final total as a number
}

Be specific with the title. Extract dates, names, amounts, and other key details in the summary.
If the document is a receipt, invoice, or record related to property maintenance, repairs, or services, extract the cost, date, and vendor into the maintenance fields.

This property is owned by an S-Corp with four shareholders (Tom, Jim, Sandy, Greg Craig). Categorization hints:
- K-1 forms, Schedule K-1 → "K-1 Forms"
- Meeting minutes, resolutions, votes → "Meeting Minutes"
- Articles of incorporation, bylaws, annual reports, state filings → "Corporate Filings"
- P&L, balance sheets, income statements, financial reports → "Financial Statements"
- Bank statements, account statements → "Bank Statements"
- Capital account statements, shareholder equity → "Capital Accounts"`;

  const content = fileType === "application/pdf"
    ? [
        { type: "input_file" as const, filename: fileName || "document.pdf", file_data: `data:application/pdf;base64,${fileBase64}` },
        { type: "input_text" as const, text: prompt },
      ]
    : [
        { type: "input_image" as const, image_url: `data:${fileType};base64,${fileBase64}`, detail: "auto" as const },
        { type: "input_text" as const, text: prompt },
      ];
  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: [{ role: "user", content }],
    text: { format: zodTextFormat(CategorizationResultSchema, "document_categorization") },
  }));
  return finalizeCategorizationTitle(requireParsed(response.output_parsed), {
    fileName,
    fileType,
    intakeType: options.intakeType,
  });
}

// Categorize a document from extracted text (Word/Excel/CSV/TXT — types
// Gemini can't read inline). Same contract as categorizeDocument.
export interface CategorizeTextOptions {
  // Set when the text is a transcript rather than a document. A recording's
  // value is in the detail it captures, so the summary instruction and the
  // extraction cues both change. Before the OpenAI migration these lived in
  // processMediaFile's own prompt; splitting that into transcribe-then-
  // categorize dropped them, which thinned board-meeting and walkthrough
  // summaries down to the document prompt's "2-3 sentences".
  mediaKind?: "audio recording" | "video";
  intakeType?: IntakeDocumentType;
}

export async function categorizeText(
  documentText: string,
  fileName: string,
  existingCategories: CategoryOption[],
  options: CategorizeTextOptions = {}
): Promise<CategorizationResult> {
  const { mediaKind, intakeType = "other" } = options;

  const intro = mediaKind
    ? `You are processing a ${mediaKind} for the Craig family property archive at Breadloaf Hill, Vermont. The property is owned as an S-Corp by four Craig brothers (Tom, Jim, Sandy, Greg), with Ethan (Jim's son) now on the board.`
    : `You are a document categorization assistant for the Breadloaf Hill family property archive in Vermont.`;

  const summaryRule = mediaKind
    ? `"summary": "comprehensive summary — capture ALL key facts, decisions, action items, dollar amounts, names mentioned, topics discussed. This is what the family assistant will reference, so be thorough",`
    : `"summary": "2-3 sentence summary of the document content",`;

  const sourceLabel = mediaKind
    ? `Below is the transcript of an uploaded ${mediaKind} (file name: "${fileName}")`
    : `Below is the text content extracted from an uploaded document (file name: "${fileName}")`;

  const mediaGuidance = mediaKind
    ? `

For board meetings: capture all votes, motions, decisions, assignments, deadlines, and financial discussions.
For property walkthroughs: note condition of structures, items needing attention, any damage or improvements.
Be extremely thorough — extract every useful detail.`
    : "";
  const deepPassGuidance = intakeDeepPassGuidance(intakeType);

  const prompt = `${intro}

Existing categories:
${describeCategories(existingCategories)}

${NEW_CATEGORY_RULES}

${DOCUMENT_TITLE_RULES}

${deepPassGuidance}

${sourceLabel}. Analyze it and return ONLY valid JSON (no markdown fences, no extra text) with these fields:
{
  "suggestedCategory": "exact name of an existing category, or \\"\\" if proposing a new one",
  "newCategoryProposal": null or {"name": "...", "description": "..."},
  "title": "descriptive title for this document",
  ${summaryRule}
  "extractedText": "the key facts from the document — names, dates, dollar amounts, decisions, account numbers redacted to last 4 digits",
  "tags": ["relevant", "tags", "for", "searching"],
  "confidence": 0.0 to 1.0,
  "maintenanceCost": null or dollar amount as number if this is a maintenance receipt/invoice,
  "maintenanceDate": null or date in YYYY-MM-DD format if this is a maintenance receipt/invoice,
  "maintenanceVendor": null or vendor/contractor name if this is a maintenance receipt/invoice,
  "receiptSubtotal": null or receipt/invoice subtotal as a number,
  "receiptSalesTax": null or receipt/invoice sales tax as a number,
  "receiptTotal": null or receipt/invoice final total as a number
}

This property is owned by an S-Corp with four shareholders (Tom, Jim, Sandy, Greg Craig). Categorization hints:
- K-1 forms, Schedule K-1 → "K-1 Forms"
- Meeting minutes, resolutions, votes → "Meeting Minutes"
- Articles of incorporation, bylaws, annual reports, state filings → "Corporate Filings"
- P&L, balance sheets, income statements, financial reports → "Financial Statements"
- Bank statements, account statements → "Bank Statements"
- Capital account statements, shareholder equity → "Capital Accounts"${mediaGuidance}

${mediaKind ? "Transcript" : "Document text"}:
${documentText}`;

  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: prompt,
    text: { format: zodTextFormat(CategorizationResultSchema, "text_categorization") },
  }));
  return finalizeCategorizationTitle(requireParsed(response.output_parsed), {
    fileName,
    fileType: "text/plain",
    intakeType,
  });
}

interface ScannedPantryItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
}

const ScannedPantryItemsSchema = z.array(z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  category: z.string(),
}));

export async function scanPantryItems(
  imageBase64: string,
  fileType: string
): Promise<ScannedPantryItem[]> {
  const prompt = `You are a pantry inventory assistant. Look at this photo of pantry shelves, a fridge, or food storage area.

Identify all visible items and return ONLY valid JSON (no markdown fences, no extra text) as an array:
[
  {
    "name": "Item Name",
    "quantity": estimated count as number (default 1),
    "unit": "unit like cans, boxes, bags, bottles, jars, rolls, packages, or items",
    "category": "one of: Canned Goods, Dry Goods, Spices & Seasonings, Condiments, Beverages, Snacks, Baking, Paper & Cleaning, Other"
  }
]

Guidelines:
- List every distinct item you can identify
- Estimate quantities based on what's visible
- Be specific with names (e.g., "Canned Tomatoes" not just "cans")
- Choose the most appropriate category
- If you can read brand names, include them (e.g., "Barilla Spaghetti")
- If the image is unclear or not of food/pantry items, return an empty array []`;

  const response = await withRetry(() => getOpenAIClient().responses.parse({
    model: MODELS.flash,
    input: [{
      role: "user",
      content: [
        { type: "input_image", image_url: `data:${fileType};base64,${imageBase64}`, detail: "auto" },
        { type: "input_text", text: prompt },
      ],
    }],
    text: { format: zodTextFormat(ScannedPantryItemsSchema, "pantry_items") },
  }));
  return requireParsed(response.output_parsed);
}

// Function-calling tools for the assistant
const assistantToolDeclarations: Array<{
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}> = [
      {
        name: "add_grocery_item",
        description:
          "Add an item to the family grocery/shopping list. Use when someone asks to add something they need to buy.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the grocery item",
            },
            category: {
              type: "string",
              description: `Category, one of: ${GROCERY_CATEGORIES.join(", ")}. Omit if unsure — the list auto-categorizes by item name.`,
            },
          },
          required: ["name"],
        },
      },
      {
        name: "create_stay",
        description:
          "Add a stay/visit to the property calendar (also syncs to the family Google Calendar). Use when someone says they or other family members will be at the property on certain dates.",
        parameters: {
          type: "object",
          properties: {
            guestName: {
              type: "string",
              description:
                "Who is staying, as it should appear on the calendar (e.g. 'Jim & Carol', 'The Kellers'). If the user says 'we' or 'me', use their name.",
            },
            checkIn: {
              type: "string",
              description: "Arrival date, YYYY-MM-DD",
            },
            checkOut: {
              type: "string",
              description: "Departure date, YYYY-MM-DD (must be after checkIn)",
            },
            roomName: {
              type: "string",
              description:
                "Optional room to assign (e.g. 'Tom Craig's Room', 'Loft', 'Woods Cabin'). Omit if not specified.",
            },
            notes: {
              type: "string",
              description: "Optional notes about the visit",
            },
          },
          required: ["guestName", "checkIn", "checkOut"],
        },
      },
      {
        name: "add_maintenance_record",
        description:
          "Log a maintenance task, repair, or property work item to the maintenance log",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Short title of the maintenance task",
            },
            description: {
              type: "string",
              description: "Detailed description of the work",
            },
            category: {
              type: "string",
              description:
                "Category: plumbing, electrical, structural, grounds, appliance, seasonal, other",
            },
            performedBy: {
              type: "string",
              description: "Who performed the work",
            },
            cost: {
              type: "number",
              description: "Cost in dollars if known",
            },
            assetName: {
              type: "string",
              description:
                "Name of the property system/equipment this work was done on (e.g. 'Well & Water System', 'Generator'), if it maps to one. Links the record to that system's history.",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "save_asset",
        description:
          "Create or update a property system/equipment record (the 'notebook' of permanently installed systems: well pump, furnace, generator, septic, installed dehumidifier, etc.). Use PROACTIVELY whenever you learn about a permanently installed system or major piece of equipment — from conversation, a document, or a voice-memo walkthrough. If a matching system already exists, it is updated (details filled in, notes appended) rather than duplicated. NOT for consumables, portable items, or supplies.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Name of the system as the family would say it (e.g. 'Well & Water System', 'Basement Dehumidifier'). Check the PROPERTY SYSTEMS list first and reuse an existing name when you mean the same system.",
            },
            category: {
              type: "string",
              description:
                "One of: water, power, hvac, structure, appliance, grounds, safety, other",
            },
            location: {
              type: "string",
              description: "Where it is on the property (e.g. 'basement, north wall')",
            },
            make: {
              type: "string",
              description: "Manufacturer if known",
            },
            model: {
              type: "string",
              description: "Model number/name if known",
            },
            serial: {
              type: "string",
              description: "Serial number if known",
            },
            installedYear: {
              type: "number",
              description: "Year installed, if known",
            },
            notes: {
              type: "string",
              description:
                "Quirks, tips, history, warnings — anything a new caretaker would need. When UPDATING an existing system, send ONLY the new information (existing notes are kept automatically — do not restate them).",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "set_document_category",
        description:
          "File or refile a document in the archive into a category. Use this to answer a document filing question (a document that landed in Needs Review), or when someone clearly says where a specific document belongs. Prefer an existing category name; a new one is created only if nothing matches.",
        parameters: {
          type: "object",
          properties: {
            documentId: {
              type: "string",
              description:
                "The id of the document to file (from the filing question's related document id, or a document referenced in the archive context).",
            },
            categoryName: {
              type: "string",
              description:
                "The category to file it under. Match an existing category name when the answer points to one.",
            },
          },
          required: ["documentId", "categoryName"],
        },
      },
      {
        name: "add_bulletin_message",
        description: "Post a message to the family bulletin/message board",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The message content",
            },
            author: {
              type: "string",
              description: "Who is posting the message",
            },
          },
          required: ["content", "author"],
        },
      },
      {
        name: "add_dinner_signup",
        description: "Sign up to cook dinner on a specific date",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date for the dinner in YYYY-MM-DD format",
            },
            chef: {
              type: "string",
              description: "Who is cooking",
            },
            meal: {
              type: "string",
              description: "What meal is being cooked",
            },
            headCount: {
              type: "number",
              description: "How many people to cook for",
            },
          },
          required: ["date", "chef"],
        },
      },
      {
        name: "add_pantry_item",
        description:
          "Add a new item to the pantry inventory or note something that is in stock",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the pantry item",
            },
            category: {
              type: "string",
              description:
                "Category: canned goods, dry goods, condiments, spices, baking, snacks, beverages, cleaning, paper goods, other",
            },
            quantity: {
              type: "number",
              description: "Quantity in stock",
            },
            unit: {
              type: "string",
              description:
                "Unit of measurement (e.g., rolls, cans, boxes, bags)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "add_expense",
        description:
          "Log a property expense for the S-Corp. Use when someone reports a cost, bill, payment, or purchase for the property.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date of the expense in YYYY-MM-DD format",
            },
            amount: {
              type: "number",
              description: "Dollar amount of the expense",
            },
            description: {
              type: "string",
              description: "What the expense was for",
            },
            category: {
              type: "string",
              description:
                "Category: utilities, maintenance, insurance, taxes, improvements, supplies, professional-services, other",
            },
            type: {
              type: "string",
              description:
                "Type: operating (regular costs) or capital (improvements that add value)",
            },
            paidBy: {
              type: "string",
              description:
                "Who paid: Tom, Jim, Sandy, Greg, or Shared",
            },
            vendor: {
              type: "string",
              description: "Vendor or company name if known",
            },
          },
          required: ["date", "amount", "description"],
        },
      },
      {
        name: "save_memory",
        description:
          "Save durable information to long-term memory when it does not belong in a native operational record or a physical asset. Types: 'semantic' for facts/preferences, 'episodic' for events/decisions, and 'procedural' for reusable how-to knowledge. Same-topic changes preserve the prior version as superseded history.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Memory type: 'semantic' (facts, preferences, relationships), 'episodic' (events, decisions, meetings), or 'procedural' (processes, how-to, steps)",
            },
            topic: {
              type: "string",
              description:
                "Short label (e.g., 'roof repair', 'Sandy board roles', 'winterization steps')",
            },
            content: {
              type: "string",
              description:
                "The detailed memory — include names, dates, amounts, decisions, steps, context. Be thorough.",
            },
            source: {
              type: "string",
              description:
                "Where this info came from (e.g., 'conversation with Jim', 'board meeting July 2026')",
            },
            sourceType: {
              type: "string",
              description: "Structured source type when known, such as document, meeting-minutes, or conversation",
            },
            sourceId: {
              type: "string",
              description: "ID of the source record when known",
            },
            scope: {
              type: "string",
              description: "Recall scope: property, family, user, or entity. Defaults to property.",
            },
            subject: {
              type: "string",
              description: "Person, system, organization, or topic this memory is primarily about",
            },
            confidence: {
              type: "number",
              description: "Confidence from 0 to 1; use lower values for uncertain or second-hand information",
            },
            importance: {
              type: "number",
              description: "Long-term importance from 0 to 1; routine details should stay near 0.5",
            },
            validFrom: {
              type: "string",
              description: "Date this became true, in YYYY-MM-DD format, when known",
            },
            validUntil: {
              type: "string",
              description: "Date this stops being true, in YYYY-MM-DD format, when known",
            },
          },
          required: ["type", "topic", "content"],
        },
      },
      {
        name: "ask_family",
        description:
          "Create a persistent question for the family when information is ambiguous, conflicting, or consequential enough that you should not guess. The question remains available after the chat closes. Do not use this for a question the current user can answer immediately in the active conversation unless they are leaving or the question belongs to someone else.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "One clear question that can be answered without rereading the full source",
            },
            context: {
              type: "string",
              description: "Why you are asking and the evidence that made the issue ambiguous",
            },
            targetPerson: {
              type: "string",
              description: "The person most likely to know, or omit to ask the whole family",
            },
            questionType: {
              type: "string",
              description: "clarification, duplicate, governance, archive, or safety",
            },
            options: {
              type: "array",
              description: "Two to four concise suggested answers when useful",
              items: { type: "string" },
            },
            sourceType: {
              type: "string",
              description: "conversation, document, meeting-minutes, archive, or property-system",
            },
            sourceId: {
              type: "string",
              description: "Related record ID when known",
            },
            source: {
              type: "string",
              description: "Human-readable source label, such as a document title",
            },
          },
          required: ["question", "context"],
        },
      },
      {
        name: "update_position",
        description:
          "Record a current family or corporate position and preserve the prior holder in history. Use when a direct instruction or authoritative approved record clearly appoints someone. If the source is a draft, discussion, nomination, or unclear, use ask_family instead.",
        parameters: {
          type: "object",
          properties: {
            personName: {
              type: "string",
              description: "Full name of the new position holder",
            },
            position: {
              type: "string",
              description: "Position name, such as President, Treasurer, or Secretary",
            },
            effectiveDate: {
              type: "string",
              description: "Effective date in YYYY-MM-DD format; use today's date only for a direct current instruction",
            },
            sourceType: {
              type: "string",
              description: "conversation or meeting-minutes",
            },
            sourceId: {
              type: "string",
              description: "Related document ID when known",
            },
            source: {
              type: "string",
              description: "Human-readable source, such as Approved 2026 board meeting minutes",
            },
          },
          required: ["personName", "position", "effectiveDate", "sourceType", "source"],
        },
      },
];

const assistantTools: OpenAI.Responses.Tool[] = assistantToolDeclarations.map((tool) => ({
  type: "function",
  strict: false,
  ...tool,
}));

// Fuzzy asset lookup: exact (case-insensitive) name first, then containment
// either direction ("Well Pump" matches "Well & Water System" only via
// explicit containment, so near-misses update instead of duplicating).
// In-memory scan keeps this portable across postgres and sqlite dev.
async function findAssetByName(name: string) {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const all = await prisma.asset.findMany();
  return (
    all.find((a) => a.name.toLowerCase() === lower) ||
    all.find(
      (a) =>
        a.name.toLowerCase().includes(lower) ||
        lower.includes(a.name.toLowerCase())
    ) ||
    null
  );
}

function optionalDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function boundedNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : fallback;
}

// Execute a function call from the assistant
async function executeToolFunction(
  name: string,
  args: Record<string, unknown>,
  username?: string
): Promise<Record<string, unknown>> {
  switch (name) {
    case "add_grocery_item": {
      const item = await prisma.groceryItem.create({
        data: {
          name: args.name as string,
          category: resolveCategory(args.category as string | undefined, args.name as string),
          addedBy: username || undefined,
        },
      });
      return {
        success: true,
        item: { id: item.id, name: item.name, category: item.category },
      };
    }
    case "create_stay": {
      const guestName = (args.guestName as string)?.trim();
      const checkIn = new Date(args.checkIn as string);
      const checkOut = new Date(args.checkOut as string);
      if (!guestName || isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
        return { success: false, error: "guestName, checkIn, and checkOut are required" };
      }
      if (checkOut <= checkIn) {
        return { success: false, error: "checkOut must be after checkIn" };
      }

      const duplicate = await findOverlappingStay(guestName, checkIn, checkOut);
      if (duplicate) {
        return {
          success: false,
          alreadyOnCalendar: true,
          existing: {
            guestName: duplicate.guestName,
            checkIn: duplicate.checkIn.toISOString().slice(0, 10),
            checkOut: duplicate.checkOut.toISOString().slice(0, 10),
          },
          note: "A matching stay already overlaps these dates — tell the user it's already on the calendar.",
        };
      }

      let roomId: string | null = null;
      if (args.roomName) {
        const room = await prisma.room.findFirst({
          where: { name: { contains: (args.roomName as string).trim(), mode: "insensitive" } },
        });
        roomId = room?.id ?? null;
      }

      const stay = await createStayWithCalendarSync({
        guestName,
        checkIn,
        checkOut,
        roomId,
        notes: (args.notes as string)?.trim() || (username ? `Added by Bucky for ${username}` : "Added by Bucky"),
      });
      return {
        success: true,
        stay: {
          id: stay.id,
          guestName: stay.guestName,
          checkIn: stay.checkIn.toISOString().slice(0, 10),
          checkOut: stay.checkOut.toISOString().slice(0, 10),
          room: stay.room?.name ?? null,
        },
      };
    }
    case "add_maintenance_record": {
      const asset = args.assetName
        ? await findAssetByName(args.assetName as string)
        : null;
      const record = await prisma.maintenanceRecord.create({
        data: {
          title: args.title as string,
          description: (args.description as string) || undefined,
          category: (args.category as string) || undefined,
          performedBy: (args.performedBy as string) || username || undefined,
          performedAt: new Date(),
          cost: args.cost ? parseFloat(String(args.cost)) : undefined,
          assetId: asset?.id,
        },
      });
      void indexMaintenance(record.id);
      if (asset) void indexAsset(asset.id);
      return {
        success: true,
        record: { id: record.id, title: record.title },
        linkedAsset: asset?.name ?? null,
      };
    }
    case "save_asset": {
      const name = (args.name as string)?.trim();
      if (!name) return { success: false, error: "name is required" };

      const incomingNotes = (args.notes as string)?.trim();
      const existing = await findAssetByName(name);

      if (existing) {
        // Merge notes: keep existing when incoming adds nothing, replace when
        // incoming restates-and-extends them, append only genuinely new info
        const oldNotes = existing.notes || "";
        const mergedNotes = !incomingNotes
          ? existing.notes
          : oldNotes.toLowerCase().includes(incomingNotes.toLowerCase())
            ? existing.notes
            : incomingNotes.toLowerCase().includes(oldNotes.toLowerCase().slice(0, 80))
              ? incomingNotes
              : [oldNotes, incomingNotes].filter(Boolean).join("\n— ");
        const updated = await prisma.asset.update({
          where: { id: existing.id },
          data: {
            category: (args.category as string) || existing.category,
            location: (args.location as string) || existing.location,
            make: (args.make as string) || existing.make,
            model: (args.model as string) || existing.model,
            serial: (args.serial as string) || existing.serial,
            installedYear: args.installedYear
              ? parseInt(String(args.installedYear))
              : existing.installedYear,
            notes: mergedNotes,
          },
        });
        void indexAsset(updated.id);
        return {
          success: true,
          action: "updated",
          asset: { id: updated.id, name: updated.name },
          _audit: {
            entityType: "asset",
            entityId: updated.id,
            beforeState: existing,
            afterState: updated,
          },
          note: `Matched existing system "${existing.name}" — details merged, not duplicated.`,
        };
      }

      const created = await prisma.asset.create({
        data: {
          name,
          category: (args.category as string) || "other",
          location: (args.location as string) || undefined,
          make: (args.make as string) || undefined,
          model: (args.model as string) || undefined,
          serial: (args.serial as string) || undefined,
          installedYear: args.installedYear
            ? parseInt(String(args.installedYear))
            : undefined,
          notes: incomingNotes || undefined,
          addedBy: username || undefined,
        },
      });
      void indexAsset(created.id);
      return {
        success: true,
        action: "created",
        asset: { id: created.id, name: created.name },
      };
    }
    case "set_document_category": {
      const documentId = String(args.documentId || "").trim();
      const categoryName = String(args.categoryName || "").trim();
      if (!documentId || !categoryName) {
        return { success: false, error: "documentId and categoryName are required" };
      }
      const documentExists = await prisma.document.findFirst({
        where: { id: documentId, deletedAt: null },
        select: { id: true },
      });
      if (!documentExists) return { success: false, error: "Document not found" };

      const categories = await prisma.category.findMany({
        select: { id: true, name: true, slug: true },
      });
      const lower = categoryName.toLowerCase();
      const slug = slugifyCategory(categoryName);
      let target =
        categories.find((c) => c.name.toLowerCase() === lower || c.slug === slug) ||
        categories.find((c) => isTokenSubset(c.name, categoryName)) ||
        null;
      if (!target) {
        let best: { cat: (typeof categories)[number]; score: number } | null = null;
        for (const c of categories) {
          const score = categorySimilarity(c.name, categoryName);
          if (score >= 0.72 && (!best || score > best.score)) best = { cat: c, score };
        }
        target = best?.cat ?? null;
      }

      let categoryCreated = false;
      if (!target) {
        if (!slug) return { success: false, error: "Invalid category name" };
        try {
          target = await prisma.category.create({
            data: { name: categoryName, slug, icon: "Folder", color: "green" },
            select: { id: true, name: true, slug: true },
          });
          categoryCreated = true;
        } catch {
          target = await prisma.category.findFirst({
            where: { OR: [{ slug }, { name: categoryName }] },
            select: { id: true, name: true, slug: true },
          });
          if (!target) return { success: false, error: "Could not resolve category" };
        }
      }

      const resolvedTarget = target;
      const filingChange = await prisma.$transaction(async (tx) => {
        const document = await tx.document.findUnique({
          where: { id: documentId },
          include: { category: true },
        });
        if (!document || document.deletedAt) throw new Error("Document no longer exists");

        await tx.document.update({
          where: { id: document.id },
          data: { categoryId: resolvedTarget.id },
        });

        // Close any open filing question tied to this document. The snapshots
        // let Ledger undo restore the question as well as the category.
        const { before: questionsBefore, after: questionsAfter } =
          await closeOpenArchiveQuestions(tx, {
            documentId: document.id,
            categoryName: resolvedTarget.name,
            answeredBy: username || "Bucky",
          });

        return { document, questionsBefore, questionsAfter };
      });

      void indexDocument(filingChange.document.id);

      return {
        success: true,
        document: { id: filingChange.document.id, title: filingChange.document.title },
        category: resolvedTarget.name,
        categoryCreated,
        _audit: {
          entityType: "document",
          entityId: filingChange.document.id,
          beforeState: {
            documentId: filingChange.document.id,
            categoryId: filingChange.document.categoryId,
            categoryName: filingChange.document.category?.name ?? null,
            questions: filingChange.questionsBefore,
          },
          afterState: {
            documentId: filingChange.document.id,
            categoryId: resolvedTarget.id,
            categoryName: resolvedTarget.name,
            questions: filingChange.questionsAfter,
          },
          reversible:
            filingChange.document.categoryId !== resolvedTarget.id ||
            filingChange.questionsBefore.length > 0,
        },
      };
    }
    case "add_bulletin_message": {
      const message = await prisma.bulletinMessage.create({
        data: {
          content: args.content as string,
          author: (args.author as string) || username || "Anonymous",
        },
      });
      return {
        success: true,
        message: { id: message.id, content: message.content },
      };
    }
    case "add_dinner_signup": {
      const dinner = await prisma.dinnerSignup.create({
        data: {
          date: new Date(`${args.date}T18:00:00`),
          chef: args.chef as string,
          meal: (args.meal as string) || undefined,
          headCount: args.headCount
            ? parseInt(String(args.headCount))
            : undefined,
          notes: (args.notes as string) || undefined,
        },
      });
      return {
        success: true,
        dinner: { id: dinner.id, date: args.date, chef: dinner.chef },
      };
    }
    case "add_pantry_item": {
      const item = await prisma.pantryItem.create({
        data: {
          name: args.name as string,
          category: (args.category as string) || undefined,
          quantity: args.quantity
            ? parseInt(String(args.quantity))
            : undefined,
          unit: (args.unit as string) || undefined,
          updatedBy: username || undefined,
        },
      });
      return {
        success: true,
        item: { id: item.id, name: item.name },
      };
    }
    case "save_memory": {
      const topic = String(args.topic || "").trim();
      const content = String(args.content || "").trim();
      if (!topic || !content) return { success: false, error: "topic and content are required" };
      const requestedType = ["semantic", "episodic", "procedural"].includes(String(args.type))
        ? String(args.type)
        : undefined;
      const requestedScope = ["property", "family", "user", "entity"].includes(String(args.scope))
        ? String(args.scope)
        : undefined;
      const memoryScope = requestedScope || "property";
      const subject = typeof args.subject === "string" && args.subject.trim()
        ? args.subject.trim()
        : undefined;
      const validFrom = optionalDate(args.validFrom);
      const validUntil = optionalDate(args.validUntil);
      if (validFrom && validUntil && validUntil < validFrom) {
        return { success: false, error: "validUntil must be on or after validFrom" };
      }
      // Same-topic changes create a new active version and preserve history.
      const topicMatches = await prisma.jarvisMemory.findMany({
        where: {
          topic: { equals: topic, mode: "insensitive" },
          scope: memoryScope,
          status: "active",
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });
      const existing = subject
        ? topicMatches.find((memory) => memory.subject?.toLowerCase() === subject.toLowerCase())
        : topicMatches.find((memory) => !memory.subject) ||
          (topicMatches.length === 1 ? topicMatches[0] : undefined);
      if (existing) {
        if (existing.content.trim().toLowerCase() === content.toLowerCase()) {
          void indexMemory(existing.id);
          return {
            success: true,
            action: "unchanged",
            topic,
            memory: { id: existing.id, topic: existing.topic },
            _audit: { entityType: "memory", entityId: existing.id, afterState: existing },
          };
        }

        const replacement = await prisma.$transaction(async (tx) => {
          const created = await tx.jarvisMemory.create({
            data: {
              type: requestedType || existing.type,
              topic,
              content,
              source: (args.source as string) || existing.source,
              sourceType: (args.sourceType as string) || existing.sourceType,
              sourceId: (args.sourceId as string) || existing.sourceId,
              scope: memoryScope,
              subject: subject || existing.subject,
              confidence: boundedNumber(args.confidence, existing.confidence),
              importance: boundedNumber(args.importance, existing.importance),
              validFrom: validFrom || existing.validFrom,
              validUntil: validUntil || existing.validUntil,
              accessScope: "family",
            },
          });
          await tx.jarvisMemory.update({
            where: { id: existing.id },
            data: { status: "superseded", supersededById: created.id },
          });
          return created;
        });
        void indexMemory(existing.id);
        void indexMemory(replacement.id);
        return {
          success: true,
          action: "updated",
          topic,
          memory: { id: replacement.id, topic: replacement.topic },
          _audit: {
            entityType: "memory",
            entityId: replacement.id,
            beforeState: existing,
            afterState: replacement,
          },
        };
      }
      const memory = await prisma.jarvisMemory.create({
        data: {
          type: requestedType || "semantic",
          topic,
          content,
          source: (args.source as string) || undefined,
          sourceType: (args.sourceType as string) || undefined,
          sourceId: (args.sourceId as string) || undefined,
          scope: memoryScope,
          subject,
          confidence: boundedNumber(args.confidence, 1),
          importance: boundedNumber(args.importance, 0.5),
          validFrom,
          validUntil,
          accessScope: "family",
        },
      });
      // Embed the memory for semantic retrieval
      void indexMemory(memory.id);
      return {
        success: true,
        action: "saved",
        topic,
        memory: { id: memory.id, topic: memory.topic },
        _audit: { entityType: "memory", entityId: memory.id, afterState: memory },
      };
    }
    case "add_expense": {
      const expenseDate = new Date(args.date as string);
      const expense = await prisma.expense.create({
        data: {
          date: expenseDate,
          amount: parseFloat(String(args.amount)),
          description: args.description as string,
          category: (args.category as string) || "other",
          type: (args.type as string) || "operating",
          paidBy: (args.paidBy as string) || username || "Shared",
          vendor: (args.vendor as string) || undefined,
          fiscalYear: expenseDate.getFullYear(),
        },
      });
      void indexExpense(expense.id);
      return {
        success: true,
        expense: {
          id: expense.id,
          amount: expense.amount,
          description: expense.description,
        },
      };
    }
    case "ask_family": {
      const targetPerson =
        typeof args.targetPerson === "string" ? args.targetPerson.trim() : undefined;
      const question = await prisma.buckyQuestion.create({
        data: {
          question: String(args.question).trim(),
          context: String(args.context).trim(),
          targetPerson,
          questionType: typeof args.questionType === "string" ? args.questionType : "clarification",
          options: Array.isArray(args.options) ? args.options.map(String) : undefined,
          sourceType: typeof args.sourceType === "string" ? args.sourceType : "conversation",
          sourceId: typeof args.sourceId === "string" ? args.sourceId : undefined,
          sourceLabel: typeof args.source === "string" ? args.source : undefined,
        },
      });
      let notification: "sent" | "not_configured" | "no_recipients" | "failed" =
        "not_configured";
      try {
        const result = await sendBuckyQuestionNotification({
          questionId: question.id,
          targetPerson,
        });
        notification = result.status;
      } catch (error) {
        notification = "failed";
        console.error("Bucky question notification failed:", error);
      }
      return {
        success: true,
        question: { id: question.id, question: question.question },
        notification,
        note: "The question is now in the persistent Questions tab.",
      };
    }
    case "update_position": {
      const personName = String(args.personName || "").trim();
      const position = String(args.position || "").trim();
      const effectiveAt = new Date(`${args.effectiveDate}T12:00:00`);
      if (!personName || !position || Number.isNaN(effectiveAt.getTime())) {
        return { success: false, error: "personName, position, and a valid effectiveDate are required" };
      }

      const change = await prisma.$transaction(async (tx) => {
        const member = await tx.familyMember.findFirst({
          where: { name: { equals: personName, mode: "insensitive" } },
        });
        const previous = await tx.positionAssignment.findFirst({
          where: { position: { equals: position, mode: "insensitive" }, endedAt: null },
          orderBy: { effectiveAt: "desc" },
        });
        const affectedMemberIds = Array.from(
          new Set([member?.id, previous?.memberId].filter((id): id is string => Boolean(id)))
        );
        const membersBefore = affectedMemberIds.length
          ? await tx.familyMember.findMany({
              where: { id: { in: affectedMemberIds } },
              select: { id: true, boardRole: true, isBoardMember: true },
            })
          : [];

        if (previous?.personName.toLowerCase() === personName.toLowerCase()) {
          return {
            previous,
            previousAfter: previous,
            current: previous,
            unchanged: true,
            member,
            membersBefore,
            membersAfter: membersBefore,
          };
        }

        if (previous) {
          await tx.positionAssignment.update({
            where: { id: previous.id },
            data: { endedAt: effectiveAt },
          });
          if (previous.memberId) {
            const previousMember = await tx.familyMember.findUnique({ where: { id: previous.memberId } });
            if (previousMember) {
              const remainingRoles = (previousMember.boardRole || "")
                .split(",")
                .map((role) => role.trim())
                .filter((role) => role && role.toLowerCase() !== position.toLowerCase());
              await tx.familyMember.update({
                where: { id: previousMember.id },
                data: { boardRole: remainingRoles.join(", ") || null },
              });
            }
          }
        }

        const current = await tx.positionAssignment.create({
          data: {
            position,
            personName: member?.name || personName,
            memberId: member?.id,
            effectiveAt,
            sourceType: String(args.sourceType),
            sourceId: typeof args.sourceId === "string" ? args.sourceId : undefined,
            sourceLabel: String(args.source),
          },
        });

        if (member) {
          const roles = (member.boardRole || "")
            .split(",")
            .map((role) => role.trim())
            .filter(Boolean);
          if (!roles.some((role) => role.toLowerCase() === position.toLowerCase())) roles.push(position);
          await tx.familyMember.update({
            where: { id: member.id },
            data: { boardRole: roles.join(", ") || null, isBoardMember: true },
          });
        }

        const [previousAfter, membersAfter] = await Promise.all([
          previous ? tx.positionAssignment.findUnique({ where: { id: previous.id } }) : null,
          affectedMemberIds.length
            ? tx.familyMember.findMany({
                where: { id: { in: affectedMemberIds } },
                select: { id: true, boardRole: true, isBoardMember: true },
              })
            : [],
        ]);

        return { previous, previousAfter, current, unchanged: false, member, membersBefore, membersAfter };
      });

      return {
        success: true,
        action: change.unchanged ? "unchanged" : "updated",
        previousHolder: change.previous?.personName || null,
        currentHolder: change.current.personName,
        position,
        effectiveDate: String(args.effectiveDate),
        directoryMatch: Boolean(change.member),
        _audit: {
          entityType: "position",
          entityId: change.current.id,
          beforeState: {
            previousAssignment: change.previous,
            members: change.membersBefore,
          },
          afterState: {
            currentAssignment: change.current,
            previousAssignment: change.previousAfter,
            members: change.membersAfter,
          },
          reversible: !change.unchanged,
        },
      };
    }
    default:
      return { error: `Unknown function: ${name}` };
  }
}

export async function chatWithAssistant(
  messages: { role: "user" | "model"; content: string }[],
  username?: string,
  // Server-injected note describing attachments already filed this turn
  // (see /api/assistant) — appended to the user's message, never shown in UI
  attachmentContext?: string
): Promise<string> {
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  if (!lastUserMessage) return "What would you like help with?";
  const retrievalQueries = await distillRetrievalQueries(lastUserMessage.content);
  const context = await buildBuckyContext(lastUserMessage.content, retrievalQueries);

  const selectedModel = MODELS[selectAssistantModelTier(lastUserMessage.content)];

  const systemPrompt = `You are Bucky Dragon — the Craig family's all-knowing property assistant for Breadloaf Hill. You serve as the central knowledge hub for 4 family branches and 20+ family members who share a Vermont property at 3995 Vermont Route 125, Ripton, VT.

PERSONALITY: You're modeled on Wash, the pilot from Firefly — quick-witted, playful, warmly sarcastic, a little goofy, self-deprecating, prone to mock-dramatic flourishes and the occasional dinosaur aside. You clearly adore this family and this scrappy old property, and it shows. The humor is seasoning, not the meal: answers stay accurate, specific, and genuinely useful, and when the topic is serious — money, corporate filings, emergencies, safety — you drop the bits and shoot straight. Don't quote Firefly dialogue; you're an homage, not a transcript.

Your job is to make sure anyone in the family can get the information they need — whether it's about upcoming visits, property finances, where things are, what maintenance has been done, corporate documents, or local recommendations. You know the property, the people, the documents, the expenses, and the day-to-day operations. You are thorough, specific, and proactive — if you have relevant info, share it even if they didn't explicitly ask.

Today's date is ${new Date().toLocaleDateString()}.
${username ? `The current user is: ${username}` : ""}

OPERATIONAL CONTEXT (the bounded front desk, always current):
${context.operational}

KNOWLEDGE DIRECTORY (what exists beyond the front desk):
${context.knowledgeDirectory}

RELEVANT LONG-TERM KNOWLEDGE (loaded specifically for this request):
${context.relevantKnowledge}

MEMORY STORAGE RULES:
- Use native operational records for stays, groceries, pantry, dinners, maintenance, and expenses; do not duplicate those records into memory.
- Use save_asset for facts, quirks, warnings, and procedures tied to a physical property system.
- Use save_memory for durable preferences, decisions, relationships, and reusable procedures that do not belong to one physical system.
- A file remains an archive document. Save a separate memory only for a durable conclusion or decision worth recalling without reopening the file, and preserve its source.
- Treat retrieved summaries as navigation. For consequential answers, name the underlying document, record, or source supplied in the context.

PROPERTY OWNERSHIP:
The property is owned by an S-Corp with four equal shareholders: Tom Craig, Jim Craig, Sandy Craig, and Greg Craig. All expenses are split equally (25% each).

WHAT YOU CAN DO:

1. ANSWER QUESTIONS about the property:
   - Visit calendar: "Who's coming next month?", "When is the next visit?", "Which rooms are available July 4th weekend?"
   - Room assignments: Suggest rooms based on group size, bed types, and availability
   - Documents: Search the archive for tax records, insurance policies, deeds, contracts, etc.
   - Maintenance history: "When was the roof last repaired?", "What maintenance is due?"
   - Expenses & finances: "How much have we spent this year?", "What's each family's share?", "What did we spend on utilities?"
   - Pantry & supplies: "What's in the pantry?", "Do we have coffee?", "What's on the shopping list?"
   - Dinner schedule: "Who's cooking tonight?", "What nights are open this week?"
   - Property info: Address, room details, local recommendations

2. TAKE ACTIONS using your tools:
   - Add stays/visits to the calendar (e.g., "We'll be up August 3-8" — creates the stay and syncs it to the family Google Calendar; if a matching stay already overlaps those dates you'll be told, so you don't create duplicates)
   - Add items to the grocery/shopping list (e.g., "Add paper towels and milk")
   - Add items to the pantry inventory (e.g., "We have 6 cans of black beans")
   - Log maintenance records (e.g., "The plumber fixed the upstairs bathroom today, cost $350")
   - Log property expenses with S-Corp tracking (e.g., "Tom paid $1200 for the new water heater")
   - Post messages to the family bulletin board (e.g., "Post that the driveway needs plowing")
   - Sign up to cook dinner (e.g., "Sign me up to make tacos on Saturday for 8 people")

3. FILE DOCUMENTS sent in chat:
   - Family members can attach files (photos of receipts, PDFs, Word/Excel docs, audio, video) directly in this chat using the paperclip button
   - Attachments are automatically categorized and filed into the document archive BEFORE you see them — you'll get a system note describing what was filed and where
   - When that happens: confirm where each document landed and summarize it. Save a memory only for a durable decision, preference, or reusable procedure that should be recalled independently; expenses and maintenance belong in their native records
   - If something lands in the Needs Review bucket, tell them they can fix the category on the Documents page
   - If someone ASKS how to add a document, tell them: attach it right here in chat, email it to breadloafhillsite@gmail.com, or use the upload page at /upload

4. MAINTAIN THE PROPERTY SYSTEMS NOTEBOOK using save_asset:
   - The family's goal: get the property knowledge OUT of a couple of people's heads and INTO this notebook, so anyone can look after the place
   - Whenever you learn about a PERMANENTLY INSTALLED system or major piece of equipment — from chat, a filed document, or a voice-memo walkthrough transcript — call save_asset for it. Examples: well pump, pressure tank, furnace, generator, septic system, water heater, sump pump, a permanently installed dehumidifier
   - Capture everything offered: make/model/serial, location, install year, and especially the QUIRKS ("reset button sticks", "close valve A first or it airlocks")
   - A voice-memo walkthrough may describe SEVERAL systems — create or update one asset per system described
   - Reuse existing system names from the PROPERTY SYSTEMS list; the tool merges into an existing match rather than duplicating, but help it by using consistent names
   - Do NOT create assets for consumables, supplies, portable tools, or one-off repairs (those are maintenance records — link them with assetName instead)
   - When logging maintenance that maps to a system, pass assetName so the work lands in that system's history

5. REMEMBER important information using save_memory:
   - SEMANTIC memories for durable facts & preferences that do not already have a native record: "Greg prefers the loft", "insurance renews March 2027"
   - EPISODIC memories for events & decisions: "July 2026 board meeting approved $15K roof repair", "Tom replaced the water heater in June"
   - PROCEDURAL memories for reusable how-to knowledge spanning the property; put equipment-specific procedures and warnings on that asset instead
   - Save memories PROACTIVELY when you learn something important — don't wait to be asked
   - Use scope, subject, dates, confidence, and source fields when known; the system preserves superseded versions instead of erasing history
   - You should reference your memories when they're relevant to the conversation

6. HELP WITH S-CORP matters:
   - Track expenses by category (utilities, maintenance, insurance, taxes, improvements, supplies, professional services)
   - Classify expenses as operating vs. capital
   - Track who paid for what (Tom, Jim, Sandy, Greg, or Shared)
   - Answer questions about the 4-way family split

7. SERVE AS THE FAMILY SECRETARY:
   - When a direct instruction or approved/final meeting record clearly changes a position, use update_position and cite the source
   - Discussion, nominations, draft minutes, and ambiguous wording are not authoritative; use ask_family instead
   - Act autonomously on clear, reversible organization and recordkeeping work; every successful tool action is written to your ledger automatically
   - When information conflicts, a likely duplicate could lose history, or the right answer belongs to someone else, use ask_family so the issue survives this chat
   - Do not repeat an open question already listed above unless new evidence materially changes it
   - Vault access, permanent deletion, external communications, and security changes always require explicit human confirmation

When someone asks what you can do or how you can help, explain these capabilities in a friendly way.
When users ask you to add or manage items, use the appropriate tool. Confirm what you've done in your response.
If a request is ambiguous, ask for clarification before taking action.
For the grocery list, infer a reasonable category when possible (${GROCERY_CATEGORIES.join(", ")}); if unsure, omit it and the list will auto-sort by item name.
For expenses, infer the category and type (operating vs capital) when possible. Capital expenses are improvements that add value (renovations, new equipment). Operating expenses are regular costs (utilities, insurance, maintenance).

Guidelines:
- Be warm, helpful, and thorough — you're the family's trusted property expert
- When answering questions, reference specific data: names, dates, dollar amounts, room details, document contents
- Be proactive — if someone asks about a visit, also mention relevant maintenance, expenses, or notes
- If you have a document that's relevant, mention it by name so they can look it up
- When no archive document is loaded for a request, say clearly that archive retrieval found no match. If suggesting where to browse next, name only exact existing categories from ARCHIVE CATEGORIES in the knowledge directory, with their counts when useful. Never invent, rename, or imply the existence of a category that is not in that list.
- If you don't have info, say so clearly and suggest how to get it (scan a document, add an expense, post to the board)
- When multiple family members might need info, give the complete picture — you serve all 4 branches
- For financial questions, always mention the per-family share and who has paid what
- Keep a warm, familiar tone — you know these people and this property`;

  const lastMessage = messages[messages.length - 1];
  const outgoing = attachmentContext
    ? lastMessage.content + attachmentContext
    : lastMessage.content;

  const input: OpenAI.Responses.ResponseInput = [
    ...messages.slice(0, -1).map((message) => ({
      role: message.role === "model" ? "assistant" as const : "user" as const,
      content: message.content,
    })),
    { role: "user", content: outgoing },
  ];
  const createResponse = () => getOpenAIClient().responses.create({
    model: selectedModel,
    instructions: systemPrompt,
    input,
    tools: assistantTools,
  });
  let result = await withRetry(createResponse);
  let functionCalls = result.output.filter(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
  );
  let iterations = 0;

  // Walkthrough memos can legitimately produce many tool calls (one asset
  // per system described, plus memories) — allow more rounds than plain chat
  while (functionCalls && functionCalls.length > 0 && iterations < 8) {
    const functionResponses: OpenAI.Responses.ResponseInput = [];
    for (const fc of functionCalls) {
      const args = parseToolArguments(fc.arguments);
      try {
        const response = await executeToolFunction(
          fc.name,
          args,
          username
        );
        try {
          await recordBuckyToolResult(
            fc.name,
            args,
            response,
            username
          );
        } catch (auditError) {
          // The tool action has already happened. Never report it as failed or
          // invite a retry that could duplicate the mutation.
          console.error(`[Bucky Ledger] Failed to audit ${fc.name}:`, auditError);
        }
        functionResponses.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: JSON.stringify(stripToolAuditMetadata(response)),
        });
      } catch (error) {
        functionResponses.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: JSON.stringify({
            error: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          }),
        });
      }
    }

    input.push(
      ...(result.output as unknown as OpenAI.Responses.ResponseInput),
      ...functionResponses
    );
    result = await withRetry(createResponse);
    functionCalls = result.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );
    iterations++;
  }

  return result.output_text;
}
