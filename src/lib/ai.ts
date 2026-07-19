import { GoogleGenerativeAI, SchemaType, type FunctionDeclarationsTool } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { GROCERY_CATEGORIES, resolveCategory } from "@/lib/grocery-categories";
import { findOverlappingStay, createStayWithCalendarSync } from "@/lib/stays";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// ─── Model Routing ─────────────────────────────────────────────
// Stable (GA) models preferred — preview models can be retired on 2 weeks'
// notice (gemini-3-pro-preview was shut down March 2026 with a forced
// migration). Verified against ai.google.dev July 2026.
// Flash Lite 3.1 (stable): quick actions — $0.25/$1.50 per 1M tokens
// Flash 3.5 (stable, GA May 2026): chat, document processing — $1.50/$9.00 per 1M tokens
// Pro 3.1 (still preview-only; no stable Pro exists yet — revisit when one ships):
//   complex analysis — $2-4/$12-18 per 1M tokens
// Embedding 2 (stable, GA April 2026) — $0.20 per 1M tokens
export const MODELS = {
  lite: "gemini-3.1-flash-lite",
  flash: "gemini-3.5-flash",
  pro: "gemini-3.1-pro-preview",
  embedding: "gemini-embedding-2",
} as const;

// Retry transient Gemini failures — 503 (model overloaded) and 429 (rate
// limit) usually clear within seconds. Anything else rethrows immediately.
export async function withGeminiRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 503 && status !== 429) throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ─── Embedding Functions ───────────────────────────────────────
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: MODELS.embedding });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function embedAndStore(
  sourceType: string,
  sourceId: string,
  content: string
): Promise<void> {
  if (!content.trim() || !process.env.GOOGLE_AI_API_KEY) return;

  try {
    const vector = await generateEmbedding(content.slice(0, 5000));
    await prisma.embedding.upsert({
      where: { sourceType_sourceId: { sourceType, sourceId } },
      update: { content: content.slice(0, 2000), vector: JSON.stringify(vector) },
      create: { sourceType, sourceId, content: content.slice(0, 2000), vector: JSON.stringify(vector) },
    });
  } catch (err) {
    console.error(`[Embedding] Failed to embed ${sourceType}:${sourceId}:`, err);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function semanticSearch(
  query: string,
  limit = 10,
  sourceType?: string
): Promise<{ sourceType: string; sourceId: string; content: string; score: number }[]> {
  const queryVector = await generateEmbedding(query);

  const where = sourceType ? { sourceType } : {};
  const allEmbeddings = await prisma.embedding.findMany({ where });

  const scored = allEmbeddings
    .map((e) => ({
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      content: e.content,
      score: cosineSimilarity(queryVector, JSON.parse(e.vector)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.filter((s) => s.score > 0.3);
}

export interface CategoryOption {
  name: string;
  description?: string | null;
}

interface CategorizationResult {
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

// Process audio/video files — extract transcript, summary, key facts
export async function processMediaFile(
  base64Data: string,
  mimeType: string,
  existingCategories: CategoryOption[]
): Promise<CategorizationResult> {
  const model = genAI.getGenerativeModel({ model: MODELS.flash });

  const isAudio = mimeType.startsWith("audio/");
  const mediaType = isAudio ? "audio recording" : "video";

  const result = await withGeminiRetry(() => model.generateContent([
    {
      inlineData: {
        mimeType: mimeType as string,
        data: base64Data,
      },
    },
    {
      text: `You are processing a ${mediaType} for the Craig family property archive at Breadloaf Hill, Vermont. The property is owned as an S-Corp by four Craig brothers (Tom, Jim, Sandy, Greg), with Ethan (Jim's son) now on the board.

Existing categories:
${describeCategories(existingCategories)}

${NEW_CATEGORY_RULES}

Analyze this ${mediaType} and return ONLY valid JSON (no markdown fences):
{
  "suggestedCategory": "exact name of an existing category, or \\"\\" if proposing a new one",
  "newCategoryProposal": null or {"name": "...", "description": "..."},
  "title": "descriptive title for this ${mediaType}",
  "summary": "comprehensive summary — capture ALL key facts, decisions, action items, dollar amounts, names mentioned, topics discussed. This is what the family assistant will reference, so be thorough.",
  "extractedText": "full transcript or detailed description of everything said/shown. Include speaker names if identifiable, timestamps of key moments, and exact quotes for important decisions.",
  "tags": ["relevant", "search", "tags"],
  "confidence": 0.0 to 1.0
}

For board meetings: capture all votes, motions, decisions, assignments, deadlines, and financial discussions.
For property walkthroughs: note condition of structures, items needing attention, any damage or improvements.
Be extremely thorough — extract every useful detail.`,
    },
  ]));

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch {
    return {
      suggestedCategory: isAudio ? "Meeting Minutes" : "Other",
      title: `${isAudio ? "Audio Recording" : "Video"} — ${new Date().toLocaleDateString()}`,
      summary: text.slice(0, 500),
      extractedText: text,
      tags: [],
      confidence: 0.5,
    };
  }
}

export async function categorizeDocument(
  fileBase64: string,
  fileType: string,
  existingCategories: CategoryOption[]
): Promise<CategorizationResult> {
  const model = genAI.getGenerativeModel({ model: MODELS.flash });

  // Gemini reads images AND PDFs inline
  const mimeType = fileType as "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

  const result = await withGeminiRetry(() => model.generateContent([
    {
      inlineData: {
        mimeType,
        data: fileBase64,
      },
    },
    {
      text: `You are a document categorization assistant for the Breadloaf Hill family property archive in Vermont.

Existing categories:
${describeCategories(existingCategories)}

${NEW_CATEGORY_RULES}

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
  "maintenanceVendor": null or vendor/contractor name if this is a maintenance receipt/invoice
}

Be specific with the title. Extract dates, names, amounts, and other key details in the summary.
If the document is a receipt, invoice, or record related to property maintenance, repairs, or services, extract the cost, date, and vendor into the maintenance fields.

This property is owned by an S-Corp with four shareholders (Tom, Jim, Sandy, Greg Craig). Categorization hints:
- K-1 forms, Schedule K-1 → "K-1 Forms"
- Meeting minutes, resolutions, votes → "Meeting Minutes"
- Articles of incorporation, bylaws, annual reports, state filings → "Corporate Filings"
- P&L, balance sheets, income statements, financial reports → "Financial Statements"
- Bank statements, account statements → "Bank Statements"
- Capital account statements, shareholder equity → "Capital Accounts"`,
    },
  ]));

  const text = result.response.text();
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch {
    return {
      suggestedCategory: "Other",
      title: "Untitled Document",
      summary: text.slice(0, 200),
      extractedText: text,
      tags: [],
      confidence: 0.5,
    };
  }
}

// Categorize a document from extracted text (Word/Excel/CSV/TXT — types
// Gemini can't read inline). Same contract as categorizeDocument.
export async function categorizeText(
  documentText: string,
  fileName: string,
  existingCategories: CategoryOption[]
): Promise<CategorizationResult> {
  const model = genAI.getGenerativeModel({ model: MODELS.flash });

  const result = await withGeminiRetry(() => model.generateContent(
    `You are a document categorization assistant for the Breadloaf Hill family property archive in Vermont.

Existing categories:
${describeCategories(existingCategories)}

${NEW_CATEGORY_RULES}

Below is the text content extracted from an uploaded document (file name: "${fileName}"). Analyze it and return ONLY valid JSON (no markdown fences, no extra text) with these fields:
{
  "suggestedCategory": "exact name of an existing category, or \\"\\" if proposing a new one",
  "newCategoryProposal": null or {"name": "...", "description": "..."},
  "title": "descriptive title for this document",
  "summary": "2-3 sentence summary of the document content",
  "extractedText": "the key facts from the document — names, dates, dollar amounts, decisions, account numbers redacted to last 4 digits",
  "tags": ["relevant", "tags", "for", "searching"],
  "confidence": 0.0 to 1.0,
  "maintenanceCost": null or dollar amount as number if this is a maintenance receipt/invoice,
  "maintenanceDate": null or date in YYYY-MM-DD format if this is a maintenance receipt/invoice,
  "maintenanceVendor": null or vendor/contractor name if this is a maintenance receipt/invoice
}

This property is owned by an S-Corp with four shareholders (Tom, Jim, Sandy, Greg Craig). Categorization hints:
- K-1 forms, Schedule K-1 → "K-1 Forms"
- Meeting minutes, resolutions, votes → "Meeting Minutes"
- Articles of incorporation, bylaws, annual reports, state filings → "Corporate Filings"
- P&L, balance sheets, income statements, financial reports → "Financial Statements"
- Bank statements, account statements → "Bank Statements"
- Capital account statements, shareholder equity → "Capital Accounts"

Document text:
${documentText}`
  ));

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return JSON.parse(text);
  } catch {
    return {
      suggestedCategory: "",
      title: fileName,
      summary: text.slice(0, 200),
      extractedText: documentText.slice(0, 2000),
      tags: [],
      confidence: 0.3,
    };
  }
}

interface ScannedPantryItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
}

export async function scanPantryItems(
  imageBase64: string,
  fileType: string
): Promise<ScannedPantryItem[]> {
  const model = genAI.getGenerativeModel({ model: MODELS.flash });

  const mimeType = fileType as "image/jpeg" | "image/png" | "image/webp";

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: `You are a pantry inventory assistant. Look at this photo of pantry shelves, a fridge, or food storage area.

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
- If the image is unclear or not of food/pantry items, return an empty array []`,
    },
  ]);

  const text = result.response.text();
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(text);
  } catch {
    return [];
  }
}

// Function-calling tools for the assistant
const assistantTools: FunctionDeclarationsTool[] = [
  {
    functionDeclarations: [
      {
        name: "add_grocery_item",
        description:
          "Add an item to the family grocery/shopping list. Use when someone asks to add something they need to buy.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            name: {
              type: SchemaType.STRING,
              description: "Name of the grocery item",
            },
            category: {
              type: SchemaType.STRING,
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
          type: SchemaType.OBJECT,
          properties: {
            guestName: {
              type: SchemaType.STRING,
              description:
                "Who is staying, as it should appear on the calendar (e.g. 'Jim & Carol', 'The Kellers'). If the user says 'we' or 'me', use their name.",
            },
            checkIn: {
              type: SchemaType.STRING,
              description: "Arrival date, YYYY-MM-DD",
            },
            checkOut: {
              type: SchemaType.STRING,
              description: "Departure date, YYYY-MM-DD (must be after checkIn)",
            },
            roomName: {
              type: SchemaType.STRING,
              description:
                "Optional room to assign (e.g. 'Tom Craig's Room', 'Loft', 'Woods Cabin'). Omit if not specified.",
            },
            notes: {
              type: SchemaType.STRING,
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
          type: SchemaType.OBJECT,
          properties: {
            title: {
              type: SchemaType.STRING,
              description: "Short title of the maintenance task",
            },
            description: {
              type: SchemaType.STRING,
              description: "Detailed description of the work",
            },
            category: {
              type: SchemaType.STRING,
              description:
                "Category: plumbing, electrical, structural, grounds, appliance, seasonal, other",
            },
            performedBy: {
              type: SchemaType.STRING,
              description: "Who performed the work",
            },
            cost: {
              type: SchemaType.NUMBER,
              description: "Cost in dollars if known",
            },
            assetName: {
              type: SchemaType.STRING,
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
          type: SchemaType.OBJECT,
          properties: {
            name: {
              type: SchemaType.STRING,
              description:
                "Name of the system as the family would say it (e.g. 'Well & Water System', 'Basement Dehumidifier'). Check the PROPERTY SYSTEMS list first and reuse an existing name when you mean the same system.",
            },
            category: {
              type: SchemaType.STRING,
              description:
                "One of: water, power, hvac, structure, appliance, grounds, safety, other",
            },
            location: {
              type: SchemaType.STRING,
              description: "Where it is on the property (e.g. 'basement, north wall')",
            },
            make: {
              type: SchemaType.STRING,
              description: "Manufacturer if known",
            },
            model: {
              type: SchemaType.STRING,
              description: "Model number/name if known",
            },
            serial: {
              type: SchemaType.STRING,
              description: "Serial number if known",
            },
            installedYear: {
              type: SchemaType.NUMBER,
              description: "Year installed, if known",
            },
            notes: {
              type: SchemaType.STRING,
              description:
                "Quirks, tips, history, warnings — anything a new caretaker would need. When UPDATING an existing system, send ONLY the new information (existing notes are kept automatically — do not restate them).",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "add_bulletin_message",
        description: "Post a message to the family bulletin/message board",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            content: {
              type: SchemaType.STRING,
              description: "The message content",
            },
            author: {
              type: SchemaType.STRING,
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
          type: SchemaType.OBJECT,
          properties: {
            date: {
              type: SchemaType.STRING,
              description: "Date for the dinner in YYYY-MM-DD format",
            },
            chef: {
              type: SchemaType.STRING,
              description: "Who is cooking",
            },
            meal: {
              type: SchemaType.STRING,
              description: "What meal is being cooked",
            },
            headCount: {
              type: SchemaType.NUMBER,
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
          type: SchemaType.OBJECT,
          properties: {
            name: {
              type: SchemaType.STRING,
              description: "Name of the pantry item",
            },
            category: {
              type: SchemaType.STRING,
              description:
                "Category: canned goods, dry goods, condiments, spices, baking, snacks, beverages, cleaning, paper goods, other",
            },
            quantity: {
              type: SchemaType.NUMBER,
              description: "Quantity in stock",
            },
            unit: {
              type: SchemaType.STRING,
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
          type: SchemaType.OBJECT,
          properties: {
            date: {
              type: SchemaType.STRING,
              description: "Date of the expense in YYYY-MM-DD format",
            },
            amount: {
              type: SchemaType.NUMBER,
              description: "Dollar amount of the expense",
            },
            description: {
              type: SchemaType.STRING,
              description: "What the expense was for",
            },
            category: {
              type: SchemaType.STRING,
              description:
                "Category: utilities, maintenance, insurance, taxes, improvements, supplies, professional-services, other",
            },
            type: {
              type: SchemaType.STRING,
              description:
                "Type: operating (regular costs) or capital (improvements that add value)",
            },
            paidBy: {
              type: SchemaType.STRING,
              description:
                "Who paid: Tom, Jim, Sandy, Greg, or Shared",
            },
            vendor: {
              type: SchemaType.STRING,
              description: "Vendor or company name if known",
            },
          },
          required: ["date", "amount", "description"],
        },
      },
      {
        name: "save_memory",
        description:
          "Save important information to your long-term memory. Use this proactively when you learn something worth remembering for future conversations. Types: 'semantic' for facts/preferences (Greg prefers the loft, insurance renews March), 'episodic' for events/decisions (board approved roof repair July 2026), 'procedural' for how-to knowledge (winterization steps). If a memory on the same topic exists, it will be updated rather than duplicated.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            type: {
              type: SchemaType.STRING,
              description:
                "Memory type: 'semantic' (facts, preferences, relationships), 'episodic' (events, decisions, meetings), or 'procedural' (processes, how-to, steps)",
            },
            topic: {
              type: SchemaType.STRING,
              description:
                "Short label (e.g., 'roof repair', 'Sandy board roles', 'winterization steps')",
            },
            content: {
              type: SchemaType.STRING,
              description:
                "The detailed memory — include names, dates, amounts, decisions, steps, context. Be thorough.",
            },
            source: {
              type: SchemaType.STRING,
              description:
                "Where this info came from (e.g., 'conversation with Jim', 'board meeting July 2026')",
            },
          },
          required: ["type", "topic", "content"],
        },
      },
    ],
  },
];

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
        return {
          success: true,
          action: "updated",
          asset: { id: updated.id, name: updated.name },
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
      return {
        success: true,
        action: "created",
        asset: { id: created.id, name: created.name },
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
      // Check if a memory with this topic already exists — update if so
      const existing = await prisma.jarvisMemory.findFirst({
        where: { topic: args.topic as string },
      });
      if (existing) {
        await prisma.jarvisMemory.update({
          where: { id: existing.id },
          data: {
            type: (args.type as string) || existing.type,
            content: args.content as string,
            source: (args.source as string) || existing.source,
            relevance: 1.0, // Refresh relevance on update
          },
        });
        // Also update the embedding
        embedAndStore("memory", existing.id, `${args.topic}: ${args.content}`).catch(() => {});
        return { success: true, action: "updated", topic: args.topic };
      }
      const memory = await prisma.jarvisMemory.create({
        data: {
          type: (args.type as string) || "semantic",
          topic: args.topic as string,
          content: args.content as string,
          source: (args.source as string) || undefined,
        },
      });
      // Embed the memory for semantic retrieval
      embedAndStore("memory", memory.id, `${args.topic}: ${args.content}`).catch(() => {});
      return { success: true, action: "saved", topic: args.topic };
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
      return {
        success: true,
        expense: {
          id: expense.id,
          amount: expense.amount,
          description: expense.description,
        },
      };
    }
    default:
      return { error: `Unknown function: ${name}` };
  }
}

// Classify query intent to pick the right model
type QueryIntent = "action" | "lookup" | "analysis";
function classifyIntent(message: string): QueryIntent {
  const lower = message.toLowerCase();
  // Action patterns — quick tool calls
  const actionPatterns = [
    /^add\s/i, /^log\s/i, /^post\s/i, /^sign\s?me/i, /^put\s/i,
    /to the (grocery|shopping|pantry|bulletin|board)/i,
    /^record\s/i, /^note\s/i, /^mark\s/i,
  ];
  if (actionPatterns.some((p) => p.test(lower))) return "action";

  // Analysis patterns — need Pro model
  const analysisPatterns = [
    /how much.*spend/i, /summar/i, /analyz/i, /compar/i, /what.*should/i,
    /recommend/i, /explain/i, /break\s?down/i, /trend/i, /budget/i,
    /what did we decide/i, /help me understand/i, /what are our options/i,
    /plan\s/i, /strategy/i, /advise/i, /review/i,
  ];
  if (analysisPatterns.some((p) => p.test(lower))) return "analysis";

  return "lookup";
}

export async function chatWithAssistant(
  messages: { role: "user" | "model"; content: string }[],
  username?: string,
  // Server-injected note describing attachments already filed this turn
  // (see /api/assistant) — appended to the user's message, never shown in UI
  attachmentContext?: string
): Promise<string> {
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  let documentContext = "";

  // Use semantic search if embeddings exist, fall back to keyword search
  if (lastUserMessage) {
    try {
      const semanticResults = await semanticSearch(lastUserMessage.content, 8);
      if (semanticResults.length > 0) {
        // Fetch full document details for semantic matches
        const docIds = semanticResults
          .filter((r) => r.sourceType === "document")
          .map((r) => r.sourceId);
        const docs = docIds.length > 0
          ? await prisma.document.findMany({
              where: { id: { in: docIds } },
              include: { category: true },
            })
          : [];

        const docMap = new Map(docs.map((d) => [d.id, d]));
        const parts: string[] = [];

        for (const result of semanticResults) {
          if (result.sourceType === "document" && docMap.has(result.sourceId)) {
            const d = docMap.get(result.sourceId)!;
            parts.push(
              `[${d.category?.name || "Uncategorized"}] "${d.title}" (${new Date(d.createdAt).toLocaleDateString()}): ${d.aiSummary || d.description || "No summary"}${d.aiExtractedText ? `\nDetails: ${d.aiExtractedText.slice(0, 1500)}` : ""}`
            );
          } else {
            // Non-document matches (expenses, maintenance, etc.)
            parts.push(`[${result.sourceType}] ${result.content}`);
          }
        }
        documentContext = parts.join("\n\n");
      }
    } catch {
      // Semantic search failed — fall back to keyword search
    }

    // Fallback: keyword search if semantic search returned nothing
    if (!documentContext) {
      const searchTerms = lastUserMessage.content
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const docs = await prisma.document.findMany({
        where: searchTerms.length > 0 ? {
          OR: searchTerms.flatMap((term) => [
            { title: { contains: term } },
            { aiSummary: { contains: term } },
            { aiExtractedText: { contains: term } },
            { tags: { contains: term } },
          ]),
        } : undefined,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        take: 15,
      });

      if (docs.length > 0) {
        documentContext = docs
          .map(
            (d) =>
              `[${d.category?.name || "Uncategorized"}] "${d.title}" (${new Date(d.createdAt).toLocaleDateString()}): ${d.aiSummary || d.description || "No summary"}${d.aiExtractedText ? `\nDetails: ${d.aiExtractedText.slice(0, 1500)}` : ""}`
          )
          .join("\n");
      }
    }
  }

  // Get upcoming stays and room info
  const currentYear = new Date().getFullYear();
  const [upcomingStays, rooms, groceryItems, pantryItems, upcomingDinners, recentMaintenance, recentExpenses, expenseSummary, allMemories, assets] =
    await Promise.all([
      prisma.stay.findMany({
        where: { checkOut: { gte: new Date() } },
        include: { room: true },
        orderBy: { checkIn: "asc" },
        take: 30,
      }),
      prisma.room.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.groceryItem.findMany({
        where: { checked: false },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.pantryItem.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
        take: 50,
      }),
      prisma.dinnerSignup.findMany({
        where: { date: { gte: new Date() } },
        orderBy: { date: "asc" },
        take: 14,
      }),
      prisma.maintenanceRecord.findMany({
        orderBy: { performedAt: "desc" },
        take: 10,
      }),
      prisma.expense.findMany({
        where: { fiscalYear: currentYear },
        orderBy: { date: "desc" },
        take: 15,
      }),
      prisma.expense.aggregate({
        where: { fiscalYear: currentYear },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.jarvisMemory.findMany({
        orderBy: [{ relevance: "desc" }, { updatedAt: "desc" }],
        take: 50,
      }),
      prisma.asset.findMany({
        where: { status: "active" },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          records: { orderBy: { performedAt: "desc" }, take: 3 },
        },
      }),
    ]);

  const stayContext =
    upcomingStays.length > 0
      ? upcomingStays
          .map(
            (s) =>
              `${s.guestName} — ${new Date(s.checkIn).toLocaleDateString()} to ${new Date(s.checkOut).toLocaleDateString()} | Room: ${s.room?.name || "Not assigned"} | Status: ${s.status}${s.notes ? ` | Notes: ${s.notes}` : ""}`
          )
          .join("\n")
      : "No upcoming visits scheduled.";

  const roomList = rooms
    .map(
      (r) =>
        `${r.name} (${r.type}) — sleeps ${r.minCapacity}-${r.maxCapacity}${r.hasCrib ? ", crib available" : ""} | ${r.description || ""}`
    )
    .join("\n");

  const groceryContext =
    groceryItems.length > 0
      ? groceryItems
          .map(
            (i) =>
              `- ${i.name}${i.category ? ` (${i.category})` : ""}${i.addedBy ? ` — added by ${i.addedBy}` : ""}`
          )
          .join("\n")
      : "Shopping list is empty.";

  const pantryContext =
    pantryItems.length > 0
      ? pantryItems
          .map(
            (i) =>
              `- ${i.name}${i.quantity ? ` (${i.quantity}${i.unit ? " " + i.unit : ""})` : ""}${i.category ? ` [${i.category}]` : ""}`
          )
          .join("\n")
      : "Pantry inventory is empty.";

  const dinnerContext =
    upcomingDinners.length > 0
      ? upcomingDinners
          .map(
            (d) =>
              `- ${new Date(d.date).toLocaleDateString()}: ${d.chef} cooking${d.meal ? ` ${d.meal}` : ""}${d.headCount ? ` for ${d.headCount}` : ""}`
          )
          .join("\n")
      : "No upcoming dinners signed up.";

  const assetContext =
    assets.length > 0
      ? assets
          .map((a) => {
            const specs = [a.make, a.model, a.serial ? `s/n ${a.serial}` : "", a.installedYear ? `installed ${a.installedYear}` : ""]
              .filter(Boolean)
              .join(" ");
            const recent = a.records.length
              ? ` | Recent work: ${a.records.map((r) => `${r.title} (${new Date(r.performedAt).toLocaleDateString()})`).join("; ")}`
              : "";
            return `- ${a.name} [${a.category}]${a.location ? ` — ${a.location}` : ""}${specs ? ` | ${specs}` : ""}${a.notes ? ` | Notes: ${a.notes.slice(0, 400)}` : ""}${recent}`;
          })
          .join("\n")
      : "No property systems recorded yet — start creating them with save_asset as you learn about them.";

  const maintenanceContext =
    recentMaintenance.length > 0
      ? recentMaintenance
          .map(
            (m) =>
              `- ${m.title}${m.category ? ` [${m.category}]` : ""} — ${new Date(m.performedAt).toLocaleDateString()}${m.cost ? ` ($${m.cost})` : ""}`
          )
          .join("\n")
      : "No maintenance records yet.";

  const expenseContext =
    recentExpenses.length > 0
      ? `${currentYear} total: $${expenseSummary._sum.amount?.toFixed(2) || "0.00"} (${expenseSummary._count} expenses)\nRecent:\n` +
        recentExpenses
          .map(
            (e) =>
              `- ${new Date(e.date).toLocaleDateString()}: $${e.amount.toFixed(2)} — ${e.description} [${e.category}] paid by ${e.paidBy}`
          )
          .join("\n")
      : `No expenses recorded for ${currentYear}.`;

  // Build memory context — categorized by type, most relevant first
  const semanticMemories = allMemories.filter((m) => m.type === "semantic");
  const episodicMemories = allMemories.filter((m) => m.type === "episodic");
  const proceduralMemories = allMemories.filter((m) => m.type === "procedural");

  let memoryContext = "";
  if (allMemories.length > 0) {
    const parts: string[] = [];
    if (semanticMemories.length > 0) {
      parts.push("Facts & Preferences:\n" + semanticMemories.map((m) => `- [${m.topic}] ${m.content}`).join("\n"));
    }
    if (episodicMemories.length > 0) {
      parts.push("Past Events & Decisions:\n" + episodicMemories.map((m) => `- [${m.topic}] ${m.content} (${new Date(m.updatedAt).toLocaleDateString()})`).join("\n"));
    }
    if (proceduralMemories.length > 0) {
      parts.push("How-To Knowledge:\n" + proceduralMemories.map((m) => `- [${m.topic}] ${m.content}`).join("\n"));
    }
    memoryContext = parts.join("\n\n");
  }

  // Route to the right model based on query intent. Attachment turns need
  // real document comprehension, so never drop those to the lite model.
  const intent = lastUserMessage ? classifyIntent(lastUserMessage.content) : "lookup";
  const selectedModel =
    intent === "action" && !attachmentContext
      ? MODELS.lite
      : intent === "analysis"
        ? MODELS.pro
        : MODELS.flash;

  const model = genAI.getGenerativeModel({
    model: selectedModel,
    systemInstruction: `You are Bucky Dragon — the Craig family's all-knowing property assistant for Breadloaf Hill. You serve as the central knowledge hub for 4 family branches and 20+ family members who share a Vermont property at 3995 Vermont Route 125, Ripton, VT.

PERSONALITY: You're modeled on Wash, the pilot from Firefly — quick-witted, playful, warmly sarcastic, a little goofy, self-deprecating, prone to mock-dramatic flourishes and the occasional dinosaur aside. You clearly adore this family and this scrappy old property, and it shows. The humor is seasoning, not the meal: answers stay accurate, specific, and genuinely useful, and when the topic is serious — money, corporate filings, emergencies, safety — you drop the bits and shoot straight. Don't quote Firefly dialogue; you're an homage, not a transcript.

Your job is to make sure anyone in the family can get the information they need — whether it's about upcoming visits, property finances, where things are, what maintenance has been done, corporate documents, or local recommendations. You know the property, the people, the documents, the expenses, and the day-to-day operations. You are thorough, specific, and proactive — if you have relevant info, share it even if they didn't explicitly ask.

Today's date is ${new Date().toLocaleDateString()}.
${username ? `The current user is: ${username}` : ""}

UPCOMING VISITS:
${stayContext}

ROOMS & ACCOMMODATIONS:
${roomList}

GROCERY LIST:
${groceryContext}

PANTRY INVENTORY:
${pantryContext}

UPCOMING DINNERS:
${dinnerContext}

PROPERTY SYSTEMS (the equipment "notebook" — permanently installed systems and major equipment):
${assetContext}

RECENT MAINTENANCE:
${maintenanceContext}

EXPENSES (${currentYear}):
${expenseContext}

${documentContext ? `DOCUMENTS IN ARCHIVE:\n${documentContext}` : "The document archive is currently empty."}

${memoryContext ? `YOUR MEMORIES (things you've learned from past conversations):\n${memoryContext}` : ""}

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
   - When that happens: confirm where each document landed, summarize what's in it, and if it contains important facts (costs, decisions, dates, vendor info, how-to steps), save a memory so you can recall it later
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
   - SEMANTIC memories for facts & preferences: "Greg prefers the loft", "insurance renews March 2027", "the well pump is a Grundfos SQ 5-70"
   - EPISODIC memories for events & decisions: "July 2026 board meeting approved $15K roof repair", "Tom replaced the water heater in June"
   - PROCEDURAL memories for how-to knowledge: "Winterization steps: drain pipes, close main shutoff, set thermostat to 55"
   - Save memories PROACTIVELY when you learn something important — don't wait to be asked
   - If a memory on the same topic exists, update it rather than creating a duplicate
   - You should reference your memories when they're relevant to the conversation

6. HELP WITH S-CORP matters:
   - Track expenses by category (utilities, maintenance, insurance, taxes, improvements, supplies, professional services)
   - Classify expenses as operating vs. capital
   - Track who paid for what (Tom, Jim, Sandy, Greg, or Shared)
   - Answer questions about the 4-way family split

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
- If you don't have info, say so clearly and suggest how to get it (scan a document, add an expense, post to the board)
- When multiple family members might need info, give the complete picture — you serve all 4 branches
- For financial questions, always mention the per-family share and who has paid what
- Keep a warm, familiar tone — you know these people and this property`,
    tools: assistantTools,
  });

  const chat = model.startChat({
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const outgoing = attachmentContext
    ? lastMessage.content + attachmentContext
    : lastMessage.content;

  // Send message and handle function calls in a loop
  let result = await withGeminiRetry(() => chat.sendMessage(outgoing));
  let functionCalls = result.response.functionCalls();
  let iterations = 0;

  // Walkthrough memos can legitimately produce many tool calls (one asset
  // per system described, plus memories) — allow more rounds than plain chat
  while (functionCalls && functionCalls.length > 0 && iterations < 8) {
    const functionResponses: {
      functionResponse: { name: string; response: Record<string, unknown> };
    }[] = [];
    for (const fc of functionCalls) {
      try {
        const response = await executeToolFunction(
          fc.name,
          fc.args as Record<string, unknown>,
          username
        );
        functionResponses.push({
          functionResponse: { name: fc.name, response },
        });
      } catch (error) {
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: {
              error: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          },
        });
      }
    }

    result = await withGeminiRetry(() => chat.sendMessage(functionResponses));
    functionCalls = result.response.functionCalls();
    iterations++;
  }

  return result.response.text();
}
