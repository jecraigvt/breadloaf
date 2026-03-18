import { NextRequest, NextResponse } from "next/server";
import { scanPantryItems } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const { image, fileType } = await request.json();

    if (!image || !fileType) {
      return NextResponse.json(
        { error: "image (base64) and fileType required" },
        { status: 400 }
      );
    }

    const items = await scanPantryItems(image, fileType);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Pantry scan error:", error);
    return NextResponse.json(
      { error: "Failed to scan pantry items" },
      { status: 500 }
    );
  }
}
