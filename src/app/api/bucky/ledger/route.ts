import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  const entries = await prisma.buckyLedgerEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json(entries);
}
