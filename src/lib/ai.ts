import { GoogleGenerativeAI, SchemaType, type FunctionDeclarationsTool } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

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

export async function categorizeDocument(
  imageBase64: string,
  fileType: string,
  existingCategories: string[]
): Promise<CategorizationResult> {
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

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
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

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
              description:
                "Category: produce, dairy, meat, bakery, pantry, frozen, beverages, household, other",
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
          category: (args.category as string) || undefined,
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

export async function chatWithAssistant(
  messages: { role: "user" | "model"; content: string }[],
  username?: string
): Promise<string> {
  // Find relevant documents based on the latest user message
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  let documentContext = "";

  if (lastUserMessage) {
    // Search for relevant docs
    const searchTerms = lastUserMessage.content
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const docs = await prisma.document.findMany({
      where: {
        OR: searchTerms.flatMap((term) => [
          { title: { contains: term } },
          { aiSummary: { contains: term } },
          { aiExtractedText: { contains: term } },
          { tags: { contains: term } },
        ]),
      },
      include: { category: true },
      take: 10,
    });

    // Also get recent documents for general context
    const recentDocs = await prisma.document.findMany({
      include: { category: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const relevantDocs = docs.length > 0 ? docs : recentDocs;

    if (relevantDocs.length > 0) {
      documentContext = relevantDocs
        .map(
          (d) =>
            `[${d.category?.name || "Uncategorized"}] "${d.title}" (${new Date(d.createdAt).toLocaleDateString()}): ${d.aiSummary || d.description || "No summary"} | Extracted: ${d.aiExtractedText?.slice(0, 300) || "N/A"}`
        )
        .join("\n");
    }
  }

  // Get upcoming stays and room info
  const currentYear = new Date().getFullYear();
  const [upcomingStays, rooms, groceryItems, pantryItems, upcomingDinners, recentMaintenance, recentExpenses, expenseSummary] =
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

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: `You are the Breadloaf Hill property assistant — a knowledgeable, friendly AI that helps the Craig family manage their Vermont property at 3995 Vermont Route 125, Ripton, VT.

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

PROPERTY OWNERSHIP:
The property is owned by an S-Corp with four equal shareholders: Tom Craig, Jim Craig, Sandy Craig, and Greg Craig. All expenses are split equally (25% each).

CAPABILITIES:
You can perform actions for the family using your tools:
- Add items to the grocery/shopping list
- Log maintenance records
- Post messages to the bulletin board
- Sign up to cook dinner on a date
- Add items to the pantry inventory
- Log property expenses (with category, who paid, operating vs capital)

When users ask you to add or manage items, use the appropriate tool. Confirm what you've done in your response.
If a request is ambiguous, ask for clarification before taking action.
For the grocery list, infer a reasonable category when possible (produce, dairy, meat, bakery, pantry, frozen, beverages, household, other).
For expenses, infer the category and type (operating vs capital) when possible. Capital expenses are improvements that add value (renovations, new equipment). Operating expenses are regular costs (utilities, insurance, maintenance).

Guidelines:
- Be warm and helpful, like a trusted family advisor
- Reference specific visits, rooms, and documents when answering questions
- Help with questions like "who's coming next month?", "which rooms are available for the 4th of July?"
- Help with property management, maintenance schedules, tax info, etc.
- You can suggest room assignments based on group size and availability
- If you don't have relevant info, say so and suggest what might help
- Keep responses concise but friendly`,
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
