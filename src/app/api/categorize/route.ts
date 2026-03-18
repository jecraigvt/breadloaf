import { NextRequest, NextResponse } from "next/server";
import { categorizeDocument, processMediaFile } from "@/lib/ai";
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

    // Get existing categories
    const categories = await prisma.category.findMany({
      select: { name: true },
    });
    const categoryNames = categories.map((c) => c.name);

    // Read the file and convert to base64
    const fullPath = path.join(process.cwd(), "public", filePath);
    const buffer = await readFile(fullPath);
    const base64 = buffer.toString("base64");

    // Route to the right processor
    if (fileType.startsWith("audio/") || fileType.startsWith("video/")) {
      // Audio/video — use multimodal processing
      const result = await processMediaFile(base64, fileType, categoryNames);
      return NextResponse.json(result);
    }

    if (fileType.startsWith("image/")) {
      // Images — use vision categorization
      const result = await categorizeDocument(base64, fileType, categoryNames);
      return NextResponse.json(result);
    }

    // PDFs, Word docs, etc. — manual categorization for now
    return NextResponse.json({
      suggestedCategory: "Other",
      title: path.basename(filePath),
      summary: "Document uploaded — categorize manually or ask Jarvis about it",
      extractedText: "",
      tags: [],
      confidence: 0.3,
    });
  } catch (error) {
    console.error("Categorization error:", error);
    return NextResponse.json(
      { error: "Categorization failed" },
      { status: 500 }
    );
  }
}
