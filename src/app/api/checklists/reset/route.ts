import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { archiveChecklistAndReset } from "@/lib/checklist-history";
import { getCurrentActor } from "@/lib/actor";

export async function POST(request: NextRequest) {
  try {
    const { list, archivedBy } = await request.json();

    if (!list || !["opening", "closing"].includes(list)) {
      return NextResponse.json(
        { error: "List must be 'opening' or 'closing'" },
        { status: 400 }
      );
    }

    const actor = await getCurrentActor(request);
    const author = actor?.displayName || (typeof archivedBy === "string" ? archivedBy.trim().slice(0, 100) || null : null);
    const run = await archiveChecklistAndReset(prisma, list, author);
    return NextResponse.json({ success: true, runId: run.id });
  } catch (error) {
    console.error("Checklist reset error:", error);
    return NextResponse.json(
      { error: "Failed to reset checklist" },
      { status: 500 }
    );
  }
}
