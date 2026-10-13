import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { summarizeExpenseLedger } from "@/lib/expense-ledger";

export async function GET(request: NextRequest) {
  const year = Number(request.nextUrl.searchParams.get("year") || new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return NextResponse.json({ error: "Invalid expense year." }, { status: 400 });
  const [expenses, years] = await Promise.all([
    prisma.expense.findMany({ where: { fiscalYear: year }, orderBy: { date: "desc" } }),
    prisma.expense.groupBy({ by: ["fiscalYear"], orderBy: { fiscalYear: "desc" } }),
  ]);
  return NextResponse.json({ year, ...summarizeExpenseLedger(expenses), availableYears: years.map(row => row.fiscalYear) });
}
