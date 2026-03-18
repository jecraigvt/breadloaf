import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  const where = category && category !== "All" ? { category } : {};

  const records = await prisma.maintenanceRecord.findMany({
    where,
    orderBy: { performedAt: "desc" },
  });

  return NextResponse.json(records);
}

export async function POST(request: NextRequest) {
  try {
    const { title, description, category, performedBy, performedAt, nextDueAt, cost } =
      await request.json();

    if (!title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!performedAt) {
      return NextResponse.json(
        { error: "Performed date is required" },
        { status: 400 }
      );
    }

    const record = await prisma.maintenanceRecord.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        category: category || "General",
        performedBy: performedBy?.trim() || null,
        performedAt: new Date(performedAt),
        nextDueAt: nextDueAt ? new Date(nextDueAt) : null,
        cost: cost ? parseFloat(cost) : null,
      },
    });

    return NextResponse.json(record);
  } catch (error) {
    console.error("Maintenance create error:", error);
    return NextResponse.json(
      { error: "Failed to create maintenance record" },
      { status: 500 }
    );
  }
}
