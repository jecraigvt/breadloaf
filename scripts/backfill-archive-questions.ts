import { closeOpenArchiveQuestions } from "../src/lib/archive-questions";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const openQuestions = await prisma.buckyQuestion.findMany({
    where: {
      questionType: "archive",
      status: "open",
      sourceType: "document",
      sourceId: { not: null },
    },
    select: { id: true, sourceId: true, sourceLabel: true },
  });
  const documentIds = Array.from(new Set(openQuestions.map((question) => question.sourceId).filter(Boolean))) as string[];
  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, categoryId: { not: null }, deletedAt: null },
    include: { category: true },
  });
  const stale = documents.filter((document) => document.category);

  console.log(`${openQuestions.length} open archive questions; ${stale.length} filed documents need closure`);
  for (const document of stale) {
    const questionCount = openQuestions.filter((question) => question.sourceId === document.id).length;
    console.log(`${apply ? "closing" : "would-close"}: ${document.title} (${questionCount} question${questionCount === 1 ? "" : "s"})`);
    if (!apply || !document.category) continue;
    await prisma.$transaction((tx) => closeOpenArchiveQuestions(tx, {
      documentId: document.id,
      categoryName: document.category!.name,
      answeredBy: "Archive question backfill",
    }));
  }

  if (!apply && stale.length > 0) console.log("Preview only; rerun with --apply to update production.");
}

main()
  .catch((error) => {
    console.error("Archive question backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
