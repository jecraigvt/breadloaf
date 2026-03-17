import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const messages = await prisma.bulletinMessage.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json(messages);
}

export async function POST(request: NextRequest) {
  try {
    const { author, content } = await request.json();

    if (!author?.trim() || !content?.trim()) {
      return NextResponse.json(
        { error: "Author and content required" },
        { status: 400 }
      );
    }

    const message = await prisma.bulletinMessage.create({
      data: {
        author: author.trim(),
        content: content.trim(),
      },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Bulletin post error:", error);
    return NextResponse.json(
      { error: "Failed to post message" },
      { status: 500 }
    );
  }
}
