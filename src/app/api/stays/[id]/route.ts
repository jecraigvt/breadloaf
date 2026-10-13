import { NextRequest, NextResponse } from "next/server";
import { deleteStayWithCalendarSync, updateStayWithCalendarSync } from "@/lib/stays";
import { StayInputError } from "@/lib/stay-input";

function failure(error: unknown) {
  if (error instanceof StayInputError) return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: error.status });
  console.error("Visit mutation failed:", error);
  return NextResponse.json({ error: "The visit could not be saved. Please try again." }, { status: 500 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StayInputError("Enter visit details");
    return NextResponse.json(await updateStayWithCalendarSync(id, body));
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await deleteStayWithCalendarSync(id));
  } catch (error) { return failure(error); }
}
