import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "open";
  const questions = await prisma.buckyQuestion.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
  return NextResponse.json(questions);
}
