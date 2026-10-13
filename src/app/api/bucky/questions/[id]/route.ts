import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatWithAssistant } from "@/lib/ai";
import { recordBuckyLedgerEntry } from "@/lib/bucky-ledger";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { indexMemory } from "@/lib/embeddings";
import { promoteQuestionAnswerToMemory } from "@/lib/question-memory";
import { getCurrentActor } from "@/lib/actor";
import {
  confirmFamilyChangeProposal,
  FamilyChangeValidationError,
} from "@/lib/family-change";
import { FAMILY_CHANGE_QUESTION_TYPE } from "@/lib/family-change-contract";
import { AccessPolicyError, accessPolicyResponse, accessibleDocumentScopes, isPrivilegedActor, lockVerifiedActorForAccessChange, requestAccessContext } from "@/lib/access-policy";
import { filterScopedDerivedRows } from "@/lib/derived-source-access";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
 try {
  const access = await requestAccessContext(request);
  const { id } = await params;
  const body = await request.json();
  const actor = await getCurrentActor(request);
  const answeredBy = actor?.fullName || "Family member";

  const existing = await prisma.buckyQuestion.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  if (!(await filterScopedDerivedRows([existing], accessibleDocumentScopes(access))).length) throw new AccessPolicyError("This question's source requires verified permission or an unlocked vault", 403);

  if (body.action === "confirm_family_change") {
    if (existing.questionType !== FAMILY_CHANGE_QUESTION_TYPE) {
      return NextResponse.json({ error: "This is not a family-change proposal" }, { status: 400 });
    }
    if (!isPrivilegedActor(actor)) {
      return NextResponse.json(
        { error: "A verified caretaker or board member must confirm family-tree changes" },
        { status: 403 }
      );
    }
    try {
      const result = await confirmFamilyChangeProposal({
        questionId: id,
        minorDecisions: body.minorDecisions,
        confirmedBy: actor!.fullName,
        authorize: async (tx) => {
          const current = await lockVerifiedActorForAccessChange(tx, request, actor!);
          if (!isPrivilegedActor(current)) throw new AccessPolicyError("Your family-directory permissions have changed", 403);
        },
      });
      try {
        await recordBuckyLedgerEntry({
          actionType: "confirm_family_change",
          summary: `${actor!.displayName} confirmed a family-tree proposal`,
          details: result.answer,
          initiatedBy: actor!.fullName,
          entityType: "family_change_proposal",
          entityId: id,
          sourceType: existing.sourceType || undefined,
          sourceId: existing.sourceId || undefined,
          sourceLabel: existing.sourceLabel || undefined,
          afterState: JSON.parse(JSON.stringify(result)),
        });
      } catch (auditError) {
        // The graph transaction is already committed. Never invite a retry that
        // could duplicate people merely because the ledger write failed.
        console.error("Family-change confirmation audit failed:", auditError);
      }
      return NextResponse.json({ questionId: id, applied: true, result });
    } catch (error) {
      const denied = accessPolicyResponse(error); if (denied) return denied;
      const message = error instanceof Error ? error.message : "Unable to confirm proposal";
      return NextResponse.json(
        { error: message },
        { status: error instanceof FamilyChangeValidationError ? 409 : 400 }
      );
    }
  }

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
      sourceType: question.sourceType || undefined, sourceId: question.sourceId || undefined, sourceLabel: question.sourceLabel || undefined,
    });
    return NextResponse.json({ question });
  }

  if (existing.questionType === FAMILY_CHANGE_QUESTION_TYPE) {
    return NextResponse.json(
      { error: "Family-change proposals must be confirmed or dismissed" },
      { status: 400 }
    );
  }

  const answer = String(body.answer || "").trim();
  if (!answer) return NextResponse.json({ error: "Answer required" }, { status: 400 });

  const { question, promoted } = await prisma.$transaction(async (tx) => {
    const source = await tx.buckyQuestion.findUnique({ where: { id } });
    if (!source || !(await filterScopedDerivedRows([source], accessibleDocumentScopes(access), tx)).length) throw new AccessPolicyError("The question source is no longer available with your access", 403);
    const question = await tx.buckyQuestion.update({
      where: { id },
      data: { status: "answered", answer, answeredBy, answeredAt: new Date() },
    });
    const promoted = await promoteQuestionAnswerToMemory(tx, { question, answer, answeredBy });
    return { question, promoted };
  });

  let memoryIndexed = true;
  try {
    await indexMemory(promoted.memory.id, { throwOnError: true });
    if (promoted.previousMemoryId) {
      await indexMemory(promoted.previousMemoryId, { throwOnError: true });
    }
  } catch (error) {
    memoryIndexed = false;
    console.error("Question answer memory indexing failed:", error);
  }

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
    afterState: { answer, answeredBy, memoryId: promoted.memory.id },
  });

  let buckyResponse: string | null = null;
  let processingError = !memoryIndexed;
  try { if (promoted.memory.accessScope === "family") {
    buckyResponse = await chatWithAssistant(
      [
        {
          role: "user",
          content: `[ANSWER TO YOUR ASYNCHRONOUS FOLLOW-UP]\nQuestion: ${question.question}\nContext: ${question.context || "None"}\nAnswer from ${answeredBy}: ${answer}\nSource: ${question.sourceLabel || question.sourceType || "Bucky follow-up"}${question.sourceType && question.sourceId ? `\nRelated ${question.sourceType} id: ${question.sourceId}` : ""}\n\nThe raw human answer is already preserved as a provenance-linked memory; do not call save_memory merely to duplicate it. Process this answer now. Apply any clear, low-risk structured update using your tools — for a document filing question, call set_document_category with the related document id and the category the answer indicates. If it remains ambiguous or would merge/delete records, create a new focused question instead.`,
        },
      ],
      answeredBy,
      undefined,
      { actor, authorizeFamilyChange: async tx => {
        if (!actor) throw new AccessPolicyError("A verified identity is required", 403);
        const current = await lockVerifiedActorForAccessChange(tx, request, actor);
        if (!isPrivilegedActor(current)) throw new AccessPolicyError("Your permission to change family roles has changed", 403);
        return current;
      } }
    );
  } } catch (error) {
    processingError = true;
    console.error("Bucky follow-up processing failed:", error);
  }

  return NextResponse.json({
    question,
    buckyResponse,
    memoryId: promoted.memory.id,
    memoryIndexed,
    processed: !processingError,
  });
 } catch (error) { return accessPolicyResponse(error) || NextResponse.json({ error: "The question could not be updated" }, { status: 503 }); }
}
