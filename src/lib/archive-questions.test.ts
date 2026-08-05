import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { closeOpenArchiveQuestions } from "./archive-questions";

test("closes only matching open archive questions and returns undo snapshots", async () => {
  const answeredAt = new Date("2026-08-05T20:00:00Z");
  const before = [{ id: "question-1", status: "open", answer: null, answeredBy: null, answeredAt: null }];
  const after = [{ ...before[0], status: "answered", answer: "Filed under Photos", answeredBy: "Jim", answeredAt }];
  const finds: unknown[] = [];
  const updates: unknown[] = [];
  let findCount = 0;
  const tx = {
    buckyQuestion: {
      findMany: async (args: unknown) => {
        finds.push(args);
        return findCount++ === 0 ? before : after;
      },
      updateMany: async (args: unknown) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  } as unknown as Prisma.TransactionClient;

  const snapshots = await closeOpenArchiveQuestions(tx, {
    documentId: "document-1",
    categoryName: "Photos",
    answeredBy: "Jim",
    answeredAt,
  });

  assert.deepEqual(snapshots, { before, after });
  assert.deepEqual((finds[0] as { where: unknown }).where, {
    sourceType: "document",
    sourceId: "document-1",
    questionType: "archive",
    status: "open",
  });
  assert.deepEqual(updates[0], {
    where: { id: { in: ["question-1"] }, status: "open" },
    data: {
      status: "answered",
      answeredBy: "Jim",
      answeredAt,
      answer: "Filed under Photos",
    },
  });
});

test("does not issue an update when no archive question is open", async () => {
  let updated = false;
  const tx = {
    buckyQuestion: {
      findMany: async () => [],
      updateMany: async () => {
        updated = true;
        return { count: 0 };
      },
    },
  } as unknown as Prisma.TransactionClient;

  assert.deepEqual(await closeOpenArchiveQuestions(tx, {
    documentId: "document-1",
    categoryName: "Photos",
    answeredBy: "Family member",
  }), { before: [], after: [] });
  assert.equal(updated, false);
});
