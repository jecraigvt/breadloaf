import { NextRequest, NextResponse } from "next/server";
import { createCalendarFeedToken } from "@/lib/auth";
import { getDoorFamily } from "@/lib/actor";

export async function GET(request: NextRequest) {
  const family = await getDoorFamily(request);

  if (!family) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await createCalendarFeedToken(family);
  if (!token) {
    return NextResponse.json(
      { error: "Calendar feed token unavailable" },
      { status: 500 }
    );
  }

  return NextResponse.json({ token }, { headers: { "Cache-Control": "private, no-store" } });
}
