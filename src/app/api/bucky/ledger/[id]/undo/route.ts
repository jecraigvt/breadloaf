import { NextRequest, NextResponse } from "next/server";
import { getAuthCookieName, getFamilyFromAuthToken } from "@/lib/auth";
import { BuckyUndoError, undoBuckyLedgerEntry } from "@/lib/bucky-undo";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const family = await getFamilyFromAuthToken(
    request.cookies.get(getAuthCookieName())?.value
  );
  if (process.env.FAMILY_PINS && !family) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const entry = await undoBuckyLedgerEntry(id, family || "Family member");
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    if (error instanceof BuckyUndoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Bucky ledger undo failed:", error);
    return NextResponse.json({ error: "The action could not be undone." }, { status: 500 });
  }
}
