import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCategory } from "@/lib/grocery-categories";

export async function GET() {
  const items = await prisma.groceryItem.findMany({
    orderBy: [
      { checked: "asc" },
      { priority: "desc" },
      { createdAt: "desc" },
    ],
  });

  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  try {
    const { name, category, addedBy, priority } = await request.json();

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Item name is required" },
        { status: 400 }
      );
    }

    const item = await prisma.groceryItem.create({
      data: {
        name: name.trim(),
        category: resolveCategory(category, name),
        addedBy: addedBy || null,
        priority: priority || false,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Grocery create error:", error);
    return NextResponse.json(
      { error: "Failed to add item" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const result = await prisma.groceryItem.deleteMany({
      where: { checked: true },
    });

    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error("Grocery bulk delete error:", error);
    return NextResponse.json(
      { error: "Failed to clear checked items" },
      { status: 500 }
    );
  }
}
