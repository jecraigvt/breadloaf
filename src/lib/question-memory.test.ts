import assert from "node:assert/strict";
import test from "node:test";
import type { BuckyQuestion, JarvisMemory, Prisma } from "@prisma/client";
import { promoteQuestionAnswerToMemory, shouldPromoteQuestionAnswer } from "./question-memory";

const question = {
  id: "question-1",
  question: "Who is in this photo?",
  context: "An unlabeled porch photo",
  questionType: "archive",
  targetPerson: "Jim",
  sourceType: "document",
  sourceId: "document-1",
  sourceLabel: "Ripton porch photo",
};

function memory(overrides: Partial<JarvisMemory> = {}): JarvisMemory {
  return {
    id: "memory-1",
    type: "semantic",
    topic: question.question,
    content: "old content",
    source: null,
    sourceType: "question",
    sourceId: question.id,
    scope: "family",
    subject: question.sourceLabel,
    confidence: 1,
    importance: 0.85,
    validFrom: null,
    validUntil: null,
    status: "active",
    supersededById: null,
    lastUsedAt: null,
    useCount: 0,
    accessScope: "family",
    relevance: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

test("creates a provenance-linked memory from a human answer", async () => {
  let createdData: Record<string, unknown> | undefined;
  const created = memory({ id: "memory-new" });
  const tx = {
    jarvisMemory: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return created;
      },
      update: async () => { throw new Error("should not supersede"); },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await promoteQuestionAnswerToMemory(tx, {
    question,
    answer: "That's Bill and Lois at Ripton, 1962.",
    answeredBy: "Jim",
  });

  assert.equal(result.action, "created");
  assert.equal(result.memory.id, "memory-new");
  assert.equal(createdData?.sourceType, "question");
  assert.equal(createdData?.sourceId, question.id);
  assert.equal(createdData?.source, "Answer from Jim to Bucky question");
  assert.match(String(createdData?.content), /Answer: That's Bill and Lois at Ripton, 1962\./);
  assert.match(String(createdData?.content), /Related source: Ripton porch photo — document:document-1/);
});

test("a corrected answer supersedes the prior question memory", async () => {
  const existing = memory();
  const replacement = memory({ id: "memory-2", content: "new content" });
  let updateArgs: unknown;
  const tx = {
    jarvisMemory: {
      findFirst: async () => existing,
      create: async () => replacement,
      update: async (args: unknown) => {
        updateArgs = args;
        return existing;
      },
    },
  } as unknown as Prisma.TransactionClient;

  const result = await promoteQuestionAnswerToMemory(tx, {
    question,
    answer: "Correction: that's Bill and Marie.",
    answeredBy: "Jim",
  });
  assert.equal(result.action, "updated");
  assert.equal(result.previousMemoryId, existing.id);
  assert.deepEqual(updateArgs, {
    where: { id: existing.id },
    data: { status: "superseded", supersededById: replacement.id },
  });
});

test("automated archive filing answers are not promoted", () => {
  assert.equal(shouldPromoteQuestionAnswer({ questionType: "archive", answer: "Filed under Photos" } as BuckyQuestion), false);
  assert.equal(shouldPromoteQuestionAnswer({ questionType: "archive", answer: "That's Bill in 1962" } as BuckyQuestion), true);
  assert.equal(shouldPromoteQuestionAnswer({ questionType: "clarification", answer: "" } as BuckyQuestion), false);
});
