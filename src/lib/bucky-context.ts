import { prisma } from "@/lib/prisma";
import { hybridSearch, tokenizeSearchQuery, type SearchResult } from "@/lib/embeddings";
import {
  formatArchiveHealthForBucky,
  getArchiveHealth,
} from "@/lib/archive-health";

const KNOWLEDGE_SOURCE_TYPES = ["document", "memory", "asset", "maintenance", "expense"];
const MAX_RETRIEVED_CHARS = 18000;

export interface BuckyContext {
  operational: string;
  knowledgeDirectory: string;
  relevantKnowledge: string;
}

interface ArchiveCategoryCount {
  name: string;
  _count: { documents: number };
}

export function formatArchiveCategoryDirectory(
  categories: ArchiveCategoryCount[],
  uncategorizedCount: number
): string {
  const lines = categories.map(
    (category) => `- ${category.name} (${category._count.documents})`
  );
  if (uncategorizedCount > 0) {
    lines.push(`- Unfiled / no category (${uncategorizedCount}; filing state, not a category name)`);
  }
  return lines.length ? lines.join("\n") : "- No archive categories are configured.";
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function boundedLines<T>(
  rows: T[],
  limit: number,
  format: (row: T) => string,
  overflowLabel: string
): string {
  const visible = rows.slice(0, limit).map(format);
  if (rows.length > limit) visible.push(`- Additional ${overflowLabel} exist and were not loaded`);
  return visible.join("\n");
}

function fitContext(parts: string[], maxChars = MAX_RETRIEVED_CHARS): string {
  const accepted: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (!part) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const value = part.length <= remaining ? part : `${part.slice(0, Math.max(remaining - 30, 0))}\n[Further detail omitted]`;
    accepted.push(value);
    used += value.length;
  }
  return accepted.join("\n\n");
}

function uniqueSourceIds(results: SearchResult[], sourceType: string): string[] {
  return Array.from(new Set(results.filter((result) => result.sourceType === sourceType).map((result) => result.sourceId)));
}

function matchedChunks(results: SearchResult[], sourceType: string, sourceId: string): string[] {
  return results
    .filter((result) => result.sourceType === sourceType && result.sourceId === sourceId)
    .slice(0, 2)
    .map((result) => result.content.slice(0, 2200));
}

function resultKey(result: SearchResult): string {
  return `${result.sourceType}:${result.sourceId}:${result.chunkIndex}`;
}

