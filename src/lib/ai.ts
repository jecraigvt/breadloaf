import { GoogleGenerativeAI, SchemaType, type FunctionDeclarationsTool } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { GROCERY_CATEGORIES, resolveCategory } from "@/lib/grocery-categories";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// ─── Model Routing ─────────────────────────────────────────────
// Flash Lite 3.1: quick actions (grocery, expenses, etc.) — $0.25/$1.50 per 1M tokens
// Flash 3: general chat, document processing — $0.50/$3.00 per 1M tokens
// Pro 3.1: complex analysis, deep reasoning — $2-4/$12-18 per 1M tokens
const MODELS = {
  lite: "gemini-3.1-flash-lite-preview",
  flash: "gemini-3-flash-preview",
  pro: "gemini-3.1-pro-preview",
  embedding: "gemini-embedding-2-preview",
} as const;

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

interface CategorizationResult {
  suggestedCategory: string;
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

// Process audio/video files — extract transcript, summary, key facts
export async function processMediaFile(
  base64Data: string,
  mimeType: string,
  existingCategories: string[]
): Promise<CategorizationResult> {
  const model = genAI.getGenerativeModel({ model: MODELS.flash });

  const isAudio = mimeType.startsWith("audio/");
  const mediaType = isAudio ? "audio recording" : "video";

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mimeType as string,
        data: base64Data,
      },
    },
    {
      text: `You are processing a ${mediaType} for the Craig family property archive at Breadloaf Hill, Vermont. The property is owned as an S-Corp by four Craig brothers (Tom, Jim, Sandy, Greg), with Ethan (Jim's son) now on the board.

Analyze this ${mediaType} and return ONLY valid JSON (no markdown fences):
{
  "suggestedCategory": "one of: ${existingCategories.join(", ")}",
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
  ]);

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
  imageBase64: string,
  fileType: string,
  existingCategories: string[]
): Promise<CategorizationResult> {
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
      text: `You are a document categorization assistant for the Breadloaf Hill family property archive in Vermont.

Analyze this document and return ONLY valid JSON (no markdown fences, no extra text) with these fields:
{
  "suggestedCategory": "one of: ${existingCategories.join(", ")}",
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
  ]);

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
          },
          required: ["title"],
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
    case "add_maintenance_record": {
      const record = await prisma.maintenanceRecord.create({
        data: {
          title: args.title as string,
          description: (args.description as string) || undefined,
          category: (args.category as string) || undefined,
          performedBy: (args.performedBy as string) || username || undefined,
          performedAt: new Date(),
          cost: args.cost ? parseFloat(String(args.cost)) : undefined,
        },
      });
      return {
        success: true,
        record: { id: record.id, title: record.title },
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
  username?: string
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
  const [upcomingStays, rooms, groceryItems, pantryItems, upcomingDinners, recentMaintenance, recentExpenses, expenseSummary, allMemories] =
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

  // Route to the right model based on query intent
  const intent = lastUserMessage ? classifyIntent(lastUserMessage.content) : "lookup";
  const selectedModel = intent === "action" ? MODELS.lite : intent === "analysis" ? MODELS.pro : MODELS.flash;

  const model = genAI.getGenerativeModel({
    model: selectedModel,
    systemInstruction: `You are Jarvis Craig — the Craig family's all-knowing property assistant for Breadloaf Hill. You serve as the central knowledge hub for 4 family branches and 20+ family members who share a Vermont property at 3995 Vermont Route 125, Ripton, VT.

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
   - Add items to the grocery/shopping list (e.g., "Add paper towels and milk")
   - Add items to the pantry inventory (e.g., "We have 6 cans of black beans")
   - Log maintenance records (e.g., "The plumber fixed the upstairs bathroom today, cost $350")
   - Log property expenses with S-Corp tracking (e.g., "Tom paid $1200 for the new water heater")
   - Post messages to the family bulletin board (e.g., "Post that the driveway needs plowing")
   - Sign up to cook dinner (e.g., "Sign me up to make tacos on Saturday for 8 people")

3. REMEMBER important information using save_memory:
   - SEMANTIC memories for facts & preferences: "Greg prefers the loft", "insurance renews March 2027", "the well pump is a Grundfos SQ 5-70"
   - EPISODIC memories for events & decisions: "July 2026 board meeting approved $15K roof repair", "Tom replaced the water heater in June"
   - PROCEDURAL memories for how-to knowledge: "Winterization steps: drain pipes, close main shutoff, set thermostat to 55"
   - Save memories PROACTIVELY when you learn something important — don't wait to be asked
   - If a memory on the same topic exists, update it rather than creating a duplicate
   - You should reference your memories when they're relevant to the conversation

4. HELP WITH S-CORP matters:
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

  // Send message and handle function calls in a loop
  let result = await chat.sendMessage(lastMessage.content);
  let functionCalls = result.response.functionCalls();
  let iterations = 0;

  while (functionCalls && functionCalls.length > 0 && iterations < 5) {
    const functionResponses = [];
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

    result = await chat.sendMessage(functionResponses);
    functionCalls = result.response.functionCalls();
    iterations++;
  }

  return result.response.text();
}
