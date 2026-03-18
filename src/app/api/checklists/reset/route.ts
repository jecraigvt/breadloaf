import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const { list } = await request.json();

    if (!list || !["opening", "closing"].includes(list)) {
      return NextResponse.json(
        { error: "List must be 'opening' or 'closing'" },
        { status: 400 }
      );
    }

    await prisma.checklistItem.updateMany({
      where: { list },
      data: {
        checked: false,
        checkedBy: null,
        checkedAt: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Checklist reset error:", error);
    return NextResponse.json(
      { error: "Failed to reset checklist" },
      { status: 500 }
    );
  }
}
