import type { Prisma } from "@prisma/client";

export interface ArchiveQuestionSnapshot {
  id: string;
  status: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: Date | null;
}

const snapshotSelect = {
  id: true,
  status: true,
  answer: true,
  answeredBy: true,
  answeredAt: true,
} as const;

export async function closeOpenArchiveQuestions(
  tx: Prisma.TransactionClient,
  options: {
    documentId: string;
    categoryName: string;
    answeredBy: string;
    answeredAt?: Date;
  }
): Promise<{ before: ArchiveQuestionSnapshot[]; after: ArchiveQuestionSnapshot[] }> {
  const before = await tx.buckyQuestion.findMany({
    where: {
      sourceType: "document",
      sourceId: options.documentId,
      questionType: "archive",
      status: "open",
    },
    select: snapshotSelect,
  });
  if (before.length === 0) return { before, after: [] };

  await tx.buckyQuestion.updateMany({
    where: { id: { in: before.map((question) => question.id) }, status: "open" },
    data: {
      status: "answered",
      answeredBy: options.answeredBy,
      answeredAt: options.answeredAt ?? new Date(),
      answer: `Filed under ${options.categoryName}`,
    },
  });

  const after = await tx.buckyQuestion.findMany({
    where: { id: { in: before.map((question) => question.id) } },
    select: snapshotSelect,
  });
  return { before, after };
}
