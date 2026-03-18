import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));

  const expenses = await prisma.expense.findMany({
    where: { fiscalYear: year },
    orderBy: { date: "desc" },
  });

  // Total
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  // By category
  const byCategory: Record<string, number> = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  }

  // By type (operating vs capital)
  const byType: Record<string, number> = { operating: 0, capital: 0 };
  for (const e of expenses) {
    byType[e.type] = (byType[e.type] || 0) + e.amount;
  }

  // By payer
  const byPayer: Record<string, number> = {};
  for (const e of expenses) {
    byPayer[e.paidBy] = (byPayer[e.paidBy] || 0) + e.amount;
  }

  // Per-family share (equal 4-way split of total)
  const perFamilyShare = total / 4;
  const families = ["Tom", "Jim", "Sandy", "Greg"];
  const familyBalances: Record<string, { paid: number; owes: number; balance: number }> = {};
  for (const family of families) {
    const paid = byPayer[family] || 0;
    familyBalances[family] = {
      paid,
      owes: perFamilyShare,
      balance: paid - perFamilyShare, // positive = overpaid (owed back), negative = underpaid (owes)
    };
  }

  // Available fiscal years
  const years = await prisma.expense.groupBy({
    by: ["fiscalYear"],
    orderBy: { fiscalYear: "desc" },
  });

  return NextResponse.json({
    year,
    total,
    expenseCount: expenses.length,
    byCategory,
    byType,
    byPayer,
    perFamilyShare,
    familyBalances,
    availableYears: years.map((y) => y.fiscalYear),
  });
}