export function mergeRetrievedKnowledge(
  resultSets: SearchResult[][],
  limit = 18
): SearchResult[] {
  const merged = new Map<string, { result: SearchResult; reciprocalRank: number }>();
  for (const results of resultSets) {
    results.forEach((result, rank) => {
      const key = resultKey(result);
      const existing = merged.get(key);
      merged.set(key, {
        result: existing?.result || result,
        reciprocalRank: (existing?.reciprocalRank || 0) + 1 / (60 + rank + 1),
      });
    });
  }
  return Array.from(merged.values())
    .map(({ result, reciprocalRank }) => ({ ...result, score: reciprocalRank }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function buildBuckyContext(
  query: string,
  retrievalQueries: string[] = [query]
): Promise<BuckyContext> {
  const now = new Date();
  const stayWindowEnd = new Date(now);
  stayWindowEnd.setDate(stayWindowEnd.getDate() + 120);
  const dinnerWindowEnd = new Date(now);
  dinnerWindowEnd.setDate(dinnerWindowEnd.getDate() + 14);
  const currentYear = now.getFullYear();
  const terms = tokenizeSearchQuery(query);
  const explicitYear = query.match(/\b(20\d{2}|19\d{2})\b/)?.[1];
  const wantsPantry = /\b(pantry|in stock|supplies|do we have|inventory)\b/i.test(query);
  const wantsExpenses = /\b(expense|spent|spend|cost|budget|paid|financial|dollars?|\$)\b/i.test(query);
  const wantsStays = /\b(stay|staying|visit|visiting|coming|calendar|room|available)\b/i.test(query);
  const wantsMaintenance = /\b(maintenance|repair|repaired|service|serviced|replace|replaced|fixed)\b/i.test(query);
  const wantsAssetDirectory = /\b(all|list|show|what)\b.{0,30}\b(assets?|equipment|property systems?)\b/i.test(query);
  const wantsMemoryDirectory = /\b(what|show|list)\b.{0,30}\b(remember|memories|know)\b/i.test(query);
  const wantsDocumentDirectory = /\b(all|list|show|what)\b.{0,30}\b(documents?|archive|files?)\b/i.test(query);
  const requestedStayYear = wantsStays
    ? explicitYear
      ? Number(explicitYear)
      : /\bnext year\b/i.test(query)
        ? currentYear + 1
        : null
    : null;
  const requestedExpenseYear = wantsExpenses && explicitYear ? Number(explicitYear) : null;
  const financialSummaryYear = requestedExpenseYear || currentYear;
  const stayStart = requestedStayYear ? new Date(`${requestedStayYear}-01-01T00:00:00Z`) : now;
  const stayEnd = requestedStayYear ? new Date(`${requestedStayYear + 1}-01-01T00:00:00Z`) : stayWindowEnd;
  const stayPeriodLabel = requestedStayYear ? `during ${requestedStayYear}` : "in the next 120 days";

  const [
    upcomingStays,
    rooms,
    groceryItems,
    upcomingDinners,
    currentPositions,
    openQuestions,
    expenseSummary,
    counts,
    archiveCategories,
    retrieved,
    pantryItems,
    recentExpenses,
    recentMaintenance,
    directAssets,
    directFamily,
    memoryDirectory,
    documentDirectory,
    archiveHealth,
  ] = await Promise.all([
    prisma.stay.findMany({
      where: { checkOut: { gte: stayStart }, checkIn: { lt: stayEnd } },
      include: { room: true },
      orderBy: { checkIn: "asc" },
      take: 31,
    }),
    prisma.room.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.groceryItem.findMany({ where: { checked: false }, orderBy: { createdAt: "desc" }, take: 31 }),
    prisma.dinnerSignup.findMany({
      where: { date: { gte: now, lte: dinnerWindowEnd } },
      orderBy: { date: "asc" },
    }),
    prisma.positionAssignment.findMany({ where: { endedAt: null }, orderBy: { position: "asc" } }),
    prisma.buckyQuestion.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 21 }),
    prisma.expense.aggregate({ where: { fiscalYear: financialSummaryYear }, _sum: { amount: true }, _count: true }),
    Promise.all([
      prisma.document.count({ where: { deletedAt: null, accessScope: "family" } }),
      prisma.jarvisMemory.count({
        where: {
          status: "active",
          accessScope: "family",
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
          ],
        },
      }),
      prisma.asset.count({ where: { status: "active" } }),
      prisma.maintenanceRecord.count(),
      prisma.expense.count(),
      prisma.document.count({
        where: {
          deletedAt: null,
          accessScope: "family",
          categoryId: null,
        },
      }),
    ]),
    prisma.category.findMany({
      select: {
        name: true,
        _count: {
          select: {
            documents: {
              where: { deletedAt: null, accessScope: "family" },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    Promise.all(
      (retrievalQueries.length ? retrievalQueries : [query]).map((retrievalQuery) =>
        hybridSearch(retrievalQuery, 18, KNOWLEDGE_SOURCE_TYPES)
      )
    ).then((resultSets) => mergeRetrievedKnowledge(resultSets, 18)),
    wantsPantry
      ? prisma.pantryItem.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], take: 41 })
      : Promise.resolve([]),
    wantsExpenses
      ? prisma.expense.findMany({
          where: requestedExpenseYear ? { fiscalYear: requestedExpenseYear } : undefined,
          orderBy: { date: "desc" },
          take: 16,
        })
      : Promise.resolve([]),
    wantsMaintenance
      ? prisma.maintenanceRecord.findMany({ orderBy: { performedAt: "desc" }, take: 16, include: { asset: true } })
      : Promise.resolve([]),
    terms.length
      ? prisma.asset.findMany({
          where: {
            status: "active",
            OR: terms.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { location: { contains: term, mode: "insensitive" as const } },
              { make: { contains: term, mode: "insensitive" as const } },
              { model: { contains: term, mode: "insensitive" as const } },
              { serial: { contains: term, mode: "insensitive" as const } },
              { notes: { contains: term, mode: "insensitive" as const } },
            ]),
          },
          include: { records: { orderBy: { performedAt: "desc" }, take: 3 } },
          take: 10,
        })
      : wantsAssetDirectory
        ? prisma.asset.findMany({
            where: { status: "active" },
            include: { records: { orderBy: { performedAt: "desc" }, take: 3 } },
            orderBy: [{ category: "asc" }, { name: "asc" }],
            take: 31,
          })
        : Promise.resolve([]),
    terms.length
      ? prisma.familyMember.findMany({
          where: {
            OR: terms.flatMap((term) => [
              { name: { contains: term, mode: "insensitive" as const } },
              { branch: { contains: term, mode: "insensitive" as const } },
              { relation: { contains: term, mode: "insensitive" as const } },
              { boardRole: { contains: term, mode: "insensitive" as const } },
              { notes: { contains: term, mode: "insensitive" as const } },
            ]),
          },
          include: { positions: { where: { endedAt: null } } },
          take: 8,
        })
      : Promise.resolve([]),
    wantsMemoryDirectory
      ? prisma.jarvisMemory.findMany({
          where: {
            status: "active",
            accessScope: "family",
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
            ],
          },
          orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
          take: 31,
        })
      : Promise.resolve([]),
    wantsDocumentDirectory
      ? prisma.document.findMany({
          where: { deletedAt: null, accessScope: "family" },
          include: { category: true },
          orderBy: { updatedAt: "desc" },
          take: 31,
        })
      : Promise.resolve([]),
    getArchiveHealth(),
  ]);

  const retrievedDocumentIds = uniqueSourceIds(retrieved, "document");
  const retrievedMemoryIds = uniqueSourceIds(retrieved, "memory");
  const retrievedAssetIds = uniqueSourceIds(retrieved, "asset");
  const retrievedMaintenanceIds = uniqueSourceIds(retrieved, "maintenance");
  const retrievedExpenseIds = uniqueSourceIds(retrieved, "expense");

  const [documents, memories, assets, maintenance, expenses] = await Promise.all([
    prisma.document.findMany({
      where: { id: { in: retrievedDocumentIds }, deletedAt: null, accessScope: "family" },
      include: { category: true },
    }),
    prisma.jarvisMemory.findMany({
      where: {
        id: { in: retrievedMemoryIds },
        status: "active",
        accessScope: "family",
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
    }),
    prisma.asset.findMany({
      where: { id: { in: retrievedAssetIds }, status: "active" },
      include: { records: { orderBy: { performedAt: "desc" }, take: 3 } },
    }),
    prisma.maintenanceRecord.findMany({
      where: { id: { in: retrievedMaintenanceIds } },
      include: { asset: true },
    }),
    prisma.expense.findMany({ where: { id: { in: retrievedExpenseIds } } }),
  ]);

  if (memories.length > 0) {
    await prisma.jarvisMemory.updateMany({
      where: { id: { in: memories.map((memory) => memory.id) } },
      data: { lastUsedAt: now, useCount: { increment: 1 } },
    });
  }

  const stayContext = upcomingStays.length
    ? boundedLines(upcomingStays, 30, (stay) =>
        `- ${stay.guestName}: ${dateOnly(stay.checkIn)} to ${dateOnly(stay.checkOut)}; room ${stay.room?.name || "unassigned"}; ${stay.status}${stay.notes ? `; ${stay.notes}` : ""}`,
        "stays in the 120-day window"
      )
    : `- No stays ${stayPeriodLabel}.`;
  const roomContext = rooms.map((room) =>
    `- ${room.name} (${room.type}), sleeps ${room.minCapacity}-${room.maxCapacity}${room.hasCrib ? ", crib" : ""}${room.description ? `; ${room.description}` : ""}`
  ).join("\n");
  const groceryContext = groceryItems.length
    ? boundedLines(groceryItems, 30, (item) => `- ${item.name} [${item.category}]${item.addedBy ? `; added by ${item.addedBy}` : ""}`, "unchecked items")
    : "- Shopping list is empty.";
  const dinnerContext = upcomingDinners.length
    ? upcomingDinners.map((dinner) => `- ${dateOnly(dinner.date)}: ${dinner.chef}${dinner.meal ? ` cooking ${dinner.meal}` : ""}${dinner.headCount ? ` for ${dinner.headCount}` : ""}`).join("\n")
    : "- No dinners scheduled in the next 14 days.";
  const positionContext = currentPositions.length
    ? currentPositions.map((position) => `- ${position.position}: ${position.personName} (effective ${dateOnly(position.effectiveAt)})`).join("\n")
    : "- No current positions recorded.";
  const questionContext = openQuestions.length
    ? boundedLines(openQuestions, 20, (question) => `- [${question.id}] ${question.question}${question.targetPerson ? `; for ${question.targetPerson}` : ""}`, "open questions")
    : "- No open questions.";

  const operationalParts = [
    `VISITS (${stayPeriodLabel}):\n${stayContext}`,
    `ROOMS & ACCOMMODATIONS:\n${roomContext || "- No rooms configured."}`,
    `SHOPPING LIST:\n${groceryContext}`,
    `DINNERS (next 14 days):\n${dinnerContext}`,
    `CURRENT POSITIONS:\n${positionContext}`,
    `OPEN QUESTIONS:\n${questionContext}`,
    `FINANCIAL SUMMARY (${financialSummaryYear}):\n- $${expenseSummary._sum.amount?.toFixed(2) || "0.00"} across ${expenseSummary._count} expenses`,
  ];

  if (pantryItems.length) {
    operationalParts.push(`PANTRY (loaded for this request):\n${boundedLines(pantryItems, 40, (item) =>
      `- ${item.name}: ${item.quantity}${item.unit ? ` ${item.unit}` : ""} [${item.category}]`, "pantry items")}`);
  }
  if (recentExpenses.length) {
    operationalParts.push(`EXPENSES${requestedExpenseYear ? ` FOR ${requestedExpenseYear}` : ""} (loaded for this request):\n${boundedLines(recentExpenses, 15, (expense) =>
      `- ${dateOnly(expense.date)}: $${expense.amount.toFixed(2)} ${expense.description} [${expense.category}], paid by ${expense.paidBy}`, "expenses")}`);
  }
  if (recentMaintenance.length) {
    operationalParts.push(`RECENT MAINTENANCE (loaded for this request):\n${boundedLines(recentMaintenance, 15, (record) =>
      `- ${dateOnly(record.performedAt)}: ${record.title}${record.asset ? ` on ${record.asset.name}` : ""}${record.cost != null ? ` ($${record.cost.toFixed(2)})` : ""}`, "maintenance records")}`);
  }

  const relevantParts: string[] = [];
  const allAssets = new Map([...directAssets, ...assets].map((asset) => [asset.id, asset]));
  for (const asset of Array.from(allAssets.values())) {
    const specs = [asset.make, asset.model, asset.serial ? `s/n ${asset.serial}` : null, asset.installedYear ? `installed ${asset.installedYear}` : null].filter(Boolean).join(" ");
    const records = asset.records.map((record) => `${dateOnly(record.performedAt)} ${record.title}`).join("; ");
    relevantParts.push(`[PROPERTY SYSTEM] ${asset.name} [${asset.category}]${asset.location ? `\nLocation: ${asset.location}` : ""}${specs ? `\nEquipment: ${specs}` : ""}${asset.notes ? `\nNotes: ${asset.notes}` : ""}${records ? `\nRecent work: ${records}` : ""}`);
  }
  for (const member of directFamily) {
    relevantParts.push(`[FAMILY MEMBER] ${member.name}${member.branch ? `\nBranch: ${member.branch}` : ""}${member.relation ? `\nRelationship: ${member.relation}` : ""}${member.boardRole ? `\nBoard role: ${member.boardRole}` : ""}${member.notes ? `\nNotes: ${member.notes}` : ""}`);
  }
  for (const memory of [...memoryDirectory, ...memories.filter((memory) => !memoryDirectory.some((listed) => listed.id === memory.id))]) {
    relevantParts.push(`[${memory.type.toUpperCase()} MEMORY ${memory.id}] ${memory.topic}${memory.subject ? `\nSubject: ${memory.subject}` : ""}${memory.location ? `\nLocation: ${memory.location}` : ""}\n${memory.content}${memory.source ? `\nSource: ${memory.source}` : ""}${memory.validFrom ? `\nEffective: ${dateOnly(memory.validFrom)}` : ""}`);
  }
  for (const document of [...documentDirectory, ...documents.filter((document) => !documentDirectory.some((listed) => listed.id === document.id))]) {
    const chunks = matchedChunks(retrieved, "document", document.id);
    relevantParts.push(`[ARCHIVE DOCUMENT ${document.id}] ${document.title} [${document.category?.name || "Uncategorized"}]\n${document.aiSummary || document.description || "No summary"}${chunks.length ? `\nRelevant excerpts:\n${chunks.join("\n---\n")}` : ""}`);
  }
  for (const record of maintenance) {
    relevantParts.push(`[MAINTENANCE] ${dateOnly(record.performedAt)}: ${record.title}${record.asset ? ` on ${record.asset.name}` : ""}${record.description ? `\n${record.description}` : ""}${record.cost != null ? `\nCost: $${record.cost.toFixed(2)}` : ""}`);
  }
  for (const expense of expenses) {
    relevantParts.push(`[EXPENSE] ${dateOnly(expense.date)}: $${expense.amount.toFixed(2)} ${expense.description} [${expense.category}], paid by ${expense.paidBy}${expense.vendor ? `; vendor ${expense.vendor}` : ""}`);
  }

  return {
    operational: fitContext(operationalParts, 14000),
    knowledgeDirectory: [
      `- ${counts[0]} family-access archive documents`,
      `- ${counts[1]} active long-term memories`,
      `- ${counts[2]} active property systems`,
      `- ${counts[3]} maintenance records`,
      `- ${counts[4]} expenses`,
      formatArchiveHealthForBucky(archiveHealth),
      `ARCHIVE CATEGORIES (exact names; family-access document counts):\n${formatArchiveCategoryDirectory(archiveCategories, counts[5])}`,
      "Only records relevant to this request are expanded below. A count above zero means more knowledge exists even when no detail was loaded.",
    ].join("\n"),
    relevantKnowledge: relevantParts.length
      ? fitContext(relevantParts)
      : "No long-term record was relevant enough to load for this request.",
  };
}
