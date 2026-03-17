import { NextRequest, NextResponse } from "next/server";
import { categorizeDocument } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { readFile } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const { filePath, fileType } = await request.json();

    if (!filePath || !fileType) {
      return NextResponse.json(
        { error: "filePath and fileType required" },
        { status: 400 }
      );
    }

    // Only categorize images (Gemini vision)
    if (!fileType.startsWith("image/")) {
      return NextResponse.json({
        suggestedCategory: "Other",
        title: path.basename(filePath),
        summary: "PDF document — manual categorization recommended",
        extractedText: "",
        tags: [],
        confidence: 0.3,
      });
    }

    // Read the file and convert to base64
    const fullPath = path.join(process.cwd(), "public", filePath);
    const buffer = await readFile(fullPath);
    const base64 = buffer.toString("base64");

    // Get existing categories
    const categories = await prisma.category.findMany({
      select: { name: true },
    });
    const categoryNames = categories.map((c) => c.name);

    const result = await categorizeDocument(base64, fileType, categoryNames);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Categorization error:", error);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
