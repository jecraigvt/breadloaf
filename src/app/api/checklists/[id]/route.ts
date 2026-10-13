import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getCurrentActor } from "@/lib/actor";

const changeSchema = z.object({
  checked: z.boolean().optional(), checkedBy: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(), section: z.string().trim().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = changeSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid checklist change." }, { status: 400 });
    const body = parsed.data;

    const data: Record<string, unknown> = {};

    if (typeof body.checked === "boolean") {
      data.checked = body.checked;
      data.checkedAt = body.checked ? new Date() : null;
      const actor = await getCurrentActor(request);
      const author = actor?.displayName || body.checkedBy || null;
      if (body.checked && !author) return NextResponse.json({ error: "Enter your name before completing a task." }, { status: 400 });
      data.checkedBy = body.checked ? author : null;
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
