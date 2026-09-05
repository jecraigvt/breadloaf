import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { indexDocument } from "@/lib/embeddings";
import { isUndoSupportedAction } from "@/lib/bucky-ledger";
import { z } from "zod";

type JsonObject = Record<string, unknown>;

export class BuckyUndoError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BuckyUndoError";
  }
}

function objectValue(value: Prisma.JsonValue | null): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new BuckyUndoError("This ledger entry does not contain a usable undo snapshot.", 409);
  }
  return value as JsonObject;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function datesMatch(left: Date | null, right: unknown): boolean {
  const expected = typeof right === "string" ? new Date(right) : null;
  if (!left && !expected) return true;
  return Boolean(left && expected && left.getTime() === expected.getTime());
}

interface MemberSnapshot {
  id: string;
  boardRole: string | null;
  isBoardMember: boolean;
}

interface FilingQuestionSnapshot {
  id: string;
  status: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
}

function memberSnapshots(value: unknown): MemberSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as JsonObject;
    if (typeof candidate.id !== "string" || typeof candidate.isBoardMember !== "boolean") return [];
    return [{
      id: candidate.id,
      boardRole: nullableString(candidate.boardRole),
      isBoardMember: candidate.isBoardMember,
    }];
  });
}

function filingQuestionSnapshots(value: unknown): FilingQuestionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as JsonObject;
    if (typeof candidate.id !== "string" || typeof candidate.status !== "string") return [];
    return [{
      id: candidate.id,
      status: candidate.status,
      answer: nullableString(candidate.answer),
      answeredBy: nullableString(candidate.answeredBy),
      answeredAt: nullableString(candidate.answeredAt),
    }];
  });
}

const backgroundQuestionSchema = z.object({
  id: z.string().min(1), status: z.string(), answer: z.string().nullable(),
  answeredBy: z.string().nullable(), answeredAt: z.string().datetime().nullable(),
});
const backgroundSnapshotSchema = z.object({
  documentId: z.string().min(1), title: z.string(), categoryId: z.string().nullable(), tags: z.string().nullable(),
  aiSummary: z.string().nullable(), aiExtractedText: z.string().nullable(), analysisState: z.string(), analysisError: z.string().nullable(),
  updatedAt: z.string().datetime(), questions: z.array(backgroundQuestionSchema),
});

