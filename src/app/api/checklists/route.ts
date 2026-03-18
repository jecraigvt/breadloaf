import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const list = searchParams.get("list") || "opening";

  const items = await prisma.checklistItem.findMany({
    where: { list },
    orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  try {
    const { name, list, section, sortOrder } = await request.json();

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Item name is required" },
        { status: 400 }
      );
    }

    if (!list || !["opening", "closing"].includes(list)) {
      return NextResponse.json(
        { error: "List must be 'opening' or 'closing'" },
        { status: 400 }
      );
    }

    const item = await prisma.checklistItem.create({
      data: {
        name: name.trim(),
        list,
        section: section?.trim() || "General",
        sortOrder: sortOrder ?? 0,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Checklist create error:", error);
    return NextResponse.json(
      { error: "Failed to create checklist item" },
      { status: 500 }
    );
  }
}
