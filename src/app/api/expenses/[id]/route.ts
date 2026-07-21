import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexExpense, removeFromIndex } from "@/lib/embeddings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { date, ...rest } = body;

    const data: Record<string, unknown> = { ...rest };
    if (date) {
      data.date = new Date(date);
      data.fiscalYear = new Date(date).getFullYear();
    }
    if (data.amount) data.amount = parseFloat(String(data.amount));

    const expense = await prisma.expense.update({
      where: { id: params.id },
      data,
    });
    void indexExpense(expense.id);

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Update expense error:", error);
    return NextResponse.json({ error: "Failed to update expense" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.expense.delete({ where: { id: params.id } });
    void removeFromIndex("expense", params.id).catch((error) =>
      console.error("Expense index cleanup failed:", error)
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete expense error:", error);
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
