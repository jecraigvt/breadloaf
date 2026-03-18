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

    if (typeof body.checked === "boolean") {
      data.checked = body.checked;
      data.checkedAt = body.checked ? new Date() : null;
      data.checkedBy = body.checked ? (body.checkedBy || null) : null;
    }

    if (body.name !== undefined) data.name = body.name;
    if (body.section !== undefined) data.section = body.section;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

    const item = await prisma.checklistItem.update({
      where: { id },
      data,
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Checklist update error:", error);
    return NextResponse.json(
      { error: "Failed to update checklist item" },
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
    await prisma.checklistItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Checklist delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete checklist item" },
      { status: 500 }
    );
  }
}
