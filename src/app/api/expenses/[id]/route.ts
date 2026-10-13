import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexExpense, removeFromIndex } from "@/lib/embeddings";
import { expensePatchSchema } from "@/lib/expense-ledger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = expensePatchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid expense change." }, { status: 400 });
    const data = { ...parsed.data, ...(parsed.data.date ? { fiscalYear: parsed.data.date.getUTCFullYear() } : {}) };

    const expense = await prisma.expense.update({
      where: { id },
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.expense.delete({ where: { id } });
    void removeFromIndex("expense", id).catch((error) =>
      console.error("Expense index cleanup failed:", error)
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete expense error:", error);
    return NextResponse.json({ error: "Failed to delete expense" }, { status: 500 });
  }
}
