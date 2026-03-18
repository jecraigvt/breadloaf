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
    if (typeof body.chef === "string") data.chef = body.chef.trim();
    if (typeof body.meal === "string" || body.meal === null)
      data.meal = body.meal?.trim() || null;
    if (typeof body.notes === "string" || body.notes === null)
      data.notes = body.notes?.trim() || null;
    if (typeof body.headCount === "number" || body.headCount === null)
      data.headCount = body.headCount;
    if (typeof body.date === "string") {
      const dinnerDate = new Date(body.date);
      dinnerDate.setHours(18, 0, 0, 0);
      data.date = dinnerDate;
    }

    const dinner = await prisma.dinnerSignup.update({
      where: { id },
      data,
    });

    return NextResponse.json(dinner);
  } catch (error: unknown) {
    console.error("Dinner update error:", error);

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
      { error: "Failed to update dinner signup" },
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
    await prisma.dinnerSignup.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Dinner delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete dinner signup" },
      { status: 500 }
    );
  }
}
