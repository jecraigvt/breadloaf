import { indexMemory } from "../src/lib/embeddings";
import { prisma } from "../src/lib/prisma";
import { promoteQuestionAnswerToMemory, shouldPromoteQuestionAnswer } from "../src/lib/question-memory";

async function main() {
  const apply = process.argv.includes("--apply");
  const questions = await prisma.buckyQuestion.findMany({
    where: { status: "answered", answer: { not: null } },
    orderBy: { answeredAt: "asc" },
  });
  const candidates = questions.filter(shouldPromoteQuestionAnswer);
  console.log(`${questions.length} answered questions; ${candidates.length} human answers eligible for memory`);

  for (const question of candidates) {
    const label = question.question.replace(/\s+/g, " ").slice(0, 100);
    if (!apply) {
      console.log(`would-promote: ${label} | by ${question.answeredBy || "unknown"} | ${question.answer!.replace(/\s+/g, " ").slice(0, 120)}`);
      continue;
    }
    try {
      const promoted = await prisma.$transaction((tx) => promoteQuestionAnswerToMemory(tx, {
        question,
        answer: question.answer!,
        answeredBy: question.answeredBy || "Family member",
      }));
      await indexMemory(promoted.memory.id, { throwOnError: true });
      if (promoted.previousMemoryId) await indexMemory(promoted.previousMemoryId, { throwOnError: true });
      console.log(`${promoted.action}: ${label}`);
    } catch (error) {
      console.error(`failed: ${label}: ${String(error).slice(0, 180)}`);
      process.exitCode = 1;
    }
  }
  if (!apply && candidates.length > 0) console.log("Preview only; rerun with --apply to write and index memories.");
}

main()
  .catch((error) => {
    console.error("Question-memory backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
