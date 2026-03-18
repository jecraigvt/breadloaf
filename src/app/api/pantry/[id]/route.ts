import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") data.name = body.name.trim();
    if (typeof body.category === "string") data.category = body.category;
    if (typeof body.quantity === "number") data.quantity = body.quantity;
    if (typeof body.unit === "string" || body.unit === null)
      data.unit = body.unit?.trim() || null;
    if (typeof body.expiresAt === "string" || body.expiresAt === null)
      data.expiresAt = body.expiresAt?.trim() || null;
    if (typeof body.notes === "string" || body.notes === null)
      data.notes = body.notes?.trim() || null;
    if (typeof body.updatedBy === "string" || body.updatedBy === null)
      data.updatedBy = body.updatedBy || null;

    const item = await prisma.pantryItem.update({
      where: { id },
      data,
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Pantry update error:", error);
    return NextResponse.json(
      { error: "Failed to update pantry item" },
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
    await prisma.pantryItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Pantry delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete pantry item" },
      { status: 500 }
    );
  }
}
