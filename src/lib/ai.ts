import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

interface CategorizationResult {
  suggestedCategory: string;
  title: string;
  summary: string;
  extractedText: string;
  tags: string[];
  confidence: number;
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
  "confidence": 0.0 to 1.0
}

Be specific with the title. Extract dates, names, amounts, and other key details in the summary.`,
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

export async function chatWithAssistant(
  messages: { role: "user" | "model"; content: string }[]
) {
  // Find relevant documents based on the latest user message
  const lastUserMessage = messages.filter((m) => m.role === "user").pop();
  let documentContext = "";

  if (lastUserMessage) {
    // Search for relevant docs
    const searchTerms = lastUserMessage.content.split(/\s+/).filter((w) => w.length > 3);
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
  const upcomingStays = await prisma.stay.findMany({
    where: { checkOut: { gte: new Date() } },
    include: { room: true },
    orderBy: { checkIn: "asc" },
    take: 30,
  });

  const rooms = await prisma.room.findMany({
    orderBy: { sortOrder: "asc" },
  });

  const stayContext = upcomingStays.length > 0
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

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: `You are the Breadloaf Hill property assistant — a knowledgeable, friendly AI that helps the Craig family manage their Vermont property. You have access to the family's document archive, the visit calendar, and room information.

Today's date is ${new Date().toLocaleDateString()}.

UPCOMING VISITS:
${stayContext}

ROOMS & ACCOMMODATIONS:
${roomList}

${documentContext ? `DOCUMENTS IN ARCHIVE:\n${documentContext}` : "The document archive is currently empty. Encourage the family to start scanning and uploading documents!"}

Guidelines:
- Be warm and helpful, like a trusted family advisor
- Reference specific visits, rooms, and documents when answering questions
- Help with questions like "who's coming next month?", "which rooms are available for the 4th of July?", "when is the next visit?"
- Help with property management questions, maintenance schedules, tax info, etc.
- You can suggest room assignments based on group size and availability
- If you don't have relevant info, say so and suggest what might help`,
  });

  const chat = model.startChat({
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessageStream(lastMessage.content);

  return result;
}
