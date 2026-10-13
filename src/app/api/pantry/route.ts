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

export function POST() { return NextResponse.json({ error: "Pantry tracking has been retired. Use the shopping list for supplies." }, { status: 410 }); }
