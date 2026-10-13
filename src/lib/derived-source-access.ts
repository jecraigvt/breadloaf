import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface DerivedSourceRow {
  sourceType?: string | null; sourceId?: string | null; filePath?: string | null;
  accessScope?: string; sourceRecordings?: unknown; connections?: unknown; proposedAction?: unknown;
}
function linkedReferences(row: DerivedSourceRow): DerivedSourceRow[] {
  const references: DerivedSourceRow[] = recordingReferences(row.sourceRecordings).map(reference => ({
    ...(reference.documentId ? { sourceType: "document", sourceId: reference.documentId } : {}), ...(reference.filePath ? { filePath: reference.filePath } : {}),
  }));
  if (Array.isArray(row.connections)) for (const connection of row.connections) {
    if (connection && typeof connection === "object" && typeof connection.sourceKey === "string") {
      const match = /^(document|memory|maintenance):(.+)$/.exec(connection.sourceKey);
      if (match) references.push({ sourceType: match[1], sourceId: match[2] });
    }
  }
  const action = row.proposedAction && typeof row.proposedAction === "object" && !Array.isArray(row.proposedAction) ? row.proposedAction as Record<string, unknown> : null;
  if (Array.isArray(action?.sourceMemoryIds)) for (const id of action.sourceMemoryIds) if (typeof id === "string") references.push({ sourceType: "memory", sourceId: id });
  return references;
}
type DerivedDb = Pick<Prisma.TransactionClient, "document" | "buckyQuestion" | "jarvisMemory" | "maintenanceRecord">;
function recordingReferences(value: unknown): Array<{ documentId?: string; filePath?: string }> {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return entries.filter(entry => entry && typeof entry === "object").map(entry => ({
    ...(typeof entry.documentId === "string" ? { documentId: entry.documentId } : {}),
    ...(typeof entry.filePath === "string" ? { filePath: entry.filePath } : {}),
  }));
}

/** Current source authority follows copied questions, answers, and recordings.
 * A shared row or stale embedding cannot make its now-private source public. */
export async function filterScopedDerivedRows<T extends DerivedSourceRow>(rows: T[], scopes: string[] = ["family"], db: DerivedDb = prisma): Promise<T[]> {
  const questions = new Map<string, DerivedSourceRow>(), memories = new Map<string, DerivedSourceRow>(), maintenance = new Map<string, DerivedSourceRow>();
  let sources: DerivedSourceRow[] = [...rows, ...rows.flatMap(linkedReferences)];
  for (let depth = 0; depth < 4; depth++) {
    const ids = (type: string, existing: Map<string, DerivedSourceRow>) => Array.from(new Set(sources.filter(row => row.sourceType === type && row.sourceId && !existing.has(row.sourceId)).map(row => row.sourceId!)));
    const questionIds = ids("question", questions), memoryIds = ids("memory", memories), maintenanceIds = ids("maintenance", maintenance);
    if (!questionIds.length && !memoryIds.length && !maintenanceIds.length) break;
    const [foundQuestions, foundMemories, foundMaintenance] = await Promise.all([
      questionIds.length ? db.buckyQuestion.findMany({ where: { id: { in: questionIds } }, select: { id: true, sourceType: true, sourceId: true, proposedAction: true } }) : [],
      memoryIds.length ? db.jarvisMemory.findMany({ where: { id: { in: memoryIds } }, select: { id: true, sourceType: true, sourceId: true, filePath: true, accessScope: true } }) : [],
      maintenanceIds.length ? db.maintenanceRecord.findMany({ where: { id: { in: maintenanceIds } }, select: { id: true, sourceRecordings: true } }) : [],
    ]);
    for (const row of foundQuestions) questions.set(row.id, row);
    for (const row of foundMemories) memories.set(row.id, row);
    for (const row of foundMaintenance) maintenance.set(row.id, row);
    const found = [...foundQuestions, ...foundMemories, ...foundMaintenance];
    sources = [...sources, ...found, ...found.flatMap(linkedReferences)];
  }
  const documentIds = new Set<string>(), filePaths = new Set<string>();
  for (const row of sources) {
    if (row.sourceType === "document" && row.sourceId) documentIds.add(row.sourceId);
    if (row.filePath) filePaths.add(row.filePath);
    for (const reference of recordingReferences(row.sourceRecordings)) {
      if (reference.documentId) documentIds.add(reference.documentId);
      if (reference.filePath) filePaths.add(reference.filePath);
    }
  }
  const documents = documentIds.size || filePaths.size ? await db.document.findMany({ where: { OR: [
    { id: { in: Array.from(documentIds) } }, { filePath: { in: Array.from(filePaths) } },
  ] }, select: { id: true, filePath: true, accessScope: true, deletedAt: true } }) : [];
  const scopedMemories = filePaths.size ? await db.jarvisMemory.findMany({ where: { filePath: { in: Array.from(filePaths) } }, select: { filePath: true, accessScope: true } }) : [];
  const docById = new Map(documents.map(doc => [doc.id, doc]));
  const pathAllowed = (filePath: string) => documents.filter(doc => doc.filePath === filePath).every(doc => scopes.includes(doc.accessScope) && !doc.deletedAt) && scopedMemories.filter(memory => memory.filePath === filePath).every(memory => scopes.includes(memory.accessScope));
  const allowed = (row: DerivedSourceRow, ancestors: Set<DerivedSourceRow>): boolean => {
    if (ancestors.has(row) || row.accessScope && !scopes.includes(row.accessScope)) return false;
    const seen = new Set(ancestors); seen.add(row);
    if (row.filePath && !pathAllowed(row.filePath)) return false;
    if (!linkedReferences(row).every(reference => allowed(reference, seen))) return false;
    for (const reference of recordingReferences(row.sourceRecordings)) {
      if (reference.documentId) { const doc = docById.get(reference.documentId); if (!doc || !scopes.includes(doc.accessScope) || doc.deletedAt) return false; }
      if (reference.filePath && !pathAllowed(reference.filePath)) return false;
    }
    if (!row.sourceId) return true;
    if (row.sourceType === "document") { const doc = docById.get(row.sourceId); return Boolean(doc && !doc.deletedAt && scopes.includes(doc.accessScope)); }
    const parent = row.sourceType === "question" ? questions.get(row.sourceId) : row.sourceType === "memory" ? memories.get(row.sourceId) : row.sourceType === "maintenance" ? maintenance.get(row.sourceId) : undefined;
    return ["question", "memory", "maintenance"].includes(row.sourceType || "") ? Boolean(parent && allowed(parent, seen)) : true;
  };
  return rows.filter(row => allowed(row, new Set()));
}
