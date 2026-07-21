import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { indexAsset } from "@/lib/embeddings";

export async function GET() {
  const assets = await prisma.asset.findMany({
    where: { status: "active" },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      records: { orderBy: { performedAt: "desc" }, take: 5 },
      documents: {
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      _count: { select: { records: true, documents: true } },
    },
  });
  return NextResponse.json(assets);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name as string)?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const asset = await prisma.asset.create({
      data: {
        name,
        category: body.category || "other",
        location: body.location || undefined,
        make: body.make || undefined,
        model: body.model || undefined,
        serial: body.serial || undefined,
        installedYear: body.installedYear
          ? parseInt(String(body.installedYear))
          : undefined,
        notes: body.notes || undefined,
        addedBy: body.addedBy || undefined,
      },
    });
    void indexAsset(asset.id);
    return NextResponse.json(asset);
  } catch (error) {
    console.error("Create asset error:", error);
    return NextResponse.json({ error: "Failed to create asset" }, { status: 500 });
  }
}
