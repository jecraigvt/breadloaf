import type { BuckyQuestion, JarvisMemory, Prisma } from "@prisma/client";

interface AnsweredQuestion extends Pick<
  BuckyQuestion,
  "id" | "question" | "context" | "questionType" | "targetPerson" | "sourceType" | "sourceId" | "sourceLabel"
> {}

export interface PromotedQuestionMemory {
  memory: JarvisMemory;
  previousMemoryId: string | null;
  action: "created" | "updated" | "unchanged";
}

function memoryContent(question: AnsweredQuestion, answer: string): string {
  const relatedSource = [
    question.sourceLabel,
    question.sourceType && question.sourceId ? `${question.sourceType}:${question.sourceId}` : question.sourceType,
  ].filter(Boolean).join(" — ");
  return [
    `Question: ${question.question}`,
    question.context ? `Context: ${question.context}` : "",
    `Answer: ${answer}`,
    relatedSource ? `Related source: ${relatedSource}` : "",
  ].filter(Boolean).join("\n");
}

export function shouldPromoteQuestionAnswer(
  question: Pick<BuckyQuestion, "questionType" | "answer">
): boolean {
  const answer = question.answer?.trim() || "";
  if (!answer) return false;
  return !(question.questionType === "archive" && /^filed under\b/i.test(answer));
}

export async function promoteQuestionAnswerToMemory(
  tx: Prisma.TransactionClient,
  options: {
    question: AnsweredQuestion;
    answer: string;
    answeredBy: string;
  }
): Promise<PromotedQuestionMemory> {
  const answer = options.answer.trim();
  if (!answer) throw new Error("Cannot promote an empty question answer");
  const content = memoryContent(options.question, answer);
  const existing = await tx.jarvisMemory.findFirst({
    where: { sourceType: "question", sourceId: options.question.id, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  if (existing?.content === content) {
    return { memory: existing, previousMemoryId: null, action: "unchanged" };
  }

  const memory = await tx.jarvisMemory.create({
    data: {
      type: "semantic",
      topic: options.question.question.slice(0, 120),
      content,
      source: `Answer from ${options.answeredBy} to Bucky question`,
      sourceType: "question",
      sourceId: options.question.id,
      scope: options.question.targetPerson ? "family" : "property",
      subject: options.question.sourceLabel || options.question.targetPerson || undefined,
      confidence: 1,
      importance: 0.85,
      accessScope: "family",
    },
  });
  if (existing) {
    await tx.jarvisMemory.update({
      where: { id: existing.id },
      data: { status: "superseded", supersededById: memory.id },
    });
  }
  return {
    memory,
    previousMemoryId: existing?.id || null,
    action: existing ? "updated" : "created",
  };
}
