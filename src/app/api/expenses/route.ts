import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const body = await request.json();
    const { date, amount, description, category, type, paidBy, vendor, documentId, notes } = body;

    if (!date || amount === undefined || !description) {
      return NextResponse.json(
        { error: "date, amount, and description are required" },
        { status: 400 }
      );
    }

    const expenseDate = new Date(date);
    const fiscalYear = expenseDate.getFullYear();

    const expense = await prisma.expense.create({
      data: {
        date: expenseDate,
        amount: parseFloat(String(amount)),
        description,
        category: category || "other",
        type: type || "operating",
        paidBy: paidBy || "Shared",
        vendor: vendor || undefined,
        documentId: documentId || undefined,
        notes: notes || undefined,
        fiscalYear,
      },
    });

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Create expense error:", error);
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
