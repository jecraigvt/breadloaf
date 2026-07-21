import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isUndoSupportedAction } from "@/lib/bucky-ledger";

export async function GET(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  const entries = await prisma.buckyLedgerEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      actionType: true,
      summary: true,
      details: true,
      initiatedBy: true,
      sourceType: true,
      sourceId: true,
      sourceLabel: true,
      reversible: true,
      revertedAt: true,
      revertedBy: true,
      createdAt: true,
    },
  });
  return NextResponse.json(entries.map((entry) => ({
    ...entry,
    reversible: entry.reversible && isUndoSupportedAction(entry.actionType),
  })));
}
