import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  FAMILY_CHANGE_QUESTION_TYPE,
  FAMILY_CHANGE_STAGED_STATUS,
} from "@/lib/family-change-contract";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "open";
  const questions = await prisma.buckyQuestion.findMany({
    where: status === "all"
      ? undefined
      : status === "open"
        ? {
            OR: [
              { status: "open" },
              {
                status: FAMILY_CHANGE_STAGED_STATUS,
                questionType: FAMILY_CHANGE_QUESTION_TYPE,
              },
            ],
          }
        : { status },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json(questions);
}
