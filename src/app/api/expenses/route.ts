import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexExpense } from "@/lib/embeddings";
import { expenseInputSchema } from "@/lib/expense-ledger";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const year = searchParams.get("year");
  const category = searchParams.get("category");
  const paidBy = searchParams.get("paidBy");
  const type = searchParams.get("type");

  const where: Record<string, unknown> = {};

  if (year) where.fiscalYear = parseInt(year);
  if (category) where.category = category;
  if (paidBy) where.paidBy = paidBy;
  if (type) where.type = type;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { date: "desc" },
    take: 200,
  });

  return NextResponse.json(expenses);
}

export async function POST(request: NextRequest) {
  try {
    const parsed = expenseInputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid date, nonnegative amount, and description." }, { status: 400 });

    const expense = await prisma.expense.create({
      data: {
        ...parsed.data,
        fiscalYear: parsed.data.date.getUTCFullYear(),
      },
    });
    void indexExpense(expense.id);

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Create expense error:", error);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
