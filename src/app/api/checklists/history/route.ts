import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const list = request.nextUrl.searchParams.get("list") || "opening";
  if (!["opening", "closing"].includes(list)) return NextResponse.json({ error: "Choose opening or closing." }, { status: 400 });
  const runs = await prisma.checklistRun.findMany({ where: { list }, orderBy: { archivedAt: "desc" }, take: 20 });
  return NextResponse.json(runs, { headers: { "Cache-Control": "private, no-store" } });
}
