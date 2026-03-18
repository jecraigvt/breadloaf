import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Return dinners from today onward, ordered by date
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dinners = await prisma.dinnerSignup.findMany({
      where: {
        date: { gte: today },
      },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(dinners);
  } catch (error) {
    console.error("Dinner fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dinners" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { date, chef, meal, notes, headCount } = await request.json();

    if (!date || !chef?.trim()) {
      return NextResponse.json(
        { error: "Date and chef name are required" },
        { status: 400 }
      );
    }

    const dinnerDate = new Date(date);
    dinnerDate.setHours(18, 0, 0, 0);

    const dinner = await prisma.dinnerSignup.create({
      data: {
        date: dinnerDate,
        chef: chef.trim(),
        meal: meal?.trim() || null,
        notes: notes?.trim() || null,
        headCount: headCount ? parseInt(headCount, 10) : null,
      },
    });

    return NextResponse.json(dinner);
  } catch (error: unknown) {
    console.error("Dinner create error:", error);

    // Handle unique constraint violation (someone already signed up for that date)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Someone has already signed up for that date" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create dinner signup" },
      { status: 500 }
    );
  }
}
