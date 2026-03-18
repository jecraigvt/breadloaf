import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const category = searchParams.get("category");

    const where: Record<string, unknown> = {};

    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    if (category && category !== "All") {
      where.category = category;
    }

    const items = await prisma.pantryItem.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("Pantry fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch pantry items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, category, quantity, unit, expiresAt, notes, updatedBy } =
      await request.json();

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Item name is required" },
        { status: 400 }
      );
    }

    const item = await prisma.pantryItem.create({
      data: {
        name: name.trim(),
        category: category || "General",
        quantity: quantity ? parseInt(quantity, 10) : 1,
        unit: unit?.trim() || null,
        expiresAt: expiresAt?.trim() || null,
        notes: notes?.trim() || null,
        updatedBy: updatedBy || null,
      },
    });

    return NextResponse.json(item);
  } catch (error) {
    console.error("Pantry create error:", error);
    return NextResponse.json(
      { error: "Failed to add pantry item" },
      { status: 500 }
    );
  }
}
