import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexMaintenance, removeFromIndex } from "@/lib/embeddings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = body.title.trim();
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.category !== undefined) data.category = body.category;
    if (body.performedBy !== undefined) data.performedBy = body.performedBy?.trim() || null;
    if (body.performedAt !== undefined) data.performedAt = new Date(body.performedAt);
    if (body.nextDueAt !== undefined) data.nextDueAt = body.nextDueAt ? new Date(body.nextDueAt) : null;
    if (body.cost !== undefined) data.cost = body.cost ? parseFloat(body.cost) : null;

    const record = await prisma.maintenanceRecord.update({
      where: { id },
      data,
    });
    void indexMaintenance(record.id);

    return NextResponse.json(record);
  } catch (error) {
    console.error("Maintenance update error:", error);
    return NextResponse.json(
      { error: "Failed to update maintenance record" },
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
    await prisma.maintenanceRecord.delete({ where: { id } });
    void removeFromIndex("maintenance", id).catch((error) =>
      console.error("Maintenance index cleanup failed:", error)
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Maintenance delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete maintenance record" },
      { status: 500 }
    );
  }
}