async function undoBackgroundDocumentAnalysis(tx: Prisma.TransactionClient, beforeValue: JsonObject, afterValue: JsonObject, jobId: string | null) {
  const parsedBefore = backgroundSnapshotSchema.safeParse(beforeValue);
  const parsedAfter = backgroundSnapshotSchema.safeParse(afterValue);
  if (!parsedBefore.success || !parsedAfter.success || !jobId) throw new BuckyUndoError("The background analysis undo snapshot is incomplete.", 409);
  const before = parsedBefore.data, after = parsedAfter.data;
  if (before.documentId !== after.documentId) throw new BuckyUndoError("The background analysis snapshots refer to different documents.", 409);
  const questionIds = after.questions.map((question) => question.id).sort();
  if (new Set(questionIds).size !== questionIds.length || JSON.stringify(questionIds) !== JSON.stringify(before.questions.map((question) => question.id).sort())) {
    throw new BuckyUndoError("The background analysis question snapshots are incomplete.", 409);
  }
  // Same lock order as completion: job before document. The job's result is the
  // durable indexing outbox; undo must not depend on an in-request provider call.
  await tx.$queryRaw`SELECT "id" FROM "BuckyJob" WHERE "id" = ${jobId} FOR UPDATE`;
  const job = await tx.buckyJob.findUnique({ where: { id: jobId } });
  if (!job || job.sourceDocumentId !== after.documentId) throw new BuckyUndoError("The original background job is unavailable.", 409);
  await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${after.documentId} FOR UPDATE`;
  const document = await tx.document.findUnique({ where: { id: after.documentId } });
  if (!document || document.deletedAt || document.accessScope !== "family") throw new BuckyUndoError("The document is no longer available for this undo.", 409);
  const changed = document.updatedAt.toISOString() !== after.updatedAt ||
    (Object.keys(after).filter((key) => !["documentId", "updatedAt", "questions"].includes(key)) as Array<keyof typeof document>)
      .some((field) => document[field] !== after[field as keyof typeof after]);
  if (changed) throw new BuckyUndoError("The document was changed again after this analysis, so it was not overwritten.", 409);

  for (const expected of [...after.questions].sort((a, b) => a.id.localeCompare(b.id))) {
    await tx.$queryRaw`SELECT "id" FROM "BuckyQuestion" WHERE "id" = ${expected.id} FOR UPDATE`;
    const question = await tx.buckyQuestion.findUnique({ where: { id: expected.id } });
    if (!question || question.sourceId !== document.id || question.sourceType !== "document" ||
      question.status !== expected.status || question.answer !== expected.answer ||
      question.answeredBy !== expected.answeredBy || !datesMatch(question.answeredAt, expected.answeredAt)) {
      throw new BuckyUndoError("The related filing question changed after this analysis, so it was not overwritten.", 409);
    }
  }
  const { documentId: _id, updatedAt: _updatedAt, questions, ...restore } = before;
  await tx.document.update({ where: { id: document.id }, data: restore });
  for (const question of questions) {
    const { id, answeredAt, ...data } = question;
    await tx.buckyQuestion.update({ where: { id }, data: { ...data, answeredAt: answeredAt ? new Date(answeredAt) : null } });
  }
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result) ? job.result as Prisma.JsonObject : {};
  await tx.buckyJob.update({ where: { id: job.id }, data: { result: { ...result, documentId: document.id, indexPending: true, analysisUndone: true } } });
}

async function undoDocumentCategory(
  tx: Prisma.TransactionClient,
  before: JsonObject,
  after: JsonObject
) {
  const documentId = nullableString(after.documentId);
  if (!documentId) throw new BuckyUndoError("The document undo snapshot is incomplete.", 409);

  const document = await tx.document.findUnique({ where: { id: documentId } });
  if (!document || document.deletedAt) throw new BuckyUndoError("The document no longer exists.", 409);
  if (document.categoryId !== nullableString(after.categoryId)) {
    throw new BuckyUndoError("The document was changed again after this action, so it was not overwritten.", 409);
  }

  const expectedQuestions = filingQuestionSnapshots(after.questions);
  for (const expected of expectedQuestions) {
    const question = await tx.buckyQuestion.findUnique({ where: { id: expected.id } });
    if (
      !question ||
      question.status !== expected.status ||
      question.answer !== expected.answer ||
      question.answeredBy !== expected.answeredBy ||
      !datesMatch(question.answeredAt, expected.answeredAt)
    ) {
      throw new BuckyUndoError(
        "The related filing question changed after this action, so it was not overwritten.",
        409
      );
    }
  }

  await tx.document.update({
    where: { id: documentId },
    data: { categoryId: nullableString(before.categoryId) },
  });
  for (const snapshot of filingQuestionSnapshots(before.questions)) {
    await tx.buckyQuestion.update({
      where: { id: snapshot.id },
      data: {
        status: snapshot.status,
        answer: snapshot.answer,
        answeredBy: snapshot.answeredBy,
        answeredAt: snapshot.answeredAt ? new Date(snapshot.answeredAt) : null,
      },
    });
  }
  return { documentId };
}

async function undoPosition(
  tx: Prisma.TransactionClient,
  before: JsonObject,
  after: JsonObject
) {
  const current = objectValue((after.currentAssignment as Prisma.JsonValue | null) || null);
  const currentId = nullableString(current.id);
  const position = nullableString(current.position);
  if (!currentId || !position) throw new BuckyUndoError("The position undo snapshot is incomplete.", 409);

  const liveCurrent = await tx.positionAssignment.findUnique({ where: { id: currentId } });
  if (!liveCurrent || liveCurrent.endedAt) {
    throw new BuckyUndoError("That position has changed since this entry, so it was not overwritten.", 409);
  }
  const competing = await tx.positionAssignment.findFirst({
    where: { position: { equals: position, mode: "insensitive" }, endedAt: null, id: { not: currentId } },
  });
  if (competing) throw new BuckyUndoError("A newer holder now has this position, so the older change cannot be undone.", 409);

  const expectedMembers = memberSnapshots(after.members);
  for (const expected of expectedMembers) {
    const member = await tx.familyMember.findUnique({ where: { id: expected.id } });
    if (!member || member.boardRole !== expected.boardRole || member.isBoardMember !== expected.isBoardMember) {
      throw new BuckyUndoError("A family member's roles changed after this entry, so they were not overwritten.", 409);
    }
  }

  const previousAfter = after.previousAssignment && typeof after.previousAssignment === "object" && !Array.isArray(after.previousAssignment)
    ? after.previousAssignment as JsonObject
    : null;
  if (previousAfter?.id && typeof previousAfter.id === "string") {
    const livePrevious = await tx.positionAssignment.findUnique({ where: { id: previousAfter.id } });
    if (!livePrevious || !datesMatch(livePrevious.endedAt, previousAfter.endedAt)) {
      throw new BuckyUndoError("The previous position record changed after this entry, so it was not overwritten.", 409);
    }
  }

  await tx.positionAssignment.delete({ where: { id: currentId } });
  const previousBefore = before.previousAssignment && typeof before.previousAssignment === "object" && !Array.isArray(before.previousAssignment)
    ? before.previousAssignment as JsonObject
    : null;
  if (previousBefore?.id && typeof previousBefore.id === "string") {
    await tx.positionAssignment.update({
      where: { id: previousBefore.id },
      data: { endedAt: typeof previousBefore.endedAt === "string" ? new Date(previousBefore.endedAt) : null },
    });
  }
  for (const snapshot of memberSnapshots(before.members)) {
    await tx.familyMember.update({
      where: { id: snapshot.id },
      data: { boardRole: snapshot.boardRole, isBoardMember: snapshot.isBoardMember },
    });
  }
  return {};
}

export async function undoBuckyLedgerEntry(entryId: string, revertedBy: string) {
  let documentId: string | undefined;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "BuckyLedgerEntry" WHERE "id" = ${entryId} FOR UPDATE`;
    const entry = await tx.buckyLedgerEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new BuckyUndoError("Ledger entry not found.", 404);
    if (entry.revertedAt) throw new BuckyUndoError("This action has already been undone.", 409);
    if (!entry.reversible || !isUndoSupportedAction(entry.actionType)) {
      throw new BuckyUndoError("This action cannot be undone from the Ledger.", 400);
    }

    const before = objectValue(entry.beforeState);
    const after = objectValue(entry.afterState);
    if (entry.actionType === "set_document_category") {
      ({ documentId } = await undoDocumentCategory(tx, before, after));
    } else if (entry.actionType === "update_position") {
      await undoPosition(tx, before, after);
    } else if (entry.actionType === "background_document_analysis") {
      await undoBackgroundDocumentAnalysis(tx, before, after, entry.sourceType === "background_job" ? entry.sourceId : null);
    }

    const revertedAt = new Date();
    const claimed = await tx.buckyLedgerEntry.updateMany({
      where: { id: entry.id, revertedAt: null },
      data: { revertedAt, revertedBy },
    });
    if (claimed.count !== 1) throw new BuckyUndoError("This action was already undone.", 409);

    await tx.buckyLedgerEntry.create({
      data: {
        actionType: `undo_${entry.actionType}`,
        summary: `Undid: ${entry.summary}`,
        initiatedBy: revertedBy,
        entityType: entry.entityType,
        entityId: entry.entityId,
        sourceType: "ledger",
        sourceId: entry.id,
        sourceLabel: entry.summary,
        beforeState: entry.afterState ?? undefined,
        afterState: entry.beforeState ?? undefined,
        reversible: false,
      },
    });

    return tx.buckyLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (documentId) void indexDocument(documentId);
  return result;
}
