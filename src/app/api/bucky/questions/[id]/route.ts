import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatWithAssistant } from "@/lib/ai";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const answeredBy =
    (await getFamilyFromAuthToken(request.cookies.get(getAuthCookieName())?.value)) ||
    (typeof body.answeredBy === "string" ? body.answeredBy : "Family member");

  const existing = await prisma.buckyQuestion.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  if (body.action === "dismiss") {
    const question = await prisma.buckyQuestion.update({
      where: { id },
      data: { status: "dismissed", answeredBy, answeredAt: new Date() },
    });
    await recordBuckyLedgerEntry({
      actionType: "dismiss_question",
      summary: `Dismissed question: ${question.question}`,
      initiatedBy: answeredBy,
      entityType: "question",
      entityId: question.id,
    });
    return NextResponse.json({ question });
  }

  const answer = String(body.answer || "").trim();
  if (!answer) return NextResponse.json({ error: "Answer required" }, { status: 400 });

  const question = await prisma.buckyQuestion.update({
    where: { id },
    data: { status: "answered", answer, answeredBy, answeredAt: new Date() },
  });

  await recordBuckyLedgerEntry({
    actionType: "answer_question",
    summary: `${answeredBy} answered: ${question.question}`,
    details: answer,
    initiatedBy: answeredBy,
    entityType: "question",
    entityId: question.id,
    sourceType: question.sourceType || undefined,
    sourceId: question.sourceId || undefined,
    sourceLabel: question.sourceLabel || undefined,
    afterState: { answer, answeredBy },
  });

  let buckyResponse: string | null = null;
  let processingError = false;
  try {
    buckyResponse = await chatWithAssistant(
      [
        {
          role: "user",
          content: `[ANSWER TO YOUR ASYNCHRONOUS FOLLOW-UP]\nQuestion: ${question.question}\nContext: ${question.context || "None"}\nAnswer from ${answeredBy}: ${answer}\nSource: ${question.sourceLabel || question.sourceType || "Bucky follow-up"}${question.sourceType && question.sourceId ? `\nRelated ${question.sourceType} id: ${question.sourceId}` : ""}\n\nProcess this answer now. Apply any clear, low-risk update using your tools — for a document filing question, call set_document_category with the related document id and the category the answer indicates. If it remains ambiguous or would merge/delete records, create a new focused question instead.`,
        },
      ],
      answeredBy
    );
  } catch (error) {
    processingError = true;
    console.error("Bucky follow-up processing failed:", error);
  }

  return NextResponse.json({
    question,
    buckyResponse,
    processed: !processingError,
  });
}
