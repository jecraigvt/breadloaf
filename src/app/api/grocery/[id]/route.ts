import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Only allow specific fields to be updated
    const data: Record<string, unknown> = {};
    if (typeof body.checked === "boolean") data.checked = body.checked;
    if (typeof body.priority === "boolean") data.priority = body.priority;
    if (typeof body.name === "string") data.name = body.name.trim();
    if (typeof body.category === "string") data.category = body.category;
    if (typeof body.checkedBy === "string" || body.checkedBy === null)
      data.checkedBy = body.checkedBy;

    const item = await prisma.groceryItem.update({
      where: { id },
      data,
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Grocery update error:", error);
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.groceryItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Grocery delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 }
    );
  }
}
